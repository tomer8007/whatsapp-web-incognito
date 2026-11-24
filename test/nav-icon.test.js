const test = require("node:test");
const assert = require("node:assert");
const vm = require("node:vm");
const fs = require("node:fs");
const path = require("node:path");

class Node_ {
    constructor(tag, cls = "") { this.tag = tag; this.cls = cls; this.children = []; this.parentElement = null; }
    appendChild(c) { c.parentElement = this; this.children.push(c); return c; }
    insertBefore(c, ref) { c.parentElement = this; const i = this.children.indexOf(ref); this.children.splice(i < 0 ? this.children.length : i, 0, c); return c; }
    cloneNode() { return new Node_(this.tag, this.cls); } // shallow
}

function load() {
    const code = fs.readFileSync(path.join(__dirname, "..", "core", "ui.js"), "utf8");
    const start = code.indexOf("function placeNavIcon");
    const end = code.indexOf("async function addIconIfNeeded");
    const sandbox = {};
    vm.createContext(sandbox);
    vm.runInContext(code.slice(start, end), sandbox);
    return sandbox;
}

// container (8 entries) > entry DIV (1 child) > SPAN > [Chats wrapper]
function navTree() {
    const container = new Node_("div", "nav");
    const entries = [];
    for (let i = 0; i < 8; i++) { const e = new Node_("div", "entry"); container.appendChild(e); entries.push(e); }
    const span = entries[0].appendChild(new Node_("span", "html-span"));
    const chats = span.appendChild(new Node_("div", "menu-item"));
    return { container, entries, span, chats };
}

test("the icon gets its own entry in the nav container, outside the SPAN that wraps Chats", () => {
    const s = load();
    const t = navTree();
    const icon = new Node_("div", "menu-item-incognito");
    assert.strictEqual(s.placeNavIcon(t.chats, icon), "own-entry");
    assert.strictEqual(t.container.children.length, 9);
    const wrapper = icon.parentElement;
    assert.strictEqual(wrapper.cls, "entry", "a shallow copy of the entry DIV");
    assert.strictEqual(wrapper.parentElement, t.container);
    assert.strictEqual(t.container.children.indexOf(wrapper) + 1, t.container.children.indexOf(t.entries[0]), "right before the first nav entry");
    assert.deepStrictEqual(t.span.children, [t.chats], "the SPAN of Chats is untouched");
    assert.strictEqual(wrapper.children.length, 1);
});

test("without that structure the icon goes right before the first item, as before", () => {
    const s = load();
    const parent = new Node_("div");
    const first = parent.appendChild(new Node_("div", "menu-item"));
    parent.appendChild(new Node_("div", "other"));
    const icon = new Node_("div", "menu-item-incognito");
    assert.strictEqual(s.placeNavIcon(first, icon), "fallback");
    assert.strictEqual(parent.children[0], icon);
    // few siblings in the "container": also the fallback
    const small = new Node_("div"); const entry = small.appendChild(new Node_("div")); const span = entry.appendChild(new Node_("span"));
    const item = span.appendChild(new Node_("div"));
    assert.strictEqual(s.placeNavIcon(item, new Node_("div")), "fallback");
});
