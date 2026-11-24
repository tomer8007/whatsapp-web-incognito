const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js"]);
}

test("English is the only dictionary, and no option or helper selects a language", () => {
    const s = load();
    assert.deepStrictEqual(Object.keys(s.I18N_DICT), ["en"]);
    assert.ok(![...s.OPTIONS_SCHEMA].some((o) => o.key == "language"));
    for (const name of ["setLanguage", "getLanguage", "resolveLanguage", "isRtlLanguage", "I18N_LANGUAGES", "formatNumber"]) assert.strictEqual(typeof s[name], "undefined", name);
});

test("t fills placeholders and falls back to the key itself", () => {
    const s = load();
    assert.strictEqual(s.t("common.cancel"), "Cancel");
    assert.strictEqual(s.t("toast.delete"), "Message deleted");
    assert.strictEqual(s.t("sched.done", { time: "10:00" }), s.I18N_DICT.en["sched.done"].replace("{time}", "10:00"));
    assert.strictEqual(s.t("no.such.key"), "no.such.key");
    assert.strictEqual(s.t("sched.done", { other: 1 }), s.I18N_DICT.en["sched.done"], "an unknown placeholder is left as it is");
});

test("every text has content and balanced placeholders, with no emoji (toasts and snackbars are plain text)", () => {
    const s = load();
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const [key, text] of Object.entries(s.I18N_DICT.en)) {
        assert.ok(typeof text == "string" && text.trim() !== "", key + " is empty");
        assert.ok(!emoji.test(text), key);
        assert.strictEqual((text.match(/\{/g) || []).length, (text.match(/\}/g) || []).length, key + " placeholders");
    }
});
