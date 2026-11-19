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
    keepDisappearing: false,
    saveDeletedStatus: false,
    vaultRetentionDays: 90,
    vaultMaxMB: 500,
    blurChatList: false,
    blurMessages: false,
    blurMedia: false,
    blurAvatars: false,
    lockEnabled: false,
    lockIdleMinutes: 10,
    lockOnHidden: false,
    lockOnHiddenMinutes: 2,
    language: "auto",
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

test("every entry has a label, a group and a valid type", () => {
    const sandbox = loadSchema();
    for (const entry of sandbox.OPTIONS_SCHEMA) {
        assert.ok(entry.label, entry.key + " has no label");
        assert.ok(entry.group, entry.key + " has no group");
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

test("the menu renders one checkbox per new boolean option, grouped", () => {
    const sandbox = loadSchema();
    const html = sandbox.renderSchemaOptionsHTML(sandbox.defaultOptions());
    const newBools = sandbox.OPTIONS_SCHEMA.filter((o) => !o.legacy && o.type === "bool");
    const checkboxes = html.match(/class='checkbox checkbox-incognito/g) || [];
    assert.strictEqual(checkboxes.length, newBools.length);
    for (const o of newBools) assert.ok(html.includes(`data-option-key='${o.key}'`), o.key);
    for (const o of sandbox.OPTIONS_SCHEMA.filter((o) => o.legacy)) {
        assert.ok(!html.includes(`data-option-key='${o.key}'`), "legacy option rendered twice: " + o.key);
    }
    const groups = new Set(sandbox.OPTIONS_SCHEMA.filter((o) => !o.legacy).map((o) => o.group));
    for (const g of groups) assert.ok(html.includes(g), "missing group " + g);
});

test("parseOptionValue converts menu input values to the schema type", () => {
    const sandbox = loadSchema();
    assert.strictEqual(sandbox.parseOptionValue("voiceNoteRate", "1.5"), 1.5);
    assert.strictEqual(sandbox.parseOptionValue("vaultMaxMB", "250"), 250);
    assert.strictEqual(sandbox.parseOptionValue("vaultMaxMB", "abc"), 500, "invalid number falls back to default");
    assert.strictEqual(sandbox.parseOptionValue("voiceNoteRate", "7"), 1, "unknown choice falls back to default");
});
