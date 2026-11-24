const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function loadSchema() {
    return loadScripts(createSandbox(), ["core/options_schema.js"]);
}

const EXPECTED_DEFAULTS = {
    // existing options (same defaults as before)
    onlineUpdatesHook: false,
    typingUpdatesHook: false,
    readConfirmationsHook: true,
    showReadWarning: true,
    safetyDelay: 0,
    saveDeletedMsgs: false,
    showDeviceTypes: true,
    autoReceiptOnReplay: true,
    allowStatusDownload: true,
    // new options
    toastOnDelete: false,
    toastOnEdit: false,
    saveEdits: false,
    deleteForEveryoneAnyTime: false,
    keepDisappearing: false,
    saveDeletedStatus: false,
    vaultRetentionDays: 90,
    vaultMaxMB: 500,
    blurChatList: false,
    blurMessages: false,
    blurMedia: false,
    blurAvatars: false,
    language: "en",
    hidetagEnabled: false,
    voiceNoteRate: 1,
};

test("every schema key is unique", () => {
    const sandbox = loadSchema();
    const keys = sandbox.OPTIONS_SCHEMA.map((o) => o.key);
    assert.strictEqual(new Set(keys).size, keys.length);
});

test("defaultOptions() matches the spec table", () => {
    const sandbox = loadSchema();
    assert.deepStrictEqual({ ...sandbox.defaultOptions() }, EXPECTED_DEFAULTS);
});

test("every entry has a valid type and default, and carries no display text", () => {
    const sandbox = loadSchema();
    for (const entry of sandbox.OPTIONS_SCHEMA) {
        assert.deepStrictEqual(Object.keys(entry).filter((k) => !["key", "type", "default", "choices"].includes(k)), [], entry.key + " has extra fields");
        assert.ok(["bool", "number", "enum"].includes(entry.type), entry.key + " has bad type");
        if (entry.type === "bool") assert.strictEqual(typeof entry.default, "boolean", entry.key);
        if (entry.type === "number") assert.strictEqual(typeof entry.default, "number", entry.key);
        if (entry.type === "enum") assert.ok(entry.choices.includes(entry.default), entry.key);
    }
});

test("voiceNoteRate offers exactly the spec choices", () => {
    const sandbox = loadSchema();
    const entry = sandbox.OPTIONS_SCHEMA.find((o) => o.key === "voiceNoteRate");
    assert.deepStrictEqual([...entry.choices], [0.75, 1, 1.25, 1.5, 2, 2.5, 3]);
});

test("parseOptionValue converts menu input values to the schema type", () => {
    const sandbox = loadSchema();
    assert.strictEqual(sandbox.parseOptionValue("voiceNoteRate", "1.5"), 1.5);
    assert.strictEqual(sandbox.parseOptionValue("vaultMaxMB", "250"), 250);
    assert.strictEqual(sandbox.parseOptionValue("vaultMaxMB", "abc"), 500, "invalid number falls back to default");
    assert.strictEqual(sandbox.parseOptionValue("voiceNoteRate", "7"), 1, "unknown choice falls back to default");
});
