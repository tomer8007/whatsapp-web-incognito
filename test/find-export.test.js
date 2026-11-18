const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

// A fake Meta module system: require("__debug").modulesMap plus requirable modules.
function loadWithModules(modulesMap, requirable = {}) {
    const calls = [];
    const requireFn = (name) => {
        calls.push(name);
        if (name === "__debug") return { modulesMap };
        if (name in requirable) {
            const mod = requirable[name];
            if (mod instanceof Error) throw mod;
            return mod;
        }
        throw new Error("Requiring unknown module " + name);
    };
    const sandbox = loadScripts(createSandbox({ require: requireFn }), ["core/utils.js"]);
    return { sandbox, calls };
}

test("finds an export through an already-loaded record.exports", () => {
    const sendTextMsgToChat = () => "sent";
    const { sandbox } = loadWithModules({
        WAWebSomething: { exports: { other: 1 } },
        WAWebSendTextMsgChatAction: { exports: { sendTextMsgToChat } },
    });
    assert.strictEqual(sandbox.findExport("sendTextMsgToChat"), sendTextMsgToChat);
});

test("finds an export by requiring a module whose name matches nameHint", () => {
    const StatusV3Collection = { get() {} };
    const { sandbox, calls } = loadWithModules(
        { WAWebStatusCollection: { exports: null }, WAWebUnrelated: { exports: null } },
        { WAWebStatusCollection: { StatusV3Collection } },
    );
    assert.strictEqual(sandbox.findExport("StatusV3Collection", /Status/), StatusV3Collection);
    assert.ok(!calls.includes("WAWebUnrelated"), "must not force-load modules that do not match the hint");
});

test("does not force-load uninitialized modules without a nameHint", () => {
    const { sandbox, calls } = loadWithModules(
        { WAWebStatusCollection: { exports: null } },
        { WAWebStatusCollection: { StatusV3Collection: {} } },
    );
    assert.strictEqual(sandbox.findExport("StatusV3Collection"), null);
    assert.deepStrictEqual(calls.filter((c) => c !== "__debug"), []);
});

test("a require that throws yields null instead of crashing", () => {
    const { sandbox } = loadWithModules(
        { WAWebBroken: { exports: null } },
        { WAWebBroken: new Error("boom") },
    );
    assert.strictEqual(sandbox.findExport("anything", /Broken/), null);
});

test("a missing __debug module yields null", () => {
    const sandbox = loadScripts(createSandbox({ require: () => { throw new Error("no"); } }), ["core/utils.js"]);
    assert.strictEqual(sandbox.findExport("x"), null);
});

test("results are cached", () => {
    const fn = () => {};
    const modulesMap = { WAWebA: { exports: { fn } } };
    const { sandbox, calls } = loadWithModules(modulesMap);
    assert.strictEqual(sandbox.findExport("fn"), fn);
    delete modulesMap.WAWebA;
    assert.strictEqual(sandbox.findExport("fn"), fn, "cached result survives the module going away");
    assert.strictEqual(calls.filter((c) => c === "__debug").length, 1, "second lookup must not scan again");
});
