const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/edit_tracker.js"]);
}

test("detectEdit reads a protocolMessage type 14 edit", () => {
    const { EditTracker } = load();
    const edit = EditTracker.detectEdit({
        protocolMessage: { type: 14, key: { id: "T1" }, editedMessage: { conversation: "baru" } },
    });
    assert.deepStrictEqual({ ...edit }, { targetId: "T1", newText: "baru" });
});

test("detectEdit reads a secretEncryptedMessage edit (text unknown)", () => {
    const { EditTracker } = load();
    const edit = EditTracker.detectEdit({ secretEncryptedMessage: { secretEncType: 2, targetMessageKey: { id: "T2" } } });
    assert.deepStrictEqual({ ...edit }, { targetId: "T2", newText: null });
});

test("detectEdit ignores everything else", () => {
    const { EditTracker } = load();
    assert.strictEqual(EditTracker.detectEdit(null), null);
    assert.strictEqual(EditTracker.detectEdit({ conversation: "hai" }), null);
    assert.strictEqual(EditTracker.detectEdit({ protocolMessage: { type: 0, key: { id: "X" } } }), null, "revoke is not an edit");
    assert.strictEqual(EditTracker.detectEdit({ protocolMessage: null, secretEncryptedMessage: null }), null);
    assert.strictEqual(EditTracker.detectEdit({ secretEncryptedMessage: { secretEncType: 1, targetMessageKey: { id: "X" } } }), null);
});

test("extractText handles the six message shapes", () => {
    const { extractText } = load();
    assert.strictEqual(extractText({ conversation: "a" }), "a");
    assert.strictEqual(extractText({ conversation: null, extendedTextMessage: { text: "b" } }), "b");
    assert.strictEqual(extractText({ imageMessage: { caption: "c" } }), "c");
    assert.strictEqual(extractText({ videoMessage: { caption: "d" } }), "d");
    assert.strictEqual(extractText({ documentMessage: { caption: "e" } }), "e");
    assert.strictEqual(extractText({ documentWithCaptionMessage: { message: { documentMessage: { caption: "f" } } } }), "f");
});

test("extractText unwraps ephemeral and view-once wrappers and returns null otherwise", () => {
    const { extractText } = load();
    assert.strictEqual(extractText({ ephemeralMessage: { message: { conversation: "temporary" } } }), "temporary");
    assert.strictEqual(extractText({ viewOnceMessageV2: { message: { imageMessage: { caption: "sekali" } } } }), "sekali");
    assert.strictEqual(extractText({ stickerMessage: {} }), null);
    assert.strictEqual(extractText(null), null);
    assert.strictEqual(extractText({ imageMessage: { caption: "" } }), null);
});

test("recall returns what was remembered, and null for unknown messages", () => {
    const { createEditTracker } = load();
    const tracker = createEditTracker({ now: () => 1000 });
    tracker.remember("M1", "original text", 5);
    const entry = tracker.recall("M1");
    assert.strictEqual(entry.text, "original text");
    assert.strictEqual(entry.ts, 5);
    assert.strictEqual(tracker.recall("nope"), null);
});

test("entries expire after 20 minutes", () => {
    const { createEditTracker } = load();
    let clock = 0;
    const tracker = createEditTracker({ now: () => clock });
    tracker.remember("M1", "a", 0);
    clock = 20 * 60 * 1000;
    assert.notStrictEqual(tracker.recall("M1"), null, "still valid at exactly 20 minutes");
    clock = 20 * 60 * 1000 + 1;
    assert.strictEqual(tracker.recall("M1"), null);
    assert.strictEqual(tracker.size(), 0, "expired entry was dropped");
});

test("at most 5000 entries are kept, the oldest are evicted", () => {
    const { createEditTracker } = load();
    const tracker = createEditTracker({ now: () => 0 });
    for (let i = 0; i < 5003; i++) tracker.remember("M" + i, "t" + i, i);
    assert.strictEqual(tracker.size(), 5000);
    assert.strictEqual(tracker.recall("M0"), null);
    assert.strictEqual(tracker.recall("M2"), null);
    assert.notStrictEqual(tracker.recall("M3"), null);
    assert.notStrictEqual(tracker.recall("M5002"), null);
});

test("remembering non-text values is ignored", () => {
    const { createEditTracker } = load();
    const tracker = createEditTracker({ now: () => 0 });
    tracker.remember("M1", null, 1);
    tracker.remember(null, "x", 1);
    assert.strictEqual(tracker.size(), 0);
});
