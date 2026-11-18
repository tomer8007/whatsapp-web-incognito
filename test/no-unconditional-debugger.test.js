const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT, createSandbox, loadScripts } = require("./helpers/sandbox");

test("the only debugger statement in core/ is inside waDebugBreak()", () => {
    const hits = [];
    const coreDir = path.join(ROOT, "core");
    for (const file of fs.readdirSync(coreDir).filter((f) => f.endsWith(".js"))) {
        const lines = fs.readFileSync(path.join(coreDir, file), "utf8").split(/\r?\n/);
        lines.forEach((line, i) => {
            const code = line.split("//")[0];
            if (/\bdebugger\s*;/.test(code)) hits.push(`${file}:${i + 1}`);
        });
    }
    assert.strictEqual(hits.length, 1, "found: " + hits.join(", "));
    assert.ok(hits[0].startsWith("utils.js:"), "found: " + hits[0]);
});

test("waDebugBreak() is a no-op outside debug mode", () => {
    const sandbox = loadScripts(createSandbox(), ["core/utils.js"]);
    assert.strictEqual(typeof sandbox.waDebugBreak, "function");
    assert.doesNotThrow(() => sandbox.waDebugBreak());
});
