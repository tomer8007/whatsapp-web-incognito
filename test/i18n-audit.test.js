const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const load = () => loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js"]);
const LANGUAGES = ["id", "en", "es", "pt-BR", "fr", "de", "ru", "tr", "ar", "hi", "ja", "zh-CN"];

// A translation may equal the English text only for words that really are the same there (cognates, brand names, units, short tokens).
// Everything else must be translated. Add an entry here only after checking that the word is correct in that language.
const SAME_AS_ENGLISH = {
    "cat.notifications": ["fr"],
    "cat.messages": ["fr"],
    "cat.vault": ["id"],
    "common.no": ["es"],
    "common.ok": ["id","pt-BR","fr","de","ru","ja"],
    "contact.globalNow": ["id","es","pt-BR","de"],
    "contact.person": ["fr"],
    "contacts.count": ["es","de"],
    "diag.status": ["id","pt-BR","de"],
    "edit.original": ["es","pt-BR","fr","de"],
    "edit.version": ["fr","de"],
    "hidetag.title": ["id","es","pt-BR","fr","de","ru","tr","ar","hi","ja","zh-CN"],
    "lock.minutes": ["id","es","pt-BR","fr"],
    "lock.passcode": ["id"],
    "lock.placeholder": ["id"],
    "restore.contactName": ["de"],
    "sched.chat": ["id","es","de"],
    "sched.placeholder": ["fr"],
    "sec.audio": ["id","es","fr","de"],
    "sec.blur": ["id"],
    "sec.contacts": ["es","de"],
    "sec.hidetag": ["id","es","pt-BR","fr","de","ru","tr","ar","hi","ja","zh-CN"],
    "sec.status": ["id","pt-BR","de"],
    "status.progress": ["id","es","pt-BR","fr","de","ru","tr","ar","hi","ja","zh-CN"],
    "unit.mb": ["id","es","pt-BR","de","tr","hi","ja","zh-CN"],
    "unit.minutes": ["fr"],
    "vault.unlock.placeholder": ["id","de"],
};

test("every language has every key, non-empty, with the same placeholders", () => {
    const s = load();
    const en = s.I18N_DICT.en;
    for (const code of LANGUAGES) {
        const dict = s.I18N_DICT[code];
        assert.ok(dict, code);
        assert.deepStrictEqual(Object.keys(dict).sort(), Object.keys(en).sort(), code + " keys differ from en");
        for (const [key, text] of Object.entries(dict)) {
            assert.ok(typeof text == "string" && text.trim() !== "", code + " " + key + " is empty");
            const placeholders = (value) => (value.match(/\{\w+\}/g) || []).sort().join();
            assert.strictEqual(placeholders(text), placeholders(en[key]), code + " " + key + " placeholders");
        }
    }
});

test("no translation is just the English text, unless that exact (key, language) pair is a known cognate", () => {
    const s = load();
    const en = s.I18N_DICT.en;
    const offenders = [];
    for (const code of LANGUAGES.filter((c) => c != "en")) {
        for (const [key, text] of Object.entries(s.I18N_DICT[code])) {
            if (text === en[key] && !(SAME_AS_ENGLISH[key] || []).includes(code)) offenders.push(code + " " + key);
        }
    }
    assert.deepStrictEqual(offenders, []);
    for (const [key, codes] of Object.entries(SAME_AS_ENGLISH)) {
        for (const code of codes) assert.strictEqual(s.I18N_DICT[code][key], en[key], "allowlist entry no longer needed: " + code + " " + key);
    }
});

test("non-Latin languages really use their own script", () => {
    const s = load();
    const scripts = { ar: /[؀-ۿ]/, hi: /[ऀ-ॿ]/, ja: /[぀-ヿ一-鿿]/, "zh-CN": /[一-鿿]/, ru: /[Ѐ-ӿ]/ };
    for (const [code, re] of Object.entries(scripts)) {
        for (const [key, text] of Object.entries(s.I18N_DICT[code])) {
            if ((SAME_AS_ENGLISH[key] || []).includes(code)) continue;
            assert.ok(re.test(text), code + " " + key + " has no " + code + " characters");
        }
    }
});

// ---- which keys the code uses ----

function sourceFiles() {
    return fs.readdirSync(path.join(ROOT, "core")).filter((f) => f.endsWith(".js") && !f.startsWith("i18n")).map((f) => "core/" + f).concat(["background.js"]);
}

test("every translation key used by the code exists, and no key in the dictionary is unused", () => {
    const s = load();
    const code = sourceFiles().map(read).join("\n");
    const settings = loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/modal.js", "core/settings_dialog.js"]);
    const shown = new Set();
    const used = new Set();
    for (const c of settings.SETTINGS_CATEGORIES) {
        used.add("cat." + c.id); used.add("cat." + c.id + ".intro");
        for (const sec of c.sections) for (const item of sec.items) for (const k of settings.settingsItemKeys(item)) shown.add(k);
    }
    for (const k of shown) { used.add("opt." + k); used.add("opt." + k + ".desc"); }
    for (const m of code.matchAll(/"([a-z][A-Za-z0-9]*(?:\.[A-Za-z0-9]+)+)"/g)) used.add(m[1]);
    const prefixes = /^(cat|opt|sec|note|act|lock|vault|edit|eph|contact|contacts|hidetag|sched|rcpt|overdue|receipt|status|toast|diag|restore|device|viewonce|intercept|broken|markRead|menu|common|lang|settings|header|nav|err|extension|copt|seg|state|unit|deleted)\./;
    const missing = [...used].filter((k) => prefixes.test(k) && !(k in s.I18N_DICT.en));
    assert.deepStrictEqual(missing, [], "keys used by the code but not in the dictionary");
    const unused = Object.keys(s.I18N_DICT.en).filter((k) => !used.has(k));
    assert.deepStrictEqual(unused, [], "keys in the dictionary that no code uses");
});

// ---- hard-coded text anywhere ----

// Files that never produce text for the user (protocol, crypto, parsing)
const NON_UI = new Set(["core/comms_worker_fix.js", "core/ws_hook.js", "core/multi_device.js", "core/utils.js", "core/vault.js", "core/ui_class_names.js", "core/receipt_scheduler.js"]);

const ASSIGNMENTS = [
    /(?:textContent|innerHTML|innerText|\.title|\.placeholder|\.alt|document\.title)\s*=\s*"((?:[^"\\]|\\.)*)"/g,
    /setAttribute\(\s*"(?:aria-label|title|placeholder|alt)"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
    /(?:[{,]|^)\s*(?:title|text|html|confirmButtonText|cancelButtonText|denyButtonText|inputPlaceholder|label|detail|message)\s*:\s*"((?:[^"\\]|\\.)*)"/gm,
    /(?:alert|confirm|prompt)\(\s*"((?:[^"\\]|\\.)*)"/g,
];

// brand names that are the same everywhere
const ALLOWED_LITERALS = new Set(["WAIncognito", "Hidetag"]);

function visibleLetters(literal) {
    return literal.replace(/<[^>]*>?/g, "").replace(/&\w+;/g, "").replace(/[^A-Za-zÀ-ɏЀ-ӿ؀-ۿऀ-ॿ぀-ヿ一-鿿]/g, "");
}

function findHardcoded(code) {
    const found = [];
    for (const re of ASSIGNMENTS) {
        for (const m of code.matchAll(re)) {
            const literal = m[1];
            if (ALLOWED_LITERALS.has(literal.trim())) continue;
            if (visibleLetters(literal).length >= 3) found.push(literal);
        }
    }
    return found;
}

test("no file hard-codes text for the user: every visible string goes through t()", () => {
    const problems = [];
    for (const file of sourceFiles().filter((f) => !NON_UI.has(f))) {
        for (const literal of findHardcoded(read(file))) problems.push(file + ": " + literal.slice(0, 60));
    }
    assert.deepStrictEqual(problems, []);
});

test("the checker catches a hard-coded label in any language", () => {
    assert.deepStrictEqual(findHardcoded('button.textContent = "Speichern";'), ["Speichern"]);
    assert.deepStrictEqual(findHardcoded('x.setAttribute("aria-label", "Close dialog");'), ["Close dialog"]);
    assert.deepStrictEqual(findHardcoded('WAModal.fire({ title: "Bonjour le monde" });'), ["Bonjour le monde"]);
    assert.deepStrictEqual(findHardcoded('el.title = "Закрыть";'), ["Закрыть"]);
    assert.deepStrictEqual(findHardcoded('button.textContent = t("common.cancel");'), []);
    assert.deepStrictEqual(findHardcoded('el.textContent = "";'), []);
});

test("no source file contains letters of another language outside the translations (code and comments stay English)", () => {
    // Words WhatsApp itself shows ("Edited" in 12 languages) and the native language names of the picker are the only exceptions.
    const ALLOWED_FILES = new Set(["core/i18n.js"]);
    const ALLOWED_SNIPPETS = ["EDITED_LABEL_WORDS"];
    const problems = [];
    for (const file of sourceFiles().concat(["styles.css", "manifest.json"])) {
        if (ALLOWED_FILES.has(file)) continue;
        read(file).split("\n").forEach((line, index) => {
            if (ALLOWED_SNIPPETS.some((s) => line.includes(s))) return;
            if (/[^\x00-\x7F]/.test(line.replace(/[\u00B7\u2013\u2014\u2018\u2019\u201C\u201D\u2026\u2192\u2713\u2715\u00D7\u2122\u00A0\uFEFF]/g, ""))) problems.push(file + ":" + (index + 1) + ": " + line.trim().slice(0, 70));
        });
    }
    assert.deepStrictEqual(problems, []);
});

test("CSS content strings carry no text of their own, and the manifest takes its texts from _locales", () => {
    const css = read("styles.css");
    for (const m of css.matchAll(/(?<![-\w])content:\s*([^;]+);/g)) {
        const value = m[1].trim();
        assert.ok(value === '""' || /^var\(--incognito-deleted-label/.test(value) || /^attr\(/.test(value), "CSS content: " + value);
    }
    const manifest = JSON.parse(read("manifest.json"));
    assert.strictEqual(manifest.name, "__MSG_extName__");
    assert.strictEqual(manifest.description, "__MSG_extDescription__");
    assert.strictEqual(manifest.default_locale, "en");
});

test("every language has the extension texts in _locales", () => {
    const folders = ["id", "en", "es", "pt_BR", "fr", "de", "ru", "tr", "ar", "hi", "ja", "zh_CN"];
    const en = JSON.parse(read("_locales/en/messages.json"));
    for (const folder of folders) {
        const messages = JSON.parse(read("_locales/" + folder + "/messages.json"));
        assert.deepStrictEqual(Object.keys(messages).sort(), Object.keys(en).sort(), folder);
        for (const key of ["extDescription", "extActionTitle"]) {
            assert.ok(messages[key].message.trim() !== "", folder + " " + key);
            if (folder != "en") assert.notStrictEqual(messages[key].message, en[key].message, folder + " " + key + " is not translated");
        }
    }
});

test("language choices: the schema and the picker agree, and auto detection maps the usual browser tags", () => {
    const s = load();
    const choices = s.OPTIONS_SCHEMA.find((o) => o.key == "language").choices;
    assert.deepStrictEqual([...choices], ["auto", ...s.I18N_LANGUAGES.map((l) => l.code)]);
    const expectations = { "en-US": "en", "en-GB": "en", "id-ID": "id", "pt": "pt-BR", "pt-PT": "pt-BR", "pt-BR": "pt-BR", "zh": "zh-CN", "zh-TW": "zh-CN", "zh-Hans-CN": "zh-CN",
                           "ar-SA": "ar", "hi-IN": "hi", "ja-JP": "ja", "de-CH": "de", "fr-CA": "fr", "es-MX": "es", "ru-RU": "ru", "tr-TR": "tr", "xx": "en" };
    for (const [tag, code] of Object.entries(expectations)) assert.strictEqual(s.resolveLanguage("auto", [tag]), code, tag);
});

test("a missing key falls back to English, then to the key itself; numbers follow the language", () => {
    const s = load();
    s.setLanguage("fr");
    delete s.I18N_DICT.fr["common.close"];
    assert.strictEqual(s.t("common.close"), "Close");
    assert.strictEqual(s.t("no.such.key"), "no.such.key");
    s.setLanguage("de");
    assert.strictEqual(s.formatNumber(1234.5, 2), "1.234,50");
    s.setLanguage("en");
    assert.strictEqual(s.formatNumber(1234.5, 2), "1,234.50");
});

test("no Indonesian words remain in code, comments, styles, tests or the manifest (the id language table is the only place for them)", () => {
    const WORDS = ["pesan", "kirim", "jadwal", "jadwalkan", "privasi", "kontak", "centang", "dihapus", "hapus", "simpan", "buka", "tidak", "yang", "untuk", "dengan", "sudah",
                   "belum", "grup", "ubah", "tampil", "tampilkan", "sembunyi", "sembunyikan", "kunci", "anggota", "aktif", "nonaktif", "ikuti", "tutup", "batal", "salah",
                   "dibaca", "terkirim", "terjadwal", "diedit", "sementara", "waktu", "menit", "hari", "jeda", "ketuk", "layar", "notifikasi", "utilitas", "diagnostik"];
    const re = new RegExp("\\b(" + WORDS.join("|") + ")\\b", "i");
    const files = sourceFiles().concat(["styles.css", "manifest.json", "core_injection.js", "README.md"])
        .concat(fs.readdirSync(path.join(ROOT, "test")).filter((f) => f.endsWith(".js") && f != "i18n-audit.test.js").map((f) => "test/" + f))
        .concat(fs.readdirSync(path.join(ROOT, "test/helpers")).map((f) => "test/helpers/" + f));
    const problems = [];
    for (const file of files) {
        read(file).split("\n").forEach((line, index) => {
            if (line.includes("EDITED_LABEL_WORDS")) return; // WhatsApp's own "Edited" word in 12 languages
            const m = line.match(re);
            if (m) problems.push(file + ":" + (index + 1) + " [" + m[1] + "] " + line.trim().slice(0, 70));
        });
    }
    assert.deepStrictEqual(problems, []);
});
