const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js"]);
}

const CODES = ["id", "en", "es", "pt-BR", "fr", "de", "ru", "tr", "ar", "hi", "ja", "zh-CN"];

test("twelve languages are offered, Arabic is right-to-left", () => {
    const s = load();
    assert.deepStrictEqual([...s.I18N_LANGUAGES.map((l) => l.code)], CODES);
    assert.strictEqual(s.isRtlLanguage("ar"), true);
    assert.strictEqual(s.isRtlLanguage("en"), false);
});

test("every language has exactly the keys of English, with the same placeholders, and no empty text", () => {
    const s = load();
    const en = s.I18N_DICT.en;
    const enKeys = Object.keys(en).sort();
    for (const code of CODES) {
        const dict = s.I18N_DICT[code];
        assert.ok(dict, code + " is missing");
        assert.deepStrictEqual(Object.keys(dict).sort(), enKeys, code + " keys differ from en");
        for (const key of enKeys) {
            assert.ok(String(dict[key]).trim() !== "", code + " " + key + " is empty");
            const placeholders = (text) => (String(text).match(/\{\w+\}/g) || []).sort().join();
            assert.strictEqual(placeholders(dict[key]), placeholders(en[key]), code + " " + key + " placeholders");
        }
    }
});

test("no emoji in any translation (toasts and snackbars are plain text)", () => {
    const s = load();
    const emoji = /[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/u;
    for (const code of CODES) for (const [key, text] of Object.entries(s.I18N_DICT[code])) assert.ok(!emoji.test(text), code + " " + key);
});

// every key the code asks for, found by scanning the sources
function keysUsedBySource(schemaKeys) {
    const keys = new Set();
    const dir = path.join(ROOT, "core");
    for (const file of fs.readdirSync(dir)) {
        if (!file.endsWith(".js") || file.startsWith("i18n")) continue;
        const code = fs.readFileSync(path.join(dir, file), "utf8");
        for (const m of code.matchAll(/\bt\(\s*"([\w.\-]+)"/g)) keys.add(m[1]);
        for (const m of code.matchAll(/(?:titleKey|labelKey|descKey|textKey|unitKey|noteKey)\s*:\s*"([\w.\-]+)"/g)) keys.add(m[1]);
        for (const m of code.matchAll(/"(toast\.[A-Za-z]+)"/g)) keys.add(m[1]);
    }
    for (const key of schemaKeys) { keys.add("opt." + key); keys.add("opt." + key + ".desc"); }
    return keys;
}

test("every key used by the source exists in the dictionaries", () => {
    const s = load();
    const settings = loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/modal.js", "core/settings_dialog.js"]);
    const shown = new Set();
    for (const c of settings.SETTINGS_CATEGORIES) {
        keysOf: for (const sec of c.sections) for (const item of sec.items) for (const k of settings.settingsItemKeys(item)) shown.add(k);
        assert.ok(s.I18N_DICT.en["cat." + c.id] && s.I18N_DICT.en["cat." + c.id + ".intro"], c.id);
    }
    const used = keysUsedBySource([...shown]);
    const missing = [...used].filter((k) => !(k in s.I18N_DICT.en) && !/^(cat|opt)\.$/.test(k));
    assert.deepStrictEqual(missing, []);
});

test("resolveLanguage: explicit choice, browser language, regional variants, fallback to English", () => {
    const s = load();
    assert.strictEqual(s.resolveLanguage("de", ["id"]), "de");
    assert.strictEqual(s.resolveLanguage("auto", ["id-ID", "en"]), "id");
    assert.strictEqual(s.resolveLanguage("auto", ["pt-PT"]), "pt-BR");
    assert.strictEqual(s.resolveLanguage("auto", ["zh-TW"]), "zh-CN");
    assert.strictEqual(s.resolveLanguage("auto", ["fr-CA"]), "fr");
    assert.strictEqual(s.resolveLanguage("auto", ["xx"]), "en");
    assert.strictEqual(s.resolveLanguage("auto", []), "en");
    assert.strictEqual(s.resolveLanguage("klingon", ["ja"]), "ja");
});

test("t fills placeholders, falls back to English and then to the key", () => {
    const s = load();
    s.setLanguage("id");
    assert.strictEqual(s.t("toast.delete"), s.I18N_DICT.id["toast.delete"]);
    assert.notStrictEqual(s.t("toast.delete"), s.I18N_DICT.en["toast.delete"]);
    assert.strictEqual(s.t("sched.done", { time: "10:00" }), s.I18N_DICT.id["sched.done"].replace("{time}", "10:00"));
    s.I18N_DICT.id["only.en"] = undefined;
    s.I18N_DICT.en["only.en"] = "English only";
    delete s.I18N_DICT.id["only.en"];
    assert.strictEqual(s.t("only.en"), "English only");
    assert.strictEqual(s.t("no.such.key"), "no.such.key");
    s.setLanguage("en");
    assert.strictEqual(s.t("toast.delete"), "Message deleted");
});

test("language is a schema option with default auto, and English toasts have no emoji", () => {
    const s = load();
    assert.strictEqual(s.defaultOptions().language, "auto");
    assert.strictEqual(s.parseOptionValue("language", "pt-BR"), "pt-BR");
    assert.strictEqual(s.parseOptionValue("language", "zz"), "auto");
});
