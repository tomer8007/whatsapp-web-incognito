const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const load = () => loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js"]);
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
    const prefixes = /^(cat|opt|sec|note|act|vault|edit|eph|contact|contacts|hidetag|sched|rcpt|overdue|receipt|status|toast|diag|restore|device|viewonce|intercept|broken|markRead|quick|menu|common|settings|header|nav|err|extension|copt|seg|state|unit|deleted)\./;
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
    // Words WhatsApp itself shows ("Edited" in 12 languages) are the only exception.
    const ALLOWED_FILES = new Set();
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

test("every language has the extension texts in _locales (Chrome localizes the extension name and description)", () => {
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

test("no Indonesian words remain in code, comments, styles, tests or the manifest ", () => {
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
