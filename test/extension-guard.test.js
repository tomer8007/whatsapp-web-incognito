const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load(chromeObj) {
    const calls = { fired: [], reloaded: 0 };
    const sandbox = createSandbox({
        chrome: chromeObj,
        location: { reload() { calls.reloaded++; } },
        WAModal: { fire(options) { calls.fired.push(options); return Promise.resolve({ isConfirmed: true }); } },
    });
    loadScripts(sandbox, ["core/i18n.js", "core/i18n_strings.js", "core/extension_guard.js"]);
    return { s: sandbox, calls };
}

const tick = () => new Promise((r) => setImmediate(r));

test("a dead context (runtime undefined, or no id) is detected", () => {
    assert.strictEqual(load({}).s.isExtensionContextValid(), false);
    assert.strictEqual(load({ runtime: {} }).s.isExtensionContextValid(), false);
    assert.strictEqual(load({ runtime: { id: "abc" } }).s.isExtensionContextValid(), true);
    assert.strictEqual(load(undefined).s.isExtensionContextValid(), false);
});

test("sendMessage on a dead context does not throw, shows the notice once, and a click reloads the tab", async () => {
    const { s, calls } = load({});
    assert.strictEqual(s.safeSendMessage({ name: "getOptions" }, () => {}), false);
    assert.strictEqual(s.safeSendMessage({ name: "getOptions" }, () => {}), false);
    assert.strictEqual(calls.fired.length, 1, "one popup only");
    assert.strictEqual(calls.fired[0].title, "Extension updated");
    assert.strictEqual(calls.fired[0].text, "Reload the WhatsApp tab so WAIncognito works again.");
    assert.strictEqual(calls.fired[0].confirmButtonText, "Reload");
    await tick();
    assert.strictEqual(calls.reloaded, 1);
});

test("sendMessage that throws 'Extension context invalidated' is caught and shows the notice", () => {
    const { s, calls } = load({ runtime: { id: "x", sendMessage() { throw new Error("Extension context invalidated."); } } });
    assert.strictEqual(s.safeSendMessage({ name: "x" }), false);
    assert.strictEqual(calls.fired.length, 1);
});

test("a working context passes the response through", () => {
    const { s, calls } = load({ runtime: { id: "x", sendMessage(message, cb) { cb({ ok: message.name }); } } });
    let got = null;
    assert.strictEqual(s.safeSendMessage({ name: "hi" }, (r) => { got = r; }), true);
    assert.deepStrictEqual({ ...got }, { ok: "hi" });
    assert.strictEqual(calls.fired.length, 0);
});

test("storage helpers return empty results instead of throwing when the context is gone", async () => {
    const dead = load({});
    assert.deepStrictEqual({ ...(await dead.s.extensionStorageGet(["a"])) }, {});
    assert.strictEqual(await dead.s.extensionStorageSet({ a: 1 }), false);
    assert.strictEqual(dead.s.extensionUrl("images/x.svg"), "");
    const throwing = load({ runtime: { id: "x" }, storage: { local: { get: async () => { throw new Error("Extension context invalidated."); }, set: async () => { throw new Error("Extension context invalidated."); } } } });
    assert.deepStrictEqual({ ...(await throwing.s.extensionStorageGet(["a"])) }, {});
    assert.strictEqual(await throwing.s.extensionStorageSet({ a: 1 }), false);
    assert.strictEqual(throwing.calls.fired.length, 1);
    const fine = load({ runtime: { id: "x", getURL: (p) => "chrome-extension://x/" + p }, storage: { local: { get: async () => ({ a: 2 }), set: async () => {} } } });
    assert.strictEqual((await fine.s.extensionStorageGet(["a"])).a, 2);
    assert.strictEqual(fine.s.extensionUrl("p"), "chrome-extension://x/p");
});

test("the notice exists and the UI no longer calls chrome.runtime / chrome.storage directly", () => {
    const { s } = load({});
    for (const k of ["extension.updated.title", "extension.updated.text", "extension.reload"]) assert.ok(s.I18N_DICT.en[k], k);
    const fs = require("node:fs"), path = require("node:path");
    for (const file of ["core/ui.js", "core/settings_dialog.js", "core/receipt_scheduler.js", "core/status_download.js"]) {
        const code = fs.readFileSync(path.join(require("./helpers/sandbox").ROOT, file), "utf8");
        assert.ok(!/chrome\.runtime\.(sendMessage|getURL)|browser\.runtime\.sendMessage|chrome\.storage\.local\.(get|set)/.test(code), file);
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(require("./helpers/sandbox").ROOT, "manifest.json"), "utf8"));
    assert.strictEqual(manifest.content_scripts.find((c) => c.js.includes("core/ui.js")).js[0], "core/extension_guard.js");
});
