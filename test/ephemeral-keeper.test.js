const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load(options) {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    loadScripts(sandbox, ["core/options_schema.js", "core/edit_tracker.js", "core/ephemeral_keeper.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WAIncognitoOptions = { ...sandbox.defaultOptions(), ...options };
    sandbox.saved = [];
    sandbox.saveArchiveRecord = async (record, store) => { sandbox.saved.push({ record, store }); return "legacy"; };
    return sandbox;
}

test("an ephemeralMessage wrapper is detected", () => {
    const { isEphemeralMessage } = load();
    assert.strictEqual(isEphemeralMessage({ ephemeralMessage: { message: { conversation: "x" } } }), true);
});

test("contextInfo.expiration > 0 on any message type is detected", () => {
    const { isEphemeralMessage } = load();
    assert.strictEqual(isEphemeralMessage({ extendedTextMessage: { text: "a", contextInfo: { expiration: 86400 } } }), true);
    assert.strictEqual(isEphemeralMessage({ imageMessage: { contextInfo: { expiration: 604800 } } }), true);
    assert.strictEqual(isEphemeralMessage({ extendedTextMessage: { text: "a", contextInfo: { expiration: 0 } } }), false);
    assert.strictEqual(isEphemeralMessage({ conversation: "plain", protocolMessage: null }), false);
    assert.strictEqual(isEphemeralMessage(null), false);
});

test("snapshot of a text message", () => {
    const { buildEphemeralSnapshot } = load();
    const snapshot = buildEphemeralSnapshot(
        { ephemeralMessage: { message: { conversation: "rahasia" } } },
        { messageId: "M1", chatJid: "111@c.us", from: "111@c.us", ts: 123 });
    assert.deepStrictEqual({ ...snapshot }, { kind: "ephemeral", id: "eph:M1", messageId: "M1", chatJid: "111@c.us", from: "111@c.us", ts: 123, text: "rahasia", mediaMeta: null });
});

test("snapshot of media keeps what is needed to download it later, encoded as base64", () => {
    const { buildEphemeralSnapshot } = load();
    const snapshot = buildEphemeralSnapshot({
        ephemeralMessage: { message: { imageMessage: {
            caption: "foto", directPath: "/v/t62/abc", mimetype: "image/jpeg",
            mediaKey: new Uint8Array([1, 2, 3]), fileEncSha256: new Uint8Array([4, 5]), fileSha256: new Uint8Array([6]),
        } } },
    }, { messageId: "M2", chatJid: "g@g.us", from: "222@c.us", ts: 9 });
    assert.strictEqual(snapshot.text, "foto");
    assert.deepStrictEqual({ ...snapshot.mediaMeta }, {
        directPath: "/v/t62/abc", mediaKey: "AQID", fileEncSha256: "BAU=", fileSha256: "Bg==", mimetype: "image/jpeg", type: "image",
    });
});

test("a voice note is type ptt, other audio is audio", () => {
    const { buildEphemeralSnapshot } = load();
    const make = (ptt) => buildEphemeralSnapshot({ audioMessage: { ptt, directPath: "/a", mimetype: "audio/ogg", mediaKey: [1], fileEncSha256: [2], fileSha256: [3], contextInfo: { expiration: 1 } } },
        { messageId: "A", chatJid: "1@c.us", from: "1@c.us", ts: 1 });
    assert.strictEqual(make(true).mediaMeta.type, "ptt");
    assert.strictEqual(make(false).mediaMeta.type, "audio");
});

test("keepDisappearing on: an ephemeral message is saved to the ephemeral store", async () => {
    const s = load({ keepDisappearing: true });
    s.NodeHandler.keepEphemeral({ ephemeralMessage: { message: { conversation: "hai" } } }, "M1", "111@c.us", "111@s.whatsapp.net");
    await Promise.resolve();
    assert.strictEqual(s.saved.length, 1);
    assert.strictEqual(s.saved[0].store, "ephemeral");
    assert.strictEqual(s.saved[0].record.text, "hai");
    assert.strictEqual(s.saved[0].record.chatJid, "111@c.us");
});

test("keepDisappearing off: nothing is saved", () => {
    const s = load({});
    s.NodeHandler.keepEphemeral({ ephemeralMessage: { message: { conversation: "hai" } } }, "M1", "111@c.us", "111@s.whatsapp.net");
    assert.strictEqual(s.saved.length, 0);
});

test("keepDisappearing on: a normal message is not saved", () => {
    const s = load({ keepDisappearing: true });
    s.NodeHandler.keepEphemeral({ conversation: "biasa", protocolMessage: null }, "M1", "111@c.us", "111@c.us");
    assert.strictEqual(s.saved.length, 0);
});

test("filterChatEphemeral keeps this chat's records, newest last, without secrets", () => {
    const { summarizeEphemeralRecords } = load();
    const list = summarizeEphemeralRecords([
        { id: "eph:2", ts: 2, from: "a", text: "dua", mediaMeta: { type: "image", mimetype: "image/jpeg", mediaKey: "K" } },
        { id: "eph:1", ts: 1, from: "a", text: "satu", mediaMeta: null },
    ]);
    assert.deepStrictEqual([...list.map((r) => r.id)], ["eph:1", "eph:2"]);
    assert.strictEqual(list[1].hasMedia, true);
    assert.strictEqual(list[1].mediaType, "image");
    assert.ok(!("mediaKey" in list[1]) && !("mediaMeta" in list[1]));
});
