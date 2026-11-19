const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, sandboxArrayBuffer } = require("./helpers/sandbox");

function countingConsole() {
    const counts = { log: 0, error: 0, warn: 0 };
    return { counts, console: { log() { counts.log++; }, error() { counts.error++; }, warn() { counts.warn++; }, info() {}, dirxml() {} } };
}

function loadPipeline(console) {
    const sandbox = loadScripts(createSandbox({ console, crypto: globalThis.crypto, TextEncoder, TextDecoder }), ["core/utils.js", "core/multi_device.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    const frame = sandboxArrayBuffer(sandbox, [0, 1, 2]);
    sandbox.MultiDevice = {
        enqueuePromise: (promise, argument) => promise(argument),
        decryptNoisePacket: async () => { throw new ReferenceError("WhatsAppAPI is not defined"); },
    };
    return { sandbox, frame };
}

for (const direction of ["outgoing", "incoming"]) {
    test(`${direction}: an early frame (WhatsAppAPI not there yet) is passed through, logged once as a note, never as an error`, async () => {
        const { counts, console } = countingConsole();
        const { sandbox, frame } = loadPipeline(console);
        const baseLog = counts.log;
        const results = [];
        for (let i = 0; i < 3; i++) {
            if (direction === "incoming") results.push(await sandbox.wsHook.after({ data: frame }, "wss://web.whatsapp.com/ws"));
            else results.push(await sandbox.wsHook.before(frame, "wss://web.whatsapp.com/ws"));
        }
        assert.strictEqual(counts.error, 0, "no console.error");
        assert.strictEqual(counts.log - baseLog, 1, "one note for three frames");
        if (direction === "outgoing") assert.ok(results.every((r) => r === frame), "the original frame is returned");
        else assert.ok(results.every((r) => r.data === frame));
    });

    test(`${direction}: other errors are still reported as errors`, async () => {
        const { counts, console } = countingConsole();
        const { sandbox, frame } = loadPipeline(console);
        sandbox.MultiDevice.decryptNoisePacket = async () => { throw new Error("something else"); };
        if (direction === "incoming") await sandbox.wsHook.after({ data: frame }, "u");
        else await sandbox.wsHook.before(frame, "u");
        assert.ok(counts.error > 0);
    });
}

function loadMultiDevice(globals = {}) {
    const sandbox = createSandbox({ crypto: globalThis.crypto, TextEncoder, TextDecoder, ...globals });
    loadScripts(sandbox, ["core/utils.js", "core/multi_device.js"]);
    return sandbox;
}

test("lazyWhatsAppAPI: null while modules are missing, no ReferenceError, no half-built object left behind", () => {
    const s = loadMultiDevice();
    s.window.WhatsAppAPI = undefined;
    s.exposeWhatsAppAPI = () => { s.window.WhatsAppAPI = {}; throw new Error("Requiring unknown module"); };
    assert.strictEqual(s.lazyWhatsAppAPI(), null);
    assert.strictEqual(s.window.WhatsAppAPI, undefined);
    delete s.exposeWhatsAppAPI;
    assert.strictEqual(s.lazyWhatsAppAPI(), null, "no expose function at all");
});

test("lazyWhatsAppAPI exposes the API once it can, and reuses it", () => {
    const s = loadMultiDevice();
    let calls = 0;
    s.exposeWhatsAppAPI = () => { calls++; s.window.WhatsAppAPI = { Communication: { socket: null } }; };
    const api = s.lazyWhatsAppAPI();
    assert.ok(api && api.Communication);
    assert.strictEqual(s.lazyWhatsAppAPI(), api);
    assert.strictEqual(calls, 1);
});

test("requireWhatsAppAPI throws the not-ready error, which the hooks recognise (also the old ReferenceError)", () => {
    const s = loadMultiDevice();
    s.exposeWhatsAppAPI = () => { throw new Error("modules not loaded"); };
    assert.throws(() => s.requireWhatsAppAPI(), /not ready yet/);
    assert.strictEqual(s.isWhatsAppAPINotReady(new Error("WhatsAppAPI is not ready yet")), true);
    assert.strictEqual(s.isWhatsAppAPINotReady(new ReferenceError("WhatsAppAPI is not defined")), true);
    assert.strictEqual(s.isWhatsAppAPINotReady(new Error("boom")), false);
});

test("the Signal helpers fail with the not-ready error instead of a ReferenceError when WhatsAppAPI is missing", async () => {
    const s = loadMultiDevice();
    s.exposeWhatsAppAPI = () => { throw new Error("x"); };
    for (const call of [() => s.MultiDevice.signalDecryptWhisperMessage({}, {}, "a"), () => s.MultiDevice.signalDecryptPrekeyWhisperMessage({}, {}, "a"),
                        () => s.MultiDevice.signalDecryptSenderKeyMessage({}, {}, "g", "a", null)]) {
        await assert.rejects(call, (error) => !(error instanceof ReferenceError) && /not ready yet/.test(error.message));
    }
});
