const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/modal.js", "core/settings_dialog.js"]);
}

test("the settings popup has the nine categories in order, named in Indonesian by default", () => {
    const s = load();
    s.setLanguage("id");
    assert.deepStrictEqual([...s.SETTINGS_CATEGORIES.map((c) => s.t("cat." + c.id))],
        ["Privasi", "Privasi per kontak", "Pesan", "Notifikasi", "Layar & Kunci", "Vault", "Penjadwalan", "Utilitas", "Diagnostik"]);
});

test("every option of the schema is in exactly one category (safetyDelay has been hidden since the old menu)", () => {
    const { SETTINGS_CATEGORIES, OPTIONS_SCHEMA, settingsItemKeys } = load();
    const used = [];
    for (const c of SETTINGS_CATEGORIES) for (const s of c.sections) for (const i of s.items) used.push(...settingsItemKeys(i));
    assert.strictEqual(new Set(used).size, used.length, "an option appears twice");
    const expected = OPTIONS_SCHEMA.map((e) => e.key).filter((k) => k !== "safetyDelay" && k !== "language");
    assert.deepStrictEqual([...used].sort(), [...expected].sort());
});

test("controls match the option types and every action has a handler", () => {
    const { SETTINGS_CATEGORIES, OPTIONS_SCHEMA, settingsActions } = load();
    const type = (key) => OPTIONS_SCHEMA.find((e) => e.key === key).type;
    const controlFor = { bool: "toggle", number: "number", enum: "select" };
    for (const c of SETTINGS_CATEGORIES) for (const s of c.sections) for (const i of s.items) {
        if (i.key) assert.strictEqual(i.type, controlFor[type(i.key)], i.key);
        if (i.type === "action") assert.strictEqual(typeof settingsActions[i.action], "function", i.action);
    }
});

test("every item icon exists", () => {
    const { SETTINGS_CATEGORIES, SETTINGS_ICONS } = load();
    for (const c of SETTINGS_CATEGORIES) {
        assert.ok(SETTINGS_ICONS[c.icon], c.id);
        for (const s of c.sections) for (const i of s.items) if (i.icon) assert.ok(SETTINGS_ICONS[i.icon], i.icon);
    }
});

test("focus trap wraps around in both directions", () => {
    const { WAModal } = load();
    assert.strictEqual(WAModal.nextFocusIndex(3, 2, false), 0);
    assert.strictEqual(WAModal.nextFocusIndex(3, 0, true), 2);
    assert.strictEqual(WAModal.nextFocusIndex(3, 1, false), 2);
    assert.strictEqual(WAModal.nextFocusIndex(3, -1, false), 0);
    assert.strictEqual(WAModal.nextFocusIndex(3, -1, true), 2);
    assert.strictEqual(WAModal.nextFocusIndex(0, -1, false), -1);
});

test("SweetAlert-style widths map to a modal size", () => {
    const { WAModal } = load();
    assert.strictEqual(WAModal.sizeForWidth(undefined), "md");
    assert.strictEqual(WAModal.sizeForWidth(600), "md");
    assert.strictEqual(WAModal.sizeForWidth(760), "lg");
});

test("no feature code still calls SweetAlert or the Drop menu, and the manifest loads the new files", () => {
    for (const file of ["core/ui.js", "core/toast.js", "core/status_download.js", "core/privacy_screen.js"]) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        assert.ok(!/\bSwal\./.test(code), file + " uses Swal");
        assert.ok(!/new Drop\(/.test(code), file + " uses Drop");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const scripts = manifest.content_scripts[1].js;
    assert.ok(scripts.indexOf("core/modal.js") > -1 && scripts.indexOf("core/modal.js") < scripts.indexOf("core/settings_dialog.js"));
    assert.ok(scripts.indexOf("core/settings_dialog.js") < scripts.indexOf("core/ui.js"));
    assert.deepStrictEqual([...manifest.permissions], ["storage"]);
});

test("lock idle presets: 1, 5, 10, 15, 30 or custom", () => {
    const { lockIdleChoice } = load();
    assert.deepStrictEqual([1, 5, 10, 15, 30, 7, 0].map(lockIdleChoice), ["1", "5", "10", "15", "30", "custom", "custom"]);
});

test("contacts: custom-rule indicator and search", () => {
    const { contactHasCustomRule, filterContacts } = load();
    const ctx = { name: "Budi", jids: ["1@c.us", "9@lid"] };
    assert.strictEqual(contactHasCustomRule(ctx, {}), false);
    assert.strictEqual(contactHasCustomRule(ctx, { "1@c.us": { readReceipts: "default", typing: "default" } }), false);
    assert.strictEqual(contactHasCustomRule(ctx, { "9@lid": { typing: "block" } }), true);
    const all = [{ name: "Budi" }, { name: "Siti" }, { name: "budiman" }];
    const found = filterContacts(all, " BUD ", 10);
    assert.deepStrictEqual([found.total, found.shown.map((c) => c.name)], [2, ["Budi", "budiman"]]);
    assert.strictEqual(filterContacts(all, "", 2).shown.length, 2);
    assert.strictEqual(filterContacts(all, "", 2).total, 3);
});
