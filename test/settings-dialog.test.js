const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/modal.js", "core/settings_dialog.js"]);
}

test("the settings popup has the nine categories in order, named in English", () => {
    const s = load();
    assert.deepStrictEqual([...s.SETTINGS_CATEGORIES.map((c) => s.t("cat." + c.id))],
        ["Privacy", "Per-contact privacy", "Messages", "Notifications", "Screen", "Vault", "Scheduling", "Utilities", "Diagnostics"]);
});

test("every option of the schema is in exactly one category (safetyDelay has been hidden since the old menu)", () => {
    const { SETTINGS_CATEGORIES, OPTIONS_SCHEMA, settingsItemKeys } = load();
    const used = [];
    for (const c of SETTINGS_CATEGORIES) for (const s of c.sections) for (const i of s.items) used.push(...settingsItemKeys(i));
    assert.strictEqual(new Set(used).size, used.length, "an option appears twice");
    const expected = OPTIONS_SCHEMA.map((e) => e.key).filter((k) => k !== "safetyDelay");
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

test("only the Mark as read confirmation uses SweetAlert (as on master), nothing uses the Drop menu, and the manifest loads the new files", () => {
    for (const file of ["core/ui.js", "core/toast.js", "core/status_download.js", "core/privacy_screen.js"]) {
        const code = fs.readFileSync(path.join(ROOT, file), "utf8");
        const swalCalls = (code.match(/\bSwal\./g) || []).length;
        assert.strictEqual(swalCalls, file == "core/ui.js" ? 1 : 0, file + " Swal calls");
        assert.ok(!/new Drop\(/.test(code), file + " uses Drop");
    }
    const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, "manifest.json"), "utf8"));
    const scripts = manifest.content_scripts[1].js;
    assert.ok(scripts.indexOf("core/modal.js") > -1 && scripts.indexOf("core/modal.js") < scripts.indexOf("core/settings_dialog.js"));
    assert.ok(scripts.indexOf("core/settings_dialog.js") < scripts.indexOf("core/ui.js"));
    assert.deepStrictEqual([...manifest.permissions], ["storage"]);
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

test("per-contact page: every key has a label and description in English and a rule schema entry", () => {
    const s = load();
    const rules = loadScripts(createSandbox(), ["core/contact_rules.js"]);
    const keys = s.contactSectionKeys();
    assert.deepStrictEqual([...keys].sort(), [...rules.CONTACT_RULE_FIELDS].sort(), "the page covers exactly the schema keys");
    for (const section of s.CONTACT_SECTIONS) {
        assert.ok(section.titleKey);
        for (const item of section.items) {
            assert.ok(s.I18N_DICT.en[item.labelKey], item.labelKey);
            assert.ok(s.I18N_DICT.en[item.descKey], item.descKey);
            if (item.choiceLabels) for (const k of Object.values(item.choiceLabels)) assert.ok(s.I18N_DICT.en[k], k);
        }
    }
});

test("segmented states map to stored values (read receipts and typing keep block/allow)", () => {
    const s = load();
    const block = { kind: "blockAllow" }, onoff = { kind: "onOff" };
    assert.deepStrictEqual([["default"], ["on"], ["off"]].map(([st]) => s.contactValueOf(block, st)), ["default", "block", "allow"]);
    assert.deepStrictEqual([["default"], ["on"], ["off"]].map(([st]) => s.contactValueOf(onoff, st)), ["default", "on", "off"]);
    assert.deepStrictEqual(["default", "block", "allow"].map((v) => s.contactStateOf(block, v)), ["default", "on", "off"]);
    assert.deepStrictEqual(["default", "on", "off"].map((v) => s.contactStateOf(onoff, v)), ["default", "on", "off"]);
});

test("contact list: custom first, filters, search, paging, placeholder avatar", () => {
    const s = load();
    const rules = loadScripts(createSandbox(), ["core/contact_rules.js"]);
    Object.assign(s, { countContactRules: rules.countContactRules });
    const mk = (name, jid, isGroup) => ({ name, jids: [jid], isGroup: !!isGroup });
    const all = [mk("Ani", "1@c.us"), mk("Budi", "2@c.us"), mk("Kelas", "3@g.us", true), mk("Candra", "4@c.us")];
    const ruleSet = { "4@c.us": { typing: "block" }, "3@g.us": { saveEdits: "on", toastOnEdit: "on" } };
    const names = (list) => [...list.shown.map((c) => c.name)];
    assert.deepStrictEqual(names(s.filterContactList(all, ruleSet, "", "all", 10)), ["Kelas", "Candra", "Ani", "Budi"], "custom first, then WhatsApp order");
    assert.deepStrictEqual(names(s.filterContactList(all, ruleSet, "", "custom", 10)), ["Kelas", "Candra"]);
    assert.deepStrictEqual(names(s.filterContactList(all, ruleSet, "", "groups", 10)), ["Kelas"]);
    assert.deepStrictEqual(names(s.filterContactList(all, ruleSet, "", "people", 10)), ["Candra", "Ani", "Budi"]);
    assert.deepStrictEqual(names(s.filterContactList(all, ruleSet, " an ", "all", 10)), ["Candra", "Ani"]);
    const paged = s.filterContactList(all, ruleSet, "", "all", 2);
    assert.deepStrictEqual([paged.shown.length, paged.total], [2, 4]);
    assert.strictEqual(s.contactAvatar("budi").letter, "B");
    assert.strictEqual(s.contactAvatar("budi").hue, s.contactAvatar("budi").hue);
    assert.strictEqual(s.contactAvatar("").letter, "?");
    assert.strictEqual(s.contactSummaryCount(all[2], ruleSet), 2);
});

test("routing: a chat context opens its detail page, a category id or nothing opens a normal page", () => {
    const { resolveSettingsRoute, SETTINGS_CATEGORIES } = load();
    const first = SETTINGS_CATEGORIES[0].id;
    const person = { name: "Budi", jids: ["1@c.us", "9@lid"], primaryJid: "1@c.us", isGroup: false };
    const group = { name: "Kelas", jids: ["1203@g.us"], primaryJid: "1203@g.us", isGroup: true };
    const plain = (route) => ({ category: route.category, contact: route.contact });
    assert.deepStrictEqual(plain(resolveSettingsRoute({ category: "contacts", contact: person }, first)), { category: "contacts", contact: person });
    assert.deepStrictEqual(plain(resolveSettingsRoute({ contact: group }, first)), { category: "contacts", contact: group }, "a contact alone still lands in contacts");
    assert.strictEqual(resolveSettingsRoute({ category: "vault", contact: person }, first).category, "contacts", "a contact always means its page");
    // the list path and the generic entry points are unchanged
    assert.deepStrictEqual(plain(resolveSettingsRoute("contacts", first)), { category: "contacts", contact: null });
    assert.deepStrictEqual(plain(resolveSettingsRoute("screen", first)), { category: "screen", contact: null });
    assert.deepStrictEqual(plain(resolveSettingsRoute(undefined, first)), { category: first, contact: null });
    assert.deepStrictEqual(plain(resolveSettingsRoute({ category: "vault" }, first)), { category: "vault", contact: null });
    assert.deepStrictEqual(plain(resolveSettingsRoute({}, first)), { category: first, contact: null });
});

test("the dialog keeps the preselected contact on the first render, offers a visible way back, and the header button has a silent list fallback", () => {
    const fs = require("node:fs"), path = require("node:path");
    const { ROOT } = require("./helpers/sandbox");
    const dialog = fs.readFileSync(path.join(ROOT, "core/settings_dialog.js"), "utf8");
    assert.ok(/select\(initialCategory, !!initialContact\)/.test(dialog), "the first select must keep the contact");
    assert.ok(/crumb\.lastChild\.textContent = t\("contact\.allContacts"\)/.test(dialog));
    assert.ok(/crumb\.addEventListener\("click", function\(\) \{ select\("contacts"\); \}\)/.test(dialog), "back goes to the list");
    const ui = fs.readFileSync(path.join(ROOT, "core/ui.js"), "utf8");
    assert.ok(/if \(context\) openContactPrivacyModal\(context\);[^\n]*\n\s*else openSettingsDialog\("contacts"\);/.test(ui));
    assert.ok(!/header\.noChat/.test(ui), "no error popup when the chat cannot be resolved");
});

test("the header button text says what it does", () => {
    const s = load();
    assert.strictEqual(s.I18N_DICT.en["header.button"], "Privacy settings for this chat");
    assert.ok(s.I18N_DICT.en["contact.allContacts"]);
});

test("the incognito icon opens the small popup with quick switches, which ends with a More button for the full settings", () => {
    const ui = fs.readFileSync(path.join(ROOT, "core/ui.js"), "utf8");
    assert.ok(/menuItemElem\.addEventListener\("click", function\(\) \{ openQuickSettings\(menuItemElem\); \}\)/.test(ui), "the icon opens the small popup");
    assert.ok(!/menuItemElem\.addEventListener\("click", function\(\) \{ openSettingsDialog\(\)/.test(ui));
    assert.ok(/QUICK_SETTINGS_KEYS = \["readConfirmationsHook", "onlineUpdatesHook", "typingUpdatesHook", "saveDeletedMsgs"\]/.test(ui));
    assert.ok(/more\.addEventListener\("click", function\(\) \{ close\(\); openSettingsDialog\(\); \}\)/.test(ui));
    const s = load();
    for (const key of ["readConfirmationsHook", "onlineUpdatesHook", "typingUpdatesHook", "saveDeletedMsgs"]) {
        assert.ok(s.I18N_DICT.en["opt." + key], key);
        assert.ok([...s.OPTIONS_SCHEMA].some((o) => o.key == key && o.type == "bool"), key);
    }
    assert.strictEqual(s.t("quick.more"), "More…");
});
