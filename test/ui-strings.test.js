const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { ROOT } = require("./helpers/sandbox");

const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");

// Files that render text for the user. Every visible string must come from t() (core/i18n_strings.js).
const UI_FILES = ["core/ui.js", "core/modal.js", "core/settings_dialog.js", "core/privacy_screen.js", "core/toast.js",
                  "core/status_download.js", "core/extension_guard.js", "core/injected_ui.js", "core/diagnostics.js"];

// strings that are fine as they are: brand names, symbols, technical tokens
const ALLOWED = new Set(["WAIncognito", "Hidetag", "OK"]);

function visibleLetters(literal) {
    return literal.replace(/<[^>]*>?/g, "").replace(/&\w+;/g, "").replace(/[^A-Za-zÀ-ɏЀ-ӿ]/g, "");
}

function findHardcoded(code) {
    const found = [];
    const patterns = [
        /(?:textContent|innerHTML|innerText|\.title|\.placeholder|\.alt)\s*=\s*"((?:[^"\\]|\\.)*)"/g,
        /setAttribute\(\s*"(?:aria-label|title|placeholder)"\s*,\s*"((?:[^"\\]|\\.)*)"/g,
        /\b(?:title|text|html|confirmButtonText|cancelButtonText|denyButtonText|inputPlaceholder|label)\s*:\s*"((?:[^"\\]|\\.)*)"/g,
    ];
    for (const re of patterns) {
        for (const m of code.matchAll(re)) {
            const literal = m[1];
            if (ALLOWED.has(literal.trim())) continue;
            if (visibleLetters(literal).length >= 3) found.push(literal);
        }
    }
    return found;
}

test("no user-visible string literal is hard-coded in the UI files (everything goes through t())", () => {
    const problems = [];
    for (const file of UI_FILES) {
        for (const literal of findHardcoded(read(file))) problems.push(file + ": " + literal.slice(0, 60));
    }
    assert.deepStrictEqual(problems, []);
});

test("the checker itself catches a hard-coded label", () => {
    assert.deepStrictEqual(findHardcoded('button.textContent = "Speichern";'), ["Speichern"]);
    assert.deepStrictEqual(findHardcoded('x.setAttribute("aria-label", "Close dialog");'), ["Close dialog"]);
    assert.deepStrictEqual(findHardcoded('WAModal.fire({ title: "Halo dunia" });'), ["Halo dunia"]);
    assert.deepStrictEqual(findHardcoded('button.textContent = t("common.save");'), []);
    assert.deepStrictEqual(findHardcoded('el.textContent = "";'), []);
});

test("dates use the browser locale, not a fixed one", () => {
    for (const file of UI_FILES) {
        const code = read(file);
        assert.ok(!/toLocale(?:Date|Time)?String\(\s*"[a-z]{2}-[A-Z]{2}"/.test(code), file + " uses a fixed locale");
    }
});

// ---- colors ----

function colorLiteralsOutsideVariables(css) {
    let text = css.replace(/\/\*[\s\S]*?\*\//g, "");
    let previous;
    do { previous = text; text = text.replace(/var\([^()]*(\([^()]*\)[^()]*)*\)/g, "VAR"); } while (previous !== text);
    return [...new Set(text.match(/#[0-9a-fA-F]{3,8}\b|rgba?\([^)]*\)/g) || [])];
}

// Literals that are meant to stay: status colors, neutral shadows/borders, translucent tints, and the always-dark status viewer overlay.
const ALLOWED_COLORS = new Set([
    "#fff", "rgb(255, 255, 255)", "#f15c6d", "#f5a623", "#1a1a1a", "#53bdeb", "#0b141a",
    "rgba(0, 0, 0, 0.4)", "rgba(0, 0, 0, 0.45)", "rgba(11, 20, 26, 0.6)",
    "rgba(128, 128, 128, 0.2)", "rgba(128, 128, 128, 0.25)", "rgba(128, 128, 128, 0.4)", "rgba(128, 128, 128, 0.45)",
    "rgba(241, 92, 109, 0.12)", "rgba(241, 92, 109, 0.14)", "rgba(241, 92, 109, 0.2)",
    "rgba(33, 192, 99, 0.18)", "rgba(33, 192, 99, 0.2)",
    "rgba(255,0,0,0.3)", "rgba(9, 210, 97, 0.3)", "rgba(9, 210, 97, 1.0)", // unread counter blink // Mark as read buttons (master colors)
    "rgba(0,255,0,0.3)", "rgba(0,255,0,0.6)",
    "rgba(255,255,255,0.3)", "rgba(255,255,255,0.5)", "rgba(200, 40, 40, 0.9)", // status viewer overlay buttons
]);

test("our CSS takes surface, text and icon colors from WhatsApp's theme variables, with only deliberate literals left", () => {
    const css = read("styles.css");
    const stray = colorLiteralsOutsideVariables(css).filter((c) => !ALLOWED_COLORS.has(c));
    assert.deepStrictEqual(stray, []);
    // the theme-dependent colors of the popup come from variables
    for (const variable of ["--WDS-surface-default", "--WDS-content-default", "--WDS-content-deemphasized", "--WDS-accent", "--WDS-surface-highlight"]) {
        assert.ok(css.includes(variable), variable + " is not used");
    }
});

test("header and nav icons use WhatsApp's own strong icon color, and the toasts use theme variables", () => {
    const css = read("styles.css");
    const header = css.slice(css.indexOf(".incognito-header-button\n{"), css.indexOf(".incognito-header-icon"));
    assert.ok(/color:\s*var\(--WDS-content-default/.test(header));
    assert.ok(/\.menu-item-incognito[^{]*\{[^}]*var\(--WDS-content-default/.test(css));
    assert.ok(/\.incognito-toast\s*\{[^}]*var\(--WDS-surface-default/.test(css));
});
