const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/sandbox");

test("every UIClassNames.X used in core/ is defined in ui_class_names.js", () => {
    const coreDir = path.join(ROOT, "core");
    const registry = fs.readFileSync(path.join(coreDir, "ui_class_names.js"), "utf8");
    const missing = new Set();
    for (const file of fs.readdirSync(coreDir).filter((f) => f.endsWith(".js"))) {
        for (const line of fs.readFileSync(path.join(coreDir, file), "utf8").split(/\r?\n/)) {
            const code = line.split("//")[0];
            for (const match of code.matchAll(/UIClassNames\.([A-Z0-9_]+)/g)) {
                if (!new RegExp(`UIClassNames\\.${match[1]}\\s*=`).test(registry)) missing.add(match[1]);
            }
        }
    }
    assert.deepStrictEqual([...missing], []);
});
