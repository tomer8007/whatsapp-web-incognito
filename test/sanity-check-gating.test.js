const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, sandboxArrayBuffer } = require("./helpers/sandbox");

function loadPipeline() {
    const sandbox = loadScripts(createSandbox(), ["core/interception.js"]);
    sandbox.__timers.length = 0;
    const frame = sandboxArrayBuffer(sandbox, [0, 1, 2]);
    sandbox.MultiDevice = {
        enqueuePromise: (promise, argument) => promise(argument),
        decryptNoisePacket: async () => [{ frame, frameUncompressed: frame, counter: 0 }],
        encryptAndPackNodesForSending: async () => frame,
    };
    sandbox.nodeReaderWriter = { decodeStanza: async () => ({ tag: "iq", attrs: {}, content: [] }) };
    sandbox.NodeHandler = {
        interceptReceivedNode: async (node) => [true, node],
        interceptOutgoingNode: async (node) => [true, node],
    };
    sandbox.gzipInflate = () => {};
    sandbox.isEqualArray = () => true;
    sandbox.printNode = () => {};
    let sanityChecks = 0;
    sandbox.checkNodeEncoderSanity = async () => { sanityChecks++; };
    return { sandbox, frame, sanityChecks: () => sanityChecks };
}

async function runFrame(p, direction) {
    if (direction === "incoming") await p.sandbox.wsHook.after({ data: p.frame }, "wss://web.whatsapp.com/ws");
    else await p.sandbox.wsHook.before(p.frame, "wss://web.whatsapp.com/ws");
}

for (const direction of ["incoming", "outgoing"]) {
    test(`${direction}: encoder sanity check is skipped outside debug mode`, async () => {
        const p = loadPipeline();
        await runFrame(p, direction);
        assert.strictEqual(p.sanityChecks(), 0);
        assert.ok(!("isIncoming" in p.sandbox), "isIncoming leaked");
    });

    test(`${direction}: encoder sanity check runs in debug mode`, async () => {
        const p = loadPipeline();
        p.sandbox.WAdebugMode = true;
        await runFrame(p, direction);
        assert.strictEqual(p.sanityChecks(), 1);
    });
}
