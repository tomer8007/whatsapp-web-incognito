const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, createSandbox, loadScripts, drainTimers } = require("./helpers/sandbox");

function loadRouter() {
    return loadScripts(createSandbox(), ["core/response_router.js"]);
}

function countingTarget() {
    const target = new EventTarget();
    let listeners = 0;
    const add = target.addEventListener.bind(target);
    target.addEventListener = (...args) => { listeners++; add(...args); };
    return { target, listenerCount: () => listeners };
}

function respond(target, data) {
    target.dispatchEvent(new CustomEvent("reply", { detail: JSON.stringify(data) }));
}

test("registers a single listener no matter how many waits", () => {
    const sandbox = loadRouter();
    const { target, listenerCount } = countingTarget();
    const router = sandbox.createResponseRouter(target, "reply", 10000);
    for (let i = 0; i < 100; i++) router.waitFor("id" + i, () => {});
    assert.strictEqual(listenerCount(), 1);
});

test("calls every callback waiting on an ID once, then forgets them", () => {
    const sandbox = loadRouter();
    const { target } = countingTarget();
    const router = sandbox.createResponseRouter(target, "reply", 10000);
    const got = [];
    router.waitFor("A", (d) => got.push("first:" + d.value));
    router.waitFor("A", (d) => got.push("second:" + d.value));

    respond(target, { messageID: "A", value: 1 });
    respond(target, { messageID: "A", value: 2 });

    assert.deepStrictEqual(got, ["first:1", "second:1"]);
    assert.strictEqual(router.pendingCount(), 0);
});

test("ignores responses for other message IDs", () => {
    const sandbox = loadRouter();
    const { target } = countingTarget();
    const router = sandbox.createResponseRouter(target, "reply", 10000);
    let called = false;
    router.waitFor("A", () => { called = true; });

    respond(target, { messageID: "B" });

    assert.strictEqual(called, false);
    assert.strictEqual(router.pendingCount(), 1);
});

test("drops callbacks whose response never arrives", async () => {
    const sandbox = loadRouter();
    const { target } = countingTarget();
    const router = sandbox.createResponseRouter(target, "reply", 10000);
    let called = false;
    router.waitFor("A", () => { called = true; });

    await drainTimers(sandbox);
    respond(target, { messageID: "A" });

    assert.strictEqual(router.pendingCount(), 0);
    assert.strictEqual(called, false);
});

test("ui.js no longer adds a reply listener per message, and the router loads before it", () => {
    const ui = fs.readFileSync(path.join(ROOT, "core/ui.js"), "utf8");
    assert.ok(!ui.includes('addEventListener("onDeletedMessageReceived"'));
    assert.ok(!ui.includes('addEventListener("onDeviceTypeReceived"'));

    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const scripts = manifest.content_scripts.find((c) => c.js.includes("core/ui.js")).js;
    assert.ok(scripts.indexOf("core/response_router.js") > -1, "router missing from manifest");
    assert.ok(scripts.indexOf("core/response_router.js") < scripts.indexOf("core/ui.js"), "router must load before ui.js");
});

test("the Mark as read confirmation is the SweetAlert popup of master, loaded as a content script before ui.js", () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const scripts = manifest.content_scripts.find((c) => c.js.includes("core/ui.js")).js;
    assert.ok(scripts.indexOf("lib/sweetalert.min.js") > -1 && scripts.indexOf("lib/sweetalert.min.js") < scripts.indexOf("core/ui.js"));
    const ui = fs.readFileSync(path.join(ROOT, "core/ui.js"), "utf8");
    assert.ok(/Swal\.fire\(\{\s*title: t\("markRead\.title"\)/.test(ui));
});
