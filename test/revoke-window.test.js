const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() { return loadScripts(createSandbox(), ["core/revoke_window.js"]); }

test("apply raises the two revoke constants to a large finite value and keeps the originals", () => {
    const s = load();
    const constants = { REVOKE_WINDOW: 216000, REVOKE_WINDOW_RECEIVER_MARGIN: 43200, NEWSLETTER_REVOKE_WINDOW: 1000 };
    const saved = {};
    assert.strictEqual(s.applyRevokeWindow(constants, saved), true);
    assert.ok(Number.isFinite(constants.REVOKE_WINDOW) && constants.REVOKE_WINDOW >= 10 * 365 * 24 * 3600);
    assert.ok(Number.isFinite(constants.REVOKE_WINDOW_RECEIVER_MARGIN) && constants.REVOKE_WINDOW_RECEIVER_MARGIN >= 10 * 365 * 24 * 3600);
    assert.strictEqual(constants.NEWSLETTER_REVOKE_WINDOW, 1000);
    assert.deepStrictEqual({ ...saved }, { REVOKE_WINDOW: 216000, REVOKE_WINDOW_RECEIVER_MARGIN: 43200 });
});

test("applying twice keeps the first originals; restore puts them back", () => {
    const s = load();
    const constants = { REVOKE_WINDOW: 216000, REVOKE_WINDOW_RECEIVER_MARGIN: 43200 };
    const saved = {};
    s.applyRevokeWindow(constants, saved);
    s.applyRevokeWindow(constants, saved);
    assert.strictEqual(saved.REVOKE_WINDOW, 216000);
    s.restoreRevokeWindow(constants, saved);
    assert.deepStrictEqual({ ...constants }, { REVOKE_WINDOW: 216000, REVOKE_WINDOW_RECEIVER_MARGIN: 43200 });
});

test("missing module or odd values never throw", () => {
    const s = load();
    assert.strictEqual(s.applyRevokeWindow(null, {}), false);
    assert.strictEqual(s.restoreRevokeWindow(undefined, {}), false);
    const constants = { REVOKE_WINDOW: "x" };
    assert.strictEqual(s.applyRevokeWindow(constants, {}), true);
    assert.strictEqual(constants.REVOKE_WINDOW, "x");
});

test("the option exists, defaults to off, and has a settings row", () => {
    const s = loadScripts(createSandbox(), ["core/options_schema.js"]);
    const entry = [...s.OPTIONS_SCHEMA].find((o) => o.key == "deleteForEveryoneAnyTime");
    assert.ok(entry && entry.type == "bool" && entry.default === false);
    const code = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "core", "settings_dialog.js"), "utf8");
    assert.ok(/key: "deleteForEveryoneAnyTime"/.test(code));
    const injection = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "core_injection.js"), "utf8");
    assert.ok(injection.includes("core/revoke_window.js"));
});

test("an options update applies its own value, even before injected_ui.js has merged it", () => {
    const s = load();
    const constants = { REVOKE_WINDOW: 216000, REVOKE_WINDOW_RECEIVER_MARGIN: 43200 };
    s.require = () => constants;
    s.window.WAIncognitoOptions = { deleteForEveryoneAnyTime: false }; // the stale value
    s.syncRevokeWindow(0, true);
    assert.ok(constants.REVOKE_WINDOW >= 10 * 365 * 24 * 3600);
    s.syncRevokeWindow(0, false);
    assert.strictEqual(constants.REVOKE_WINDOW, 216000);
});
