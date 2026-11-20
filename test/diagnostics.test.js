const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function loadDiagnostics() {
    return loadScripts(createSandbox(), ["core/diagnostics.js"]);
}

function statusOf(results, id) {
    return results.find((r) => r.id === id).status;
}

test("a check that throws is reported as missing, without crashing", () => {
    const { Diagnostics } = loadDiagnostics();
    Diagnostics.register("core", "module", "WAWebBroken", () => { throw new Error("Requiring unknown module"); });
    Diagnostics.register("core", "module", "WAWebFine", () => true);
    const results = Diagnostics.run();
    assert.strictEqual(statusOf(results, "WAWebBroken"), "missing");
    assert.strictEqual(statusOf(results, "WAWebFine"), "ok");
});

test("selectors are never missing: 0 matches or an error is 'unseen'", () => {
    const { Diagnostics } = loadDiagnostics();
    Diagnostics.register("blur", "selector", "#pane-side", () => 0);
    Diagnostics.register("blur", "selector", ".x1", () => 3);
    Diagnostics.register("blur", "selector", ".bad", () => { throw new Error("bad selector"); });
    const results = Diagnostics.run();
    assert.strictEqual(statusOf(results, "#pane-side"), "unseen");
    assert.strictEqual(statusOf(results, ".x1"), "ok");
    assert.strictEqual(statusOf(results, ".bad"), "unseen");
});

test("hook counters: 0 is unseen, >0 is ok; false is missing", () => {
    const { Diagnostics } = loadDiagnostics();
    Diagnostics.register("voice", "hook", "audio-play", () => 0);
    Diagnostics.register("voice", "hook", "audio-play-2", () => 4);
    Diagnostics.register("core", "hook", "interception", () => false);
    const results = Diagnostics.run();
    assert.strictEqual(statusOf(results, "audio-play"), "unseen");
    assert.strictEqual(statusOf(results, "audio-play-2"), "ok");
    assert.strictEqual(statusOf(results, "interception"), "missing");
});

test("registering the same dependency twice keeps one entry", () => {
    const { Diagnostics } = loadDiagnostics();
    Diagnostics.register("core", "db", "deletedMsgs", () => false);
    Diagnostics.register("core", "db", "deletedMsgs", () => true);
    const results = Diagnostics.run();
    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].status, "ok");
});

test("report() contains statuses but nothing that looks like a JID", () => {
    const { Diagnostics } = loadDiagnostics();
    Diagnostics.register("core", "module", "WAWebChatCollection", () => true);
    Diagnostics.register("status", "module", "WAWebStatusCollection", () => {
        throw new Error("not found for 628123456789@s.whatsapp.net in 1203630@g.us via 99887766@lid");
    });
    const text = Diagnostics.report(Diagnostics.run());
    assert.ok(text.includes("WAWebChatCollection"));
    assert.ok(text.includes("missing"));
    assert.ok(!/@(s\.whatsapp\.net|g\.us|lid)/.test(text), text);
    assert.ok(!text.includes("628123456789"), "phone numbers must not leak");
});
