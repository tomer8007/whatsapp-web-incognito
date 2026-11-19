//
// The main popup (isolated world): opened by the incognito icon in WhatsApp's left navigation.
// A left list of categories and a content panel (one column on narrow screens). Built on WAModal (core/modal.js).
// The data (SETTINGS_CATEGORIES) is plain and unit-tested: every option of core/options_schema.js is in exactly one category.
// The functions called at click time (setOptionFromMenu, openVaultModal, ...) are defined in core/ui.js.
//

// Feather-style 24x24 stroke icons (inner markup only)
var SETTINGS_ICONS = {
    eyeOff: '<path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/>',
    eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
    type: '<polyline points="4 7 4 4 20 4 20 7"/><line x1="9" y1="20" x2="15" y2="20"/><line x1="12" y1="4" x2="12" y2="20"/>',
    users: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
    check: '<polyline points="20 6 9 17 4 12"/>',
    alert: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
    phone: '<rect x="5" y="2" width="14" height="20" rx="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
    message: '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    trash: '<polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>',
    edit: '<path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
    bell: '<path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 0 1-3.46 0"/>',
    list: '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>',
    lock: '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/>',
    key: '<circle cx="8" cy="15" r="5"/><line x1="12" y1="11" x2="21" y2="2"/><line x1="17" y1="6" x2="20" y2="9"/>',
    shield: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>',
    database: '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3"/><path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5"/>',
    calendar: '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
    send: '<line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/>',
    mic: '<path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2"/><line x1="12" y1="19" x2="12" y2="23"/>',
    download: '<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
    tool: '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/>',
    activity: '<polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/>',
    monitor: '<rect x="2" y="3" width="20" height="14" rx="2"/><line x1="8" y1="21" x2="16" y2="21"/><line x1="12" y1="17" x2="12" y2="21"/>',
    chevron: '<polyline points="9 18 15 12 9 6"/>',
};

// item types: toggle {key}, number {key, unit}, select {key}, action {action, labelKey, descKey}, note {textKey},
// lock-card {keys}, contacts, vault-status, scheduled-receipts, scheduled-messages, diagnostics.
// Texts are translation keys: category cat.<id> / cat.<id>.intro, sections sec.*, options opt.<key> and opt.<key>.desc.
var SETTINGS_CATEGORIES = [
    { id: "privasi", icon: "eyeOff",
      sections: [
        { titleKey: "sec.traces", items: [
            { type: "toggle", key: "readConfirmationsHook", icon: "check" },
            { type: "toggle", key: "onlineUpdatesHook", icon: "eyeOff" },
            { type: "toggle", key: "typingUpdatesHook", icon: "type" },
        ] },
        { titleKey: "sec.reading", items: [
            { type: "toggle", key: "showReadWarning", icon: "alert" },
            { type: "toggle", key: "autoReceiptOnReplay", icon: "send" },
            { type: "toggle", key: "showDeviceTypes", icon: "phone" },
        ] },
      ] },
    { id: "kontak", icon: "user",
      sections: [
        { titleKey: "sec.contacts", items: [ { type: "contacts" } ] },
      ] },
    { id: "pesan", icon: "message",
      sections: [
        { titleKey: "sec.deleted", items: [
            { type: "toggle", key: "saveDeletedMsgs", icon: "trash" },
            { type: "toggle", key: "saveDeletedStatus", icon: "trash" },
        ] },
        { titleKey: "sec.editsEphemeral", items: [
            { type: "toggle", key: "saveEdits", icon: "edit" },
            { type: "toggle", key: "keepDisappearing", icon: "clock" },
        ] },
        { titleKey: "sec.notes", items: [ { type: "note", textKey: "note.messages" } ] },
      ] },
    { id: "notifikasi", icon: "bell",
      sections: [
        { titleKey: "sec.alerts", items: [
            { type: "toggle", key: "toastOnDelete", icon: "trash" },
            { type: "toggle", key: "toastOnEdit", icon: "edit" },
            { type: "note", textKey: "note.toasts" },
        ] },
      ] },
    { id: "layar", icon: "lock",
      sections: [
        { titleKey: "sec.lockWhenIdle", items: [
            { type: "lock-card", keys: ["lockEnabled", "lockIdleMinutes", "lockOnHidden", "lockOnHiddenMinutes"] },
        ] },
        { titleKey: "sec.blur", items: [
            { type: "toggle", key: "blurChatList", icon: "list" },
            { type: "toggle", key: "blurMessages", icon: "message" },
            { type: "toggle", key: "blurMedia", icon: "image" },
            { type: "toggle", key: "blurAvatars", icon: "user" },
        ] },
      ] },
    { id: "vault", icon: "shield",
      sections: [
        { titleKey: "sec.status", items: [
            { type: "vault-status" },
            { type: "action", action: "vault", icon: "key", labelKey: "act.vault", descKey: "act.vault.desc" },
        ] },
        { titleKey: "sec.storage", items: [
            { type: "number", key: "vaultRetentionDays", icon: "calendar", unitKey: "unit.days" },
            { type: "number", key: "vaultMaxMB", icon: "database", unitKey: "unit.mb" },
            { type: "note", textKey: "note.vault" },
        ] },
      ] },
    { id: "jadwal", icon: "clock",
      sections: [
        { titleKey: "sec.schedReceipts", items: [ { type: "scheduled-receipts" } ] },
        { titleKey: "sec.schedMessages", items: [ { type: "scheduled-messages" } ] },
        { titleKey: "sec.schedHow", items: [ { type: "note", textKey: "note.schedule" } ] },
      ] },
    { id: "utilitas", icon: "tool",
      sections: [
        { titleKey: "sec.audio", items: [ { type: "select", key: "voiceNoteRate", icon: "mic" } ] },
        { titleKey: "sec.status", items: [
            { type: "toggle", key: "allowStatusDownload", icon: "download" },
            { type: "note", textKey: "note.statusBulk" },
        ] },
      ] },
    { id: "diagnostik", icon: "activity",
      sections: [ { titleKey: "sec.results", items: [ { type: "diagnostics" } ] } ] },
];

// every option key shown by an item (the lock card shows several)
function settingsItemKeys(item)
{
    return item.keys ? item.keys : (item.key ? [item.key] : []);
}

function settingsSchemaEntry(key)
{
    return typeof getOptionSchemaEntry == "function" ? getOptionSchemaEntry(key) : null;
}

function settingsIconSVG(name)
{
    return '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + (SETTINGS_ICONS[name] || "") + '</svg>';
}

// "12.5 MB" style size
function formatMegabytes(bytes)
{
    return (bytes / (1024 * 1024)).toFixed(2) + " MB";
}

var LOCK_IDLE_PRESETS = [1, 5, 10, 15, 30];

// "custom" when the minutes are not one of the presets
function lockIdleChoice(minutes)
{
    return LOCK_IDLE_PRESETS.indexOf(Number(minutes)) > -1 ? String(minutes) : "custom";
}

// does the contact have a rule other than "default"?
function contactHasCustomRule(context, rules)
{
    return context.jids.some(function(jid)
    {
        var rule = rules && rules[jid];
        return !!rule && ((rule.readReceipts && rule.readReceipts != "default") || (rule.typing && rule.typing != "default"));
    });
}

function filterContacts(contexts, query, limit)
{
    var needle = String(query || "").trim().toLowerCase();
    var matches = needle ? contexts.filter(function(c) { return c.name.toLowerCase().indexOf(needle) > -1; }) : contexts;
    return { shown: matches.slice(0, limit), total: matches.length };
}

var settingsActions = {
    "vault": function() { openVaultModal(); },
};

var settingsHandle = null;

function applyDialogDirection(element)
{
    element.setAttribute("dir", (typeof isRtlLanguage == "function" && isRtlLanguage()) ? "rtl" : "ltr");
}

function openSettingsDialog(initialCategory)
{
    if (settingsHandle && !settingsHandle.closed)
    {
        if (initialCategory && settingsHandle.select) settingsHandle.select(initialCategory);
        return;
    }
    if (typeof checkInterception == "function" && !checkInterception()) return;

    var make = WAModal.make;
    var handle = WAModal.open({
        title: "WAIncognito",
        size: "xl",
        bodyClass: "wam-settings",
        onClose: function()
        {
            settingsHandle = null;
            var icon = document.getElementsByClassName("menu-item-incognito")[0];
            if (icon) icon.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " menu-item-incognito");
        },
    });
    settingsHandle = handle;
    var icon = document.getElementsByClassName("menu-item-incognito")[0];
    if (icon) icon.setAttribute("class", UIClassNames.MENU_ITEM_CLASS + " " + UIClassNames.MENU_ITEM_HIGHLIGHTED_CLASS + " active menu-item-incognito");

    // header tools: language picker and a lock button
    var tools = make("div", "wam-header-tools");
    var languageSelect = make("select", "wam-select wam-language");
    var lockButton = make("button", "wam-btn wam-btn-secondary wam-btn-small");
    lockButton.type = "button";
    lockButton.addEventListener("click", function()
    {
        if (window.WAIncognitoLock && window.WAIncognitoLock.hasPasscode()) window.WAIncognitoLock.lockNow();
        else select("layar");
    });
    tools.appendChild(languageSelect);
    tools.appendChild(lockButton);
    handle.header.insertBefore(tools, handle.header.lastChild);

    var split = make("div", "wam-split");
    var nav = make("nav", "wam-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-orientation", "vertical");
    var panel = make("section", "wam-panel");
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = -1;
    split.appendChild(nav);
    split.appendChild(panel);
    handle.body.appendChild(split);

    var options = {};
    var activeId = null;

    function labelFor(item)
    {
        if (item.labelKey) return t(item.labelKey);
        return item.key ? t("opt." + item.key) : "";
    }

    function select(id)
    {
        activeId = id;
        Array.prototype.forEach.call(nav.children, function(tab)
        {
            var selected = tab.dataset.category == id;
            tab.setAttribute("aria-selected", selected ? "true" : "false");
            tab.tabIndex = selected ? 0 : -1;
            tab.classList.toggle("wam-nav-active", selected);
            if (selected) panel.setAttribute("aria-labelledby", tab.id);
        });
        renderPanel(SETTINGS_CATEGORIES.find(function(c) { return c.id == id; }));
        panel.scrollTop = 0;
    }
    handle.select = select;

    function buildNav()
    {
        nav.textContent = "";
        nav.setAttribute("aria-label", t("settings.categories"));
        SETTINGS_CATEGORIES.forEach(function(category)
        {
            var tab = make("button", "wam-nav-item");
            tab.type = "button";
            tab.id = "wam-tab-" + category.id;
            tab.dataset.category = category.id;
            tab.setAttribute("role", "tab");
            tab.innerHTML = settingsIconSVG(category.icon) + "<span></span>";
            tab.lastChild.textContent = t("cat." + category.id);
            tab.addEventListener("click", function() { select(category.id); });
            tab.addEventListener("keydown", function(e)
            {
                var keys = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 };
                if (!(e.key in keys)) return;
                e.preventDefault();
                var index = SETTINGS_CATEGORIES.indexOf(category);
                var next = SETTINGS_CATEGORIES[(index + keys[e.key] + SETTINGS_CATEGORIES.length) % SETTINGS_CATEGORIES.length];
                select(next.id);
                nav.querySelector('[data-category="' + next.id + '"]').focus();
            });
            nav.appendChild(tab);
        });
    }

    function buildHeaderTools()
    {
        languageSelect.textContent = "";
        languageSelect.setAttribute("aria-label", t("settings.language"));
        var auto = make("option", "", t("lang.auto"));
        auto.value = "auto";
        languageSelect.appendChild(auto);
        I18N_LANGUAGES.forEach(function(language)
        {
            var option = make("option", "", language.name);
            option.value = language.code;
            languageSelect.appendChild(option);
        });
        languageSelect.value = options.language || "auto";
        lockButton.textContent = t("lock.now");
        lockButton.title = t("lock.shortcut");
    }

    languageSelect.addEventListener("change", function()
    {
        options.language = languageSelect.value;
        setOptionFromMenu("language", languageSelect.value);
        setLanguage(languageSelect.value);
        applyLanguage(languageSelect.value);
        applyDialogDirection(handle.dialog);
        buildNav();
        buildHeaderTools();
        select(activeId || SETTINGS_CATEGORIES[0].id);
    });

    function rowShell(item, tag)
    {
        var row = make(tag || "div", "wam-row");
        var iconBox = make("span", "wam-row-icon");
        iconBox.innerHTML = settingsIconSVG(item.icon || "check");
        var text = make("span", "wam-row-text");
        text.appendChild(make("span", "wam-row-label", labelFor(item)));
        var descKey = item.descKey || (item.key ? "opt." + item.key + ".desc" : null);
        if (descKey && t(descKey) != descKey) text.appendChild(make("span", "wam-row-desc", t(descKey)));
        row.appendChild(iconBox);
        row.appendChild(text);
        return row;
    }

    function optionValue(key)
    {
        return key in options ? options[key] : settingsSchemaEntry(key).default;
    }

    function renderToggle(item)
    {
        var row = rowShell(item, "label");
        row.classList.add("wam-row-toggle");
        var input = make("input", "wam-switch-input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.checked = !!optionValue(item.key);
        var track = make("span", "wam-switch");
        track.appendChild(input);
        track.appendChild(make("span", "wam-switch-track"));
        row.appendChild(track);
        input.addEventListener("change", function()
        {
            options[item.key] = input.checked;
            setOptionFromMenu(item.key, input.checked);
            if (item.onChange) item.onChange(input.checked);
        });
        return row;
    }

    function numberControl(key)
    {
        var input = make("input", "wam-input wam-input-number");
        input.type = "number";
        input.min = "0";
        input.value = optionValue(key);
        input.setAttribute("aria-label", t("opt." + key));
        input.addEventListener("change", function()
        {
            var value = parseOptionValue(key, input.value);
            input.value = value;
            options[key] = value;
            setOptionFromMenu(key, value);
        });
        return input;
    }

    function renderNumber(item)
    {
        var row = rowShell(item);
        var field = make("span", "wam-row-control");
        field.appendChild(numberControl(item.key));
        if (item.unitKey) field.appendChild(make("span", "wam-unit", t(item.unitKey)));
        row.appendChild(field);
        return row;
    }

    function renderSelect(item)
    {
        var entry = settingsSchemaEntry(item.key);
        var row = rowShell(item);
        var control = make("select", "wam-select");
        control.setAttribute("aria-label", t("opt." + item.key));
        entry.choices.forEach(function(choice)
        {
            var option = make("option", "", choice + "x");
            option.value = String(choice);
            control.appendChild(option);
        });
        control.value = String(optionValue(item.key));
        var field = make("span", "wam-row-control");
        field.appendChild(control);
        row.appendChild(field);
        control.addEventListener("change", function()
        {
            var value = parseOptionValue(item.key, control.value);
            options[item.key] = value;
            setOptionFromMenu(item.key, value);
        });
        return row;
    }

    function renderAction(item)
    {
        var row = rowShell(item, "button");
        row.type = "button";
        row.classList.add("wam-row-action");
        var chevron = make("span", "wam-row-chevron");
        chevron.innerHTML = settingsIconSVG("chevron");
        row.appendChild(chevron);
        row.addEventListener("click", function() { if (settingsActions[item.action]) settingsActions[item.action](); });
        return row;
    }

    function renderNote(item)
    {
        return make("p", "wam-note", t(item.textKey));
    }

    function renderVaultStatus()
    {
        var box = make("div", "wam-callout");
        box.textContent = t("vault.checking");
        sendVaultCommand("status").then(function(result)
        {
            if (!result.ok || !result.status) { box.textContent = t("vault.status.unavailable", { reason: result.error || t("vault.pageNotReady") }); return; }
            var status = result.status;
            if (!status.isSetUp) box.textContent = t("vault.status.none");
            else if (!status.isUnlocked) box.textContent = t("vault.status.locked");
            else box.textContent = t("vault.status.open", { count: status.count, size: formatMegabytes(status.bytes) });
        });
        return box;
    }

    // the "lock WhatsApp when idle" card: everything about the screen lock in one place
    function renderLockCard()
    {
        var stack = make("div", "wam-stack");
        stack.appendChild(renderToggle({ key: "lockEnabled", icon: "lock", onChange: refreshPasscodeWarning }));

        // idle time: presets and a custom value
        var idleRow = rowShell({ labelKey: "lock.idleAfter", descKey: "opt.lockIdleMinutes.desc", icon: "clock" });
        var idleField = make("span", "wam-row-control");
        var preset = make("select", "wam-select");
        preset.setAttribute("aria-label", t("lock.idleAfter"));
        LOCK_IDLE_PRESETS.forEach(function(minutes)
        {
            var option = make("option", "", t("lock.minutes", { n: minutes }));
            option.value = String(minutes);
            preset.appendChild(option);
        });
        var customOption = make("option", "", t("lock.custom"));
        customOption.value = "custom";
        preset.appendChild(customOption);
        var custom = numberControl("lockIdleMinutes");
        preset.value = lockIdleChoice(optionValue("lockIdleMinutes"));
        custom.hidden = preset.value != "custom";
        preset.addEventListener("change", function()
        {
            if (preset.value == "custom") { custom.hidden = false; custom.focus(); return; }
            custom.hidden = true;
            var minutes = Number(preset.value);
            custom.value = minutes;
            options.lockIdleMinutes = minutes;
            setOptionFromMenu("lockIdleMinutes", minutes);
        });
        idleField.appendChild(preset);
        idleField.appendChild(custom);
        idleRow.appendChild(idleField);
        stack.appendChild(idleRow);

        // lock when the tab is hidden
        stack.appendChild(renderToggle({ key: "lockOnHidden", icon: "eyeOff" }));
        var hiddenRow = rowShell({ labelKey: "opt.lockOnHiddenMinutes", icon: "clock" });
        var hiddenField = make("span", "wam-row-control");
        hiddenField.appendChild(numberControl("lockOnHiddenMinutes"));
        hiddenField.appendChild(make("span", "wam-unit", t("unit.minutes")));
        hiddenRow.appendChild(hiddenField);
        stack.appendChild(hiddenRow);

        // passcode, inline
        var passRow = rowShell({ labelKey: "lock.passcode", icon: "key" });
        var passText = passRow.querySelector(".wam-row-text");
        var passStatus = make("span", "wam-row-desc", "");
        passText.appendChild(passStatus);
        var passButton = make("button", "wam-btn wam-btn-secondary wam-btn-small", t("lock.setPasscode"));
        passButton.type = "button";
        passRow.appendChild(passButton);
        stack.appendChild(passRow);

        var form = make("div", "wam-passform");
        form.hidden = true;
        var pass1 = make("input", "wam-input");
        pass1.type = "password";
        pass1.placeholder = t("lock.pass1");
        pass1.autocomplete = "new-password";
        pass1.setAttribute("aria-label", t("lock.pass1"));
        var pass2 = make("input", "wam-input");
        pass2.type = "password";
        pass2.placeholder = t("lock.pass2");
        pass2.autocomplete = "new-password";
        pass2.setAttribute("aria-label", t("lock.pass2"));
        var error = make("div", "wam-validation");
        error.hidden = true;
        var save = make("button", "wam-btn wam-btn-primary wam-btn-small", t("lock.saveBtn"));
        save.type = "button";
        var formActions = make("div", "wam-passform-actions");
        formActions.appendChild(save);
        form.appendChild(pass1);
        form.appendChild(pass2);
        form.appendChild(error);
        form.appendChild(formActions);
        stack.appendChild(form);

        var warning = make("p", "wam-note wam-note-warn", t("lock.needPasscode"));
        warning.hidden = true;
        stack.appendChild(warning);

        var actions = make("div", "wam-row wam-row-static wam-lock-actions");
        var lockNow = make("button", "wam-btn wam-btn-primary", t("lock.now"));
        lockNow.type = "button";
        lockNow.addEventListener("click", function() { settingsLockNow(); });
        actions.appendChild(lockNow);
        actions.appendChild(make("span", "wam-row-desc", t("lock.shortcut")));
        stack.appendChild(actions);
        stack.appendChild(make("p", "wam-note", t("lock.disclaimer")));

        var hasPasscode = false;
        function refreshPasscodeWarning()
        {
            warning.hidden = !(optionValue("lockEnabled") && !hasPasscode);
        }
        function loadPasscodeState()
        {
            chrome.storage.local.get(["lockPasscode"]).then(function(stored)
            {
                hasPasscode = !!stored.lockPasscode;
                passStatus.textContent = hasPasscode ? t("lock.passcodeSet") : t("lock.passcodeNone");
                passButton.textContent = hasPasscode ? t("lock.changePasscode") : t("lock.setPasscode");
                refreshPasscodeWarning();
            });
        }
        passButton.addEventListener("click", function() { form.hidden = !form.hidden; if (!form.hidden) pass1.focus(); });
        save.addEventListener("click", async function()
        {
            error.hidden = true;
            if (pass1.value.length < 4) { error.textContent = t("lock.err.short"); error.hidden = false; return; }
            if (pass1.value !== pass2.value) { error.textContent = t("lock.err.mismatch"); error.hidden = false; return; }
            await savePasscode(pass1.value);
            pass1.value = pass2.value = "";
            form.hidden = true;
            WAModal.fire({ title: t("lock.saved"), icon: "success", toast: true, timer: 3000 });
            loadPasscodeState();
        });
        loadPasscodeState();
        return stack;
    }

    function settingsLockNow()
    {
        if (window.WAIncognitoLock && window.WAIncognitoLock.hasPasscode()) window.WAIncognitoLock.lockNow();
        else WAModal.fire({ title: t("lock.noPasscode"), text: t("lock.noPasscodeText"), icon: "info", confirmButtonText: t("common.ok") });
    }

    // searchable list of the user's chats (names only): each row opens the per-contact settings
    function renderContacts()
    {
        var box = make("div", "wam-contacts");
        var search = make("input", "wam-input wam-search");
        search.type = "search";
        search.placeholder = t("contacts.search");
        search.setAttribute("aria-label", t("contacts.search"));
        var note = make("p", "wam-note", t("contacts.intro"));
        var list = make("div", "wam-list wam-contact-list");
        var count = make("p", "wam-note");
        var all = null;

        function renderList()
        {
            list.textContent = "";
            if (all == null) { list.appendChild(make("p", "wam-note", t("contacts.loading"))); return; }
            var result = filterContacts(all, search.value, 80);
            count.textContent = result.total > result.shown.length ? t("contacts.showing", { shown: result.shown.length, total: result.total }) : "";
            if (result.shown.length == 0) { list.appendChild(make("p", "wam-note", t("contacts.none"))); return; }
            result.shown.forEach(function(context)
            {
                var row = make("button", "wam-row wam-row-action");
                row.type = "button";
                var iconBox = make("span", "wam-row-icon");
                iconBox.innerHTML = settingsIconSVG(context.isGroup ? "users" : "user");
                var text = make("span", "wam-row-text");
                text.appendChild(make("span", "wam-row-label", context.name));
                row.appendChild(iconBox);
                row.appendChild(text);
                if (contactHasCustomRule(context, contactRulesCache))
                {
                    row.appendChild(make("span", "wam-chip wam-chip-custom", t("contacts.custom")));
                }
                var chevron = make("span", "wam-row-chevron");
                chevron.innerHTML = settingsIconSVG("chevron");
                row.appendChild(chevron);
                row.addEventListener("click", function() { openContactPrivacyModal(context).then(renderList); });
                list.appendChild(row);
            });
        }

        search.addEventListener("input", renderList);
        box.appendChild(search);
        box.appendChild(note);
        box.appendChild(list);
        box.appendChild(count);
        renderList();
        requestChatContexts().then(function(chats) { all = chats; renderList(); });
        return box;
    }

    function listBlock(emptyText)
    {
        var list = make("div", "wam-list");
        list.appendChild(make("p", "wam-note", emptyText));
        return list;
    }

    function scheduledRow(title, detail, onCancel)
    {
        var row = make("div", "wam-row wam-row-static");
        var iconBox = make("span", "wam-row-icon");
        iconBox.innerHTML = settingsIconSVG("clock");
        var text = make("span", "wam-row-text");
        text.appendChild(make("span", "wam-row-label", title));
        if (detail) text.appendChild(make("span", "wam-row-desc", detail));
        var cancel = make("button", "wam-btn wam-btn-secondary wam-btn-small", t("common.cancel"));
        cancel.type = "button";
        cancel.addEventListener("click", function() { cancel.disabled = true; onCancel().then(function() { row.remove(); }); });
        row.appendChild(iconBox);
        row.appendChild(text);
        row.appendChild(cancel);
        return row;
    }

    function chatLabel(item)
    {
        return item.name || (item.jid ? String(item.jid).split("@")[0] : t("sched.chat"));
    }

    function renderScheduledReceipts()
    {
        var items = receiptScheduler.list();
        if (items.length == 0) return listBlock(t("sched.noReceipts"));
        var list = make("div", "wam-list");
        items.forEach(function(item)
        {
            list.appendChild(scheduledRow(chatLabel(item), t("sched.sentAt", { time: formatEditTime(item.dueAt) }), function() { return receiptScheduler.cancel(item.jid); }));
        });
        return list;
    }

    function renderScheduledMessages()
    {
        var items = sendScheduler.list();
        if (items.length == 0) return listBlock(t("sched.noMessages"));
        var list = make("div", "wam-list");
        items.forEach(function(item)
        {
            var status = item.status == "error" ? " " + t("sched.error", { error: item.error || t("sched.unknown") }) : (item.status == "overdue" ? " " + t("sched.overdueTag") : "");
            var preview = item.text.length > 70 ? item.text.slice(0, 70) + "…" : item.text;
            list.appendChild(scheduledRow(chatLabel(item) + " · " + formatEditTime(item.dueAt), preview + status, function() { return sendScheduler.cancel(item.id); }));
        });
        return list;
    }

    function renderDiagnostics()
    {
        var box = make("div", "wam-diag");
        var toolbar = make("div", "wam-diag-toolbar");
        var rerun = make("button", "wam-btn wam-btn-secondary", t("diag.rerun"));
        var copy = make("button", "wam-btn wam-btn-primary", t("diag.copy"));
        rerun.type = copy.type = "button";
        toolbar.appendChild(rerun);
        toolbar.appendChild(copy);
        var legend = make("p", "wam-note", t("diag.legend"));
        var tableWrap = make("div", "wam-table-wrap");
        box.appendChild(toolbar);
        box.appendChild(legend);
        box.appendChild(tableWrap);
        var results = [];

        async function load()
        {
            tableWrap.textContent = t("diag.checking");
            results = (await requestPageDiagnostics()).concat(Diagnostics.run());
            var table = make("table", "wam-table");
            var head = make("tr");
            [t("diag.status"), t("diag.feature"), t("diag.kind"), t("diag.dependency")].forEach(function(name) { head.appendChild(make("th", "", name)); });
            table.appendChild(head);
            results.forEach(function(r)
            {
                var tr = make("tr");
                var statusCell = make("td");
                statusCell.appendChild(make("span", "wam-chip wam-chip-" + r.status, r.status));
                tr.appendChild(statusCell);
                tr.appendChild(make("td", "", r.feature));
                tr.appendChild(make("td", "", r.kind));
                tr.appendChild(make("td", "wam-break", r.id));
                table.appendChild(tr);
            });
            tableWrap.textContent = "";
            tableWrap.appendChild(table);
        }

        rerun.addEventListener("click", load);
        copy.addEventListener("click", async function()
        {
            var report = Diagnostics.report(results);
            try
            {
                await navigator.clipboard.writeText(report);
                WAModal.fire({ title: t("diag.copied"), icon: "success", toast: true, timer: 3000 });
            }
            catch (e)
            {
                WAModal.fire({ title: t("diag.copyManual"), html: "<textarea class='wam-textarea' readonly rows='10'>" + WAModal.escapeText(report) + "</textarea>", width: 600 });
            }
        });
        load();
        return box;
    }

    var renderers = {
        toggle: renderToggle, number: renderNumber, select: renderSelect, action: renderAction, note: renderNote,
        "lock-card": renderLockCard, contacts: renderContacts,
        "vault-status": renderVaultStatus, "scheduled-receipts": renderScheduledReceipts,
        "scheduled-messages": renderScheduledMessages, diagnostics: renderDiagnostics,
    };

    function renderPanel(category)
    {
        panel.textContent = "";
        panel.appendChild(make("h3", "wam-panel-title", t("cat." + category.id)));
        panel.appendChild(make("p", "wam-panel-intro", t("cat." + category.id + ".intro")));
        category.sections.forEach(function(section)
        {
            var group = make("section", "wam-section");
            group.appendChild(make("h4", "wam-section-title", t(section.titleKey)));
            var card = make("div", "wam-card");
            section.items.forEach(function(item)
            {
                var render = renderers[item.type];
                if (render) card.appendChild(render(item));
            });
            group.appendChild(card);
            panel.appendChild(group);
        });
    }

    applyDialogDirection(handle.dialog);
    buildNav();
    buildHeaderTools();
    browser.runtime.sendMessage({ name: "getOptions" }, function(loaded)
    {
        options = loaded || {};
        if (handle.closed) return;
        buildHeaderTools();
        select(initialCategory || SETTINGS_CATEGORIES[0].id);
        var active = nav.querySelector(".wam-nav-active");
        if (active) active.focus();
    });
}

function closeSettingsDialog()
{
    if (settingsHandle) settingsHandle.close();
}
