const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/sandbox");

test("the unused pseudoMsgs bookkeeping is gone", () => {
    for (const file of ["core/ui.js", "core/interception.js"]) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        assert.ok(!code.includes("pseudoMsgs"), `${file} still mentions pseudoMsgs`);
    }
});
