const test = require("node:test");
const assert = require("node:assert");
const { loadHandlers, revoke, messageNode } = require("./helpers/handlers");

test("handling a received message leaks no globals", async () => {
    const sandbox = loadHandlers();
    sandbox.MultiDevice = { decryptE2EMessagesFromMessageNode: async () => [revoke()] };

    await sandbox.NodeHandler.onReceivedMessageNode(messageNode());

    assert.ok(!("messageId" in sandbox), "messageId leaked");
    assert.ok(!("indexOfEncNode" in sandbox), "indexOfEncNode leaked");
});

test("saving a view-once message leaks no globals", async () => {
    const sandbox = loadHandlers();
    sandbox.AbortController = AbortController; // browser global, not present in a bare vm context
    sandbox.arrayBufferToBase64 = () => "AA==";
    sandbox.WhatsAppAPI = { downloadManager: { downloadAndMaybeDecrypt: async () => new ArrayBuffer(1) } };
    const viewOnce = {
        viewOnceMessageV2: { message: { videoMessage: null, imageMessage: {
            mediaKey: [1], fileEncSha256: [2], fileSha256: [3],
            directPath: "/x", mimetype: "image/jpeg", caption: "c",
        } } },
        viewOnceMessageV2Extension: null,
    };

    await sandbox.interceptViewOnceMessages(viewOnce, "M1");

    assert.ok(!("body" in sandbox), "body leaked");
    assert.ok(!("dataURI" in sandbox), "dataURI leaked");
});
