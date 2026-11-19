const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load(options) {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    loadScripts(sandbox, ["core/options_schema.js", "core/edit_tracker.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WAIncognitoOptions = { ...sandbox.defaultOptions(), ...options };
    sandbox.saved = [];
    sandbox.saveArchiveRecord = async (record, store) => { sandbox.saved.push({ record, store }); return "legacy"; };
    sandbox.toasts = [];
    sandbox.notifyEditedMessage = (chatJid, preview) => { sandbox.toasts.push({ chatJid, preview }); };
    return sandbox;
}

const text = (t) => ({ conversation: t, protocolMessage: null });
const edit = (id, t) => ({ protocolMessage: { type: 14, key: { id }, editedMessage: { conversation: t } } });

test("an edit of a remembered message saves the original (kind edit, store edits)", async () => {
    const s = load({ saveEdits: true });
    s.NodeHandler.trackEdits(text("harga 100"), "M1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "harga 900"), "E1", "111@c.us");
    await Promise.resolve();

    assert.strictEqual(s.saved.length, 1);
    const { record, store } = s.saved[0];
    assert.strictEqual(store, "edits");
    assert.strictEqual(record.kind, "edit");
    assert.strictEqual(record.targetId, "M1");
    assert.strictEqual(record.original, "harga 100");
    assert.strictEqual(record.newText, "harga 900");
    assert.strictEqual(record.chatJid, "111@c.us");
    assert.ok(record.id.startsWith("edit:M1:"));
});

test("a second edit keeps the previous version as its original", async () => {
    const s = load({ saveEdits: true });
    s.NodeHandler.trackEdits(text("a"), "M1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "b"), "E1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "c"), "E2", "111@c.us");
    await Promise.resolve();
    assert.deepStrictEqual([...s.saved.map((x) => x.record.original)], ["a", "b"]);
});

test("an edit of a message we never saw saves nothing", () => {
    const s = load({ saveEdits: true });
    s.NodeHandler.trackEdits(edit("UNKNOWN", "x"), "E1", "111@c.us");
    assert.strictEqual(s.saved.length, 0);
});

test("with saveEdits and toastOnEdit off nothing is remembered or saved", () => {
    const s = load({});
    s.NodeHandler.trackEdits(text("a"), "M1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "b"), "E1", "111@c.us");
    assert.strictEqual(s.saved.length, 0);
    assert.strictEqual(s.toasts.length, 0);
    assert.strictEqual(s.EditTracker.size(), 0);
});

test("toastOnEdit alone notifies but saves nothing", () => {
    const s = load({ toastOnEdit: true });
    s.NodeHandler.trackEdits(text("a"), "M1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "b"), "E1", "111@c.us");
    assert.strictEqual(s.saved.length, 0);
    assert.deepStrictEqual({ ...s.toasts[0] }, { chatJid: "111@c.us", preview: "b" });
});

test("an edit with the same text (link preview update) is ignored", () => {
    const s = load({ saveEdits: true });
    s.NodeHandler.trackEdits(text("a"), "M1", "111@c.us");
    s.NodeHandler.trackEdits(edit("M1", "a"), "E1", "111@c.us");
    assert.strictEqual(s.saved.length, 0);
});

test("onReceivedE2EMessage never blocks an edit", async () => {
    const s = load({ saveEdits: true });
    s.saveDeletedMsgsHookEnabled = true;
    const node = { tag: "message", attrs: { id: "E1", from: "111@s.whatsapp.net" }, content: [] };
    const allowed = await s.NodeHandler.onReceivedE2EMessage(node, { ...edit("M1", "b"), viewOnceMessageV2: null, viewOnceMessageV2Extension: null });
    assert.strictEqual(allowed, true);
});

test("deletedMsgs upgrade: fresh install creates msgs, edits and ephemeral", () => {
    const s = load({});
    const created = [];
    const db = {
        objectStoreNames: { contains: (n) => created.some((c) => c.name == n) },
        createObjectStore(name, opts) { const store = { name, indexes: [], createIndex(i) { this.indexes.push(i); } }; created.push(store); return store; },
    };
    s.upgradeDeletedMsgsDB(db, null, 0);
    assert.deepStrictEqual([...created.map((c) => c.name)], ["msgs", "edits", "ephemeral"]);
    assert.deepStrictEqual([...created[0].indexes], ["originalID_index"]);
    assert.deepStrictEqual([...created[1].indexes], ["targetId_index"]);
});

test("deletedMsgs upgrade: v1 gets the index, v2 only gets the new stores, v3 changes nothing", () => {
    const s = load({});
    function run(oldVersion, existing) {
        const created = [];
        const msgsIndexes = [];
        const db = {
            objectStoreNames: { contains: (n) => existing.includes(n) || created.includes(n) },
            createObjectStore(name) { created.push(name); return { createIndex() {} }; },
        };
        const txn = { objectStore: () => ({ createIndex: (i) => msgsIndexes.push(i) }) };
        s.upgradeDeletedMsgsDB(db, txn, oldVersion);
        return { created: [...created], msgsIndexes: [...msgsIndexes] };
    }
    assert.deepStrictEqual(run(1, ["msgs"]), { created: ["edits", "ephemeral"], msgsIndexes: ["originalID_index"] });
    assert.deepStrictEqual(run(2, ["msgs"]), { created: ["edits", "ephemeral"], msgsIndexes: [] });
    assert.deepStrictEqual(run(3, ["msgs", "edits", "ephemeral"]), { created: [], msgsIndexes: [] });
});

const tick = () => new Promise((r) => setImmediate(r));
const chatWith = (id, body) => ({ msgs: { getModelsArray: () => [{ id: { id }, body, t: 1700000000 }] } });

test("an unknown edit falls back to the body in WhatsApp's own message model", async () => {
    const s = load({ saveEdits: true, toastOnEdit: true });
    s.getChatByJID = async () => chatWith("OLD1", "harga lama");
    s.NodeHandler.trackEdits(edit("OLD1", "harga baru"), "E1", "111@c.us");
    await tick(); await tick();
    assert.strictEqual(s.saved.length, 1);
    assert.strictEqual(s.saved[0].record.original, "harga lama");
    assert.strictEqual(s.saved[0].record.newText, "harga baru");
    assert.strictEqual(s.toasts.length, 1);
});

test("the toast is shown even when the original is unknown, and nothing is saved", async () => {
    const s = load({ saveEdits: true, toastOnEdit: true });
    s.getChatByJID = async () => chatWith("OTHER", "x");
    s.NodeHandler.trackEdits(edit("NOPE", "teks baru"), "E1", "111@c.us");
    await tick(); await tick();
    assert.strictEqual(s.saved.length, 0);
    assert.deepStrictEqual({ ...s.toasts[0] }, { chatJid: "111@c.us", preview: "teks baru" });
});

test("an edit with no lookup possible at all still toasts", async () => {
    const s = load({ toastOnEdit: true });
    s.NodeHandler.trackEdits(edit("NOPE", "teks baru"), "E1", "111@c.us"); // getChatByJID is not even defined
    await tick(); await tick();
    assert.strictEqual(s.toasts.length, 1);
});

test("resolveEditOriginal prefers the cache and readOriginalFromChatModel never throws", () => {
    const s = load({});
    assert.strictEqual(s.resolveEditOriginal({ text: "c", ts: 1 }, { text: "m", ts: 2 }).source, "cache");
    assert.strictEqual(s.resolveEditOriginal(null, { text: "m", ts: 2 }).source, "model");
    assert.strictEqual(s.resolveEditOriginal(null, null), null);
    assert.strictEqual(s.readOriginalFromChatModel(null, "x"), null);
    assert.strictEqual(s.readOriginalFromChatModel({ msgs: { getModelsArray() { throw new Error("x"); } } }, "x"), null);
    assert.strictEqual(s.readOriginalFromChatModel({ msgs: { getModelsArray: () => [{ id: { id: "x" }, body: "b", isMedia: true }] } }, "x"), null);
    assert.strictEqual(s.readOriginalFromChatModel({ msgs: { getModelsArray: () => [{ id: { id: "x" }, caption: "cap", isMedia: true }] } }, "x").text, "cap");
});

test("an edit inside an ephemeral wrapper, or with a string enum type, is detected", () => {
    const s = load({});
    const wrapped = { ephemeralMessage: { message: edit("M9", "z") } };
    assert.strictEqual(s.EditTracker.detectEdit(wrapped).targetId, "M9");
    const str = { protocolMessage: { type: "MESSAGE_EDIT", key: { id: "M8" }, editedMessage: { conversation: "q" } } };
    assert.deepStrictEqual({ ...s.EditTracker.detectEdit(str) }, { targetId: "M8", newText: "q" });
});
