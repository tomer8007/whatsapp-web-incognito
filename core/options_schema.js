//
// The single source of truth for every option.
// Shared by background.js (importScripts), the isolated world (menu), the page world (defaults) and tests.
//

// { key, type: "bool"|"number"|"enum", default, choices? }
// Texts are not stored here: the settings popup takes labels and descriptions from the translations (core/i18n_strings.js).
var OPTIONS_SCHEMA = [
    { key: "onlineUpdatesHook", type: "bool", default: false },
    { key: "typingUpdatesHook", type: "bool", default: false },
    { key: "readConfirmationsHook", type: "bool", default: true },
    { key: "showReadWarning", type: "bool", default: true },
    { key: "safetyDelay", type: "number", default: 0 },
    { key: "saveDeletedMsgs", type: "bool", default: false },
    { key: "showDeviceTypes", type: "bool", default: true },
    { key: "autoReceiptOnReplay", type: "bool", default: true },
    { key: "allowStatusDownload", type: "bool", default: true },

    { key: "toastOnDelete", type: "bool", default: false },
    { key: "toastOnEdit", type: "bool", default: false },

    { key: "saveEdits", type: "bool", default: false },
    { key: "deleteForEveryoneAnyTime", type: "bool", default: false },
    { key: "keepDisappearing", type: "bool", default: false },
    { key: "saveDeletedStatus", type: "bool", default: false },
    { key: "vaultRetentionDays", type: "number", default: 90 },
    { key: "vaultMaxMB", type: "number", default: 500 },

    { key: "blurChatList", type: "bool", default: false },
    { key: "blurMessages", type: "bool", default: false },
    { key: "blurMedia", type: "bool", default: false },
    { key: "blurAvatars", type: "bool", default: false },


    // English is the default for new installs. A user who already has "auto" stored (earlier builds saved the default) keeps browser
    // detection: stored values always win over this default. "auto" stays selectable in the picker.
    { key: "language", type: "enum", default: "en",
      choices: ["auto", "en", "ar", "de", "es", "fr", "hi", "id", "ja", "pt-BR", "ru", "tr", "zh-CN"] },

    { key: "hidetagEnabled", type: "bool", default: false },

];

function defaultOptions()
{
    var options = {};
    for (var i = 0; i < OPTIONS_SCHEMA.length; i++)
    {
        options[OPTIONS_SCHEMA[i].key] = OPTIONS_SCHEMA[i].default;
    }
    return options;
}

function getOptionSchemaEntry(key)
{
    for (var i = 0; i < OPTIONS_SCHEMA.length; i++)
    {
        if (OPTIONS_SCHEMA[i].key == key) return OPTIONS_SCHEMA[i];
    }
    return null;
}

// Converts a raw value from a menu input to the schema type. Invalid values fall back to the default.
function parseOptionValue(key, raw)
{
    var entry = getOptionSchemaEntry(key);
    if (entry == null) return raw;

    if (entry.type == "bool") return raw === true || raw === "true";

    var number = Number(raw);
    if (entry.type == "number")
        return (raw !== "" && isFinite(number) && number >= 0) ? number : entry.default;

    // enum
    for (var i = 0; i < entry.choices.length; i++)
    {
        if (entry.choices[i] === number || String(entry.choices[i]) === String(raw)) return entry.choices[i];
    }
    return entry.default;
}
