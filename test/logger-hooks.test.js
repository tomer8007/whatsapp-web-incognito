const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts, drainTimers } = require("./helpers/sandbox");

function loadWithLogger() {
    const calls = [];
    const WALogger = {
        LOG: () => calls.push("LOG"),
        DEV: () => calls.push("DEV"),
        ERROR: () => calls.push("ERROR"),
        WARN: () => calls.push("WARN"),
    };
    const modules = { WALogger, WALoggerUtils: { rebuildTemplate: () => "" } };
    const sandbox = loadScripts(createSandbox({ require: (name) => modules[name] }), ["core/interception.js"]);
    return { sandbox, WALogger, calls };
}

test("hooked WARN forwards to WhatsApp's WARN, not ERROR", async () => {
    const { sandbox, WALogger, calls } = loadWithLogger();
    await drainTimers(sandbox);
    WALogger.WARN("w");
    assert.deepStrictEqual(calls, ["WARN"]);
});

test("hooked DEV forwards to WhatsApp's DEV, not LOG", async () => {
    const { sandbox, WALogger, calls } = loadWithLogger();
    await drainTimers(sandbox);
    WALogger.DEV("d");
    assert.deepStrictEqual(calls, ["DEV"]);
});

test("unhandled-rejection hook does not throw", () => {
    const { sandbox } = loadWithLogger();
    assert.doesNotThrow(() => sandbox.onunhandledrejection({ reason: "boom" }));
});
