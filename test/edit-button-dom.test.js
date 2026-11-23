const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

// A tiny fake DOM, enough for the Original button code
class El {
    constructor(tag, attrs = {}) { this.tag = tag; this.attrs = { ...attrs }; this.children = []; this.parentElement = null; this.className = ""; this.textContent = ""; }
    get parentNode() { return this.parentElement; }
    get classList() { return { contains: (c) => this.className.split(" ").includes(c) }; }
    getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
    setAttribute(k, v) { this.attrs[k] = v; }
    addEventListener() {}
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    get nextSibling() { const i = this.parentElement.children.indexOf(this); return this.parentElement.children[i + 1] || null; }
    insertBefore(c, ref) { c.parentElement = this; const i = ref ? this.children.indexOf(ref) : this.children.length; this.children.splice(i, 0, c); return c; }
    remove() { this.parentElement.children.splice(this.parentElement.children.indexOf(this), 1); this.parentElement = null; }
    closest(sel) {
        for (let n = this; n; n = n.parentElement) {
            if (sel.includes("data-id") && n.getAttribute("data-id")) return n;
            if (sel.includes("conv-msg") && String(n.getAttribute("data-testid") || "").startsWith("conv-msg")) return n;
        }
        return null;
    }
    all() { return this.children.flatMap((c) => [c, ...c.all()]); }
    matches(sel) { return sel.includes("data-id") && !!this.getAttribute("data-id"); }
    querySelectorAll(sel) {
        if (sel == "span") return this.all().filter((e) => e.tag == "span");
        if (sel.includes("data-id")) return this.all().filter((e) => e.getAttribute("data-id") || String(e.getAttribute("data-testid") || "").startsWith("conv-msg"));
        return [];
    }
    querySelector(sel) {
        if (sel.startsWith(":scope >")) return this.children.find((c) => c.classList.contains(sel.slice(sel.indexOf(".") + 1))) || null;
        if (sel.startsWith(".")) return this.all().find((e) => e.classList.contains(sel.slice(1))) || null;
        if (sel.includes("msg-meta")) return this.all().find((e) => e.getAttribute("data-testid") == "msg-meta") || null;
        return null;
    }
}

function load() {
    const code = fs.readFileSync(path.join(__dirname, "..", "core", "ui.js"), "utf8");
    const start = code.indexOf("var EDITED_LABEL_WORDS");
    const end = code.indexOf('document.addEventListener("waIncognitoEdited"');
    const sandbox = {
        document: { createElement: (tag) => new El(tag) },
        t: (k) => k, showEditHistory() {}, Array, String, Set,
    };
    vm.createContext(sandbox);
    vm.runInContext(code.slice(start, end), sandbox);
    return sandbox;
}

function label(parent) { const l = new El("span"); l.textContent = "Edited"; parent.appendChild(l); return l; }
const buttons = (root) => root.all().filter((e) => e.className.includes("incognito-edit-original"));

test("two edited messages inside one wrapper each get their own button", () => {
    const s = load();
    const wrapper = new El("div", { "data-id": "wrapper" });
    const m1 = new El("div", { "data-id": "true_1@c.us_AAA" }); wrapper.appendChild(m1);
    const m2 = new El("div", { "data-id": "false_1@c.us_BBB" }); wrapper.appendChild(m2);
    label(m1); label(m2);
    s.scanForEditedLabels(wrapper);
    assert.strictEqual(buttons(m1).length, 1);
    assert.strictEqual(buttons(m2).length, 1);
    s.scanForEditedLabels(wrapper);
    assert.strictEqual(buttons(wrapper).length, 2, "a second scan adds nothing");
});

test("a one-part wrapper data-id is skipped in favour of the inner three-part id", () => {
    const s = load();
    const wrapper = new El("div", { "data-id": "wrapper" });
    const inner = new El("div", { "data-id": "true_1@c.us_INNERID" }); wrapper.appendChild(inner);
    const meta = new El("div", { "data-testid": "msg-meta" }); inner.appendChild(meta);
    const l = label(meta);
    const info = s.messageIdOfElement(l);
    assert.strictEqual(info.id, "INNERID");
    assert.strictEqual(info.holder, inner);
    // conv-msg testid form
    const alt = new El("div", { "data-testid": "conv-msg-XYZ" }); wrapper.appendChild(alt);
    assert.strictEqual(s.messageIdOfElement(label(alt)).id, "XYZ");
    // nothing better than the wrapper: the old behaviour
    const lone = new El("div", { "data-id": "wrapper2" }); const l2 = label(lone);
    assert.strictEqual(s.messageIdOfElement(l2).id, "wrapper2");
});

test("the button in the msg-meta row is added, and comes back after a re-render", () => {
    const s = load();
    const row = new El("div", { "data-id": "true_1@c.us_AAA" });
    const meta = new El("div", { "data-testid": "msg-meta" }); row.appendChild(meta);
    const l = label(meta);
    s.scanForEditedLabels(row);
    assert.strictEqual(buttons(row).length, 1);
    assert.strictEqual(l.nextSibling.className, "incognito-edit-original");
    // WhatsApp re-renders the meta row: our node is dropped, the label is new
    meta.children.length = 0;
    label(meta);
    s.scanForEditedLabels(row);
    assert.strictEqual(buttons(row).length, 1);
});
