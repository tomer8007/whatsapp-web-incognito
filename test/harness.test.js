const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

test("interception.js loads in the sandbox and installs the WebSocket hooks", () => {
    const sandbox = loadScripts(createSandbox(), ["core/interception.js"]);
    assert.strictEqual(typeof sandbox.wsHook.before, "function");
    assert.strictEqual(typeof sandbox.wsHook.after, "function");
});
