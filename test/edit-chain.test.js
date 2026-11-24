const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const load = () => loadScripts(createSandbox(), ["core/edit_chain.js"]);
const plain = (list) => [...list].map((v) => ({ ...v }));

test("a clean chain: Version 1 (original) -> 2 -> 3 -> current", () => {
    const { buildEditChain } = load();
    const chain = plain(buildEditChain([
        { ts: 30, original: "dua", newText: "tiga" },
        { ts: 10, original: "satu", newText: "dua" },
    ]));
    assert.deepStrictEqual(chain, [
        { n: 1, text: "satu", replacedAt: 10, current: false },
        { n: 2, text: "dua", replacedAt: 30, current: false },
        { n: 3, text: "tiga", replacedAt: null, current: true },
    ]);
});

test("two edits never list the same before-text when the previous edit produced something else", () => {
    const { buildEditChain } = load();
    // stale second record: the model had not changed yet, so it repeats "satu"
    const chain = plain(buildEditChain([
        { ts: 10, original: "satu", newText: "dua" },
        { ts: 20, original: "satu", newText: "tiga" },
    ]));
    assert.deepStrictEqual(chain.map((v) => v.text), ["satu", "dua", "tiga"]);
});

test("identical text stays identical when the edit really did not change it, and unknown new texts end the chain", () => {
    const { buildEditChain } = load();
    assert.deepStrictEqual(plain(buildEditChain([{ ts: 1, original: "a", newText: "a" }, { ts: 2, original: "a", newText: null }])).map((v) => v.text), ["a", "a"]);
    assert.deepStrictEqual(buildEditChain([]).length, 0);
    assert.deepStrictEqual(plain(buildEditChain([{ ts: 1, original: "x", newText: null }])).map((v) => v.current), [false]);
});

test("the edit toast shows before and after, no emoji, truncated", () => {
    const s = loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/toast.js"]);
    const text = s.formatToast({ kind: "edit", chatName: "Budi", preview: "baru", before: "lama" }, {});
    assert.strictEqual(text.body, "Budi: from \"lama\" to \"baru\"");
    const long = s.formatToast({ kind: "edit", chatName: "B", preview: "y".repeat(200), before: "x".repeat(200) }, {});
    assert.ok(long.body.length < 200);
    assert.strictEqual(s.formatToast({ kind: "edit", chatName: "Budi", preview: "baru", before: "lama" }, { hidePreview: true }).body, "Budi");
});

test("the Original button is judged by its presence in the DOM, not by a remembered flag (re-entering a chat)", () => {
    const code = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "core", "ui.js"), "utf8");
    assert.ok(!/incognitoEditBtn/.test(code), "no stale dataset flag");
    assert.ok(/function hasOriginalButton/.test(code));
    assert.ok(/info\.holder\.querySelector\("\.incognito-edit-original"\)/.test(code));
    assert.ok(/scanForEditedLabels\(document\.getElementById\("main"\)\)/.test(code), "periodic rescan of the open chat");
});
