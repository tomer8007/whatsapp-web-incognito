//
// The single source of truth for every option.
// Shared by background.js (importScripts), the isolated world (menu), the page world (defaults) and tests.
//

// { key, label, group, type: "bool"|"number"|"enum", default, choices?, legacy? }
// `legacy` options already have a hand-written entry in the menu (ui.js), so the schema renderer skips them.
var OPTIONS_SCHEMA = [
    { key: "onlineUpdatesHook", label: "Sembunyikan status \"online\"", group: "Dasar", type: "bool", default: false, legacy: true },
    { key: "typingUpdatesHook", label: "Sembunyikan status \"mengetik...\"", group: "Dasar", type: "bool", default: false, legacy: true },
    { key: "readConfirmationsHook", label: "Jangan kirim centang biru", group: "Dasar", type: "bool", default: true, legacy: true },
    { key: "showReadWarning", label: "Peringatan sebelum menandai dibaca", group: "Dasar", type: "bool", default: true, legacy: true },
    { key: "safetyDelay", label: "Jeda pengaman (detik)", group: "Dasar", type: "number", default: 0, legacy: true },
    { key: "saveDeletedMsgs", label: "Pulihkan pesan yang dihapus", group: "Dasar", type: "bool", default: false, legacy: true },
    { key: "showDeviceTypes", label: "Tampilkan perangkat pengirim", group: "Dasar", type: "bool", default: true, legacy: true },
    { key: "autoReceiptOnReplay", label: "Kirim centang biru saat membalas", group: "Dasar", type: "bool", default: true, legacy: true },
    { key: "allowStatusDownload", label: "Izinkan unduh status", group: "Dasar", type: "bool", default: true, legacy: true },

    { key: "toastOnDelete", label: "Notifikasi saat pesan dihapus", group: "Notifikasi", type: "bool", default: false },
    { key: "toastOnEdit", label: "Notifikasi saat pesan diedit", group: "Notifikasi", type: "bool", default: false },

    { key: "saveEdits", label: "Simpan versi asli pesan yang diedit", group: "Arsip", type: "bool", default: false },
    { key: "keepDisappearing", label: "Simpan salinan pesan sementara", group: "Arsip", type: "bool", default: false },
    { key: "saveDeletedStatus", label: "Simpan status yang dihapus pengirim", group: "Arsip", type: "bool", default: false },
    { key: "vaultRetentionDays", label: "Simpan arsip vault selama (hari)", group: "Arsip", type: "number", default: 90 },
    { key: "vaultMaxMB", label: "Ukuran maksimal vault (MB)", group: "Arsip", type: "number", default: 500 },

    { key: "blurChatList", label: "Blur daftar chat", group: "Privasi layar", type: "bool", default: false },
    { key: "blurMessages", label: "Blur isi pesan", group: "Privasi layar", type: "bool", default: false },
    { key: "blurMedia", label: "Blur foto dan video", group: "Privasi layar", type: "bool", default: false },
    { key: "blurAvatars", label: "Blur foto profil", group: "Privasi layar", type: "bool", default: false },
    { key: "lockEnabled", label: "Kunci layar dengan passcode", group: "Privasi layar", type: "bool", default: false },
    { key: "lockIdleMinutes", label: "Kunci otomatis setelah diam (menit)", group: "Privasi layar", type: "number", default: 10 },

    { key: "lockOnHidden", label: "Kunci saat tab disembunyikan", group: "Privasi layar", type: "bool", default: false },
    { key: "lockOnHiddenMinutes", label: "Kunci setelah tab disembunyikan (menit)", group: "Privasi layar", type: "number", default: 2 },

    { key: "language", label: "Bahasa", group: "Umum", type: "enum", default: "auto",
      choices: ["auto", "id", "en", "es", "pt-BR", "fr", "de", "ru", "tr", "ar", "hi", "ja", "zh-CN"] },

    { key: "hidetagEnabled", label: "Hidetag", group: "Utilitas", type: "bool", default: false },

    { key: "voiceNoteRate", label: "Kecepatan voice note", group: "Utilitas", type: "enum", default: 1, choices: [0.75, 1, 1.25, 1.5, 2, 2.5, 3] },
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

// Menu markup for every non-legacy option, grouped by `group`.
function renderSchemaOptionsHTML(options)
{
    var html = "";
    var groups = [];
    for (var i = 0; i < OPTIONS_SCHEMA.length; i++)
    {
        var entry = OPTIONS_SCHEMA[i];
        if (entry.legacy) continue;
        if (groups.indexOf(entry.group) == -1) groups.push(entry.group);
    }

    for (var g = 0; g < groups.length; g++)
    {
        html += "<div class='incognito-options-group-title'>" + groups[g] + "</div>";
        for (var i = 0; i < OPTIONS_SCHEMA.length; i++)
        {
            var entry = OPTIONS_SCHEMA[i];
            if (entry.legacy || entry.group != groups[g]) continue;
            var value = (options && entry.key in options) ? options[entry.key] : entry.default;

            if (entry.type == "bool")
            {
                var checkbox = value ?
                    "<div class='checkbox checkbox-incognito checked incognito-checked'><div class='checkmark incognito-mark incognito-marked'></div></div>" :
                    "<div class='checkbox checkbox-incognito unchecked'><div class='checkmark incognito-mark'></div></div>";
                html += "<div class='incognito-options-item incognito-schema-option' data-option-key='" + entry.key + "' style='cursor: pointer;'>" +
                        "<div class='checkbox-container-incognito'>" + checkbox + "</div>" + entry.label + "</div>";
            }
            else if (entry.type == "number")
            {
                html += "<div class='incognito-options-item'>" + entry.label +
                        " <input type='number' min='0' class='incognito-schema-input' data-option-key='" + entry.key + "' value='" + value + "'></div>";
            }
            else
            {
                var select = "<select class='incognito-schema-input' data-option-key='" + entry.key + "'>";
                for (var c = 0; c < entry.choices.length; c++)
                {
                    var choice = entry.choices[c];
                    select += "<option value='" + choice + "'" + (choice === value ? " selected" : "") + ">" + choice + "x</option>";
                }
                select += "</select>";
                html += "<div class='incognito-options-item'>" + entry.label + " " + select + "</div>";
            }
        }
    }
    return html;
}
