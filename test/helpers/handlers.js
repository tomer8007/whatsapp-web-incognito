const { createSandbox, loadScripts } = require("./sandbox");

// Loads the incoming-message pipeline with anti-delete turned on.
function loadHandlers() {
    const sandbox = createSandbox({
        Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } },
        deepClone: (o) => JSON.parse(JSON.stringify(o)),
    });
    loadScripts(sandbox, ["core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.saveDeletedMsgsHookEnabled = true;
    return sandbox;
}

// A view-once wrapper whose inner message is neither image nor video: interceptViewOnceMessages throws on it.
const brokenViewOnce = () => ({
    protocolMessage: null,
    viewOnceMessageV2: { message: { imageMessage: null, videoMessage: null } },
    viewOnceMessageV2Extension: null,
});

const revoke = () => ({
    protocolMessage: { type: 0, key: { id: "ORIGINAL", participant: "" } },
    viewOnceMessageV2: null,
    viewOnceMessageV2Extension: null,
});

const messageNode = () => ({
    tag: "message",
    attrs: { id: "M1", from: "111@s.whatsapp.net" },
    content: [{ tag: "enc" }, { tag: "enc" }],
});

module.exports = { loadHandlers, brokenViewOnce, revoke, messageNode };
