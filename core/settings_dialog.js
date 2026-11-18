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

// item types: toggle {key}, number {key, unit}, select {key}, action {action}, note {text}
// Labels and the numbers' bounds come from core/options_schema.js when `key` is set; `desc` is shown under the label.
var SETTINGS_CATEGORIES = [
    { id: "privasi", title: "Privasi", icon: "eyeOff", intro: "Atur apa yang WhatsApp Web boleh tahu tentang aktivitas kamu.",
      sections: [
        { title: "Jejak yang kamu tinggalkan", items: [
            { type: "toggle", key: "readConfirmationsHook", icon: "check", desc: "Pesan yang tertahan ditandai dengan tombol. Berlaku juga untuk status dan voice note." },
            { type: "toggle", key: "onlineUpdatesHook", icon: "eyeOff", desc: "Berhenti mengirim status online. Kamu juga tidak bisa melihat status online orang lain." },
            { type: "toggle", key: "typingUpdatesHook", icon: "type", desc: "Berhenti mengirim status mengetik." },
        ] },
        { title: "Saat membaca dan membalas", items: [
            { type: "toggle", key: "showReadWarning", icon: "alert", desc: "Tampilkan konfirmasi sebelum tombol tandai dibaca mengirim centang biru." },
            { type: "toggle", key: "autoReceiptOnReplay", icon: "send", desc: "Otomatis tandai dibaca saat kamu membalas di sebuah chat." },
            { type: "toggle", key: "showDeviceTypes", icon: "phone", desc: "Tampilkan apakah pesan baru dikirim dari ponsel atau komputer." },
        ] },
        { title: "Per kontak", items: [
            { type: "note", text: "Aturan khusus untuk satu kontak (centang biru dan mengetik) diatur dari menu chat di daftar chat: pilih \"Privasi kontak ini…\". Status online tidak bisa diatur per kontak." },
        ] },
      ] },
    { id: "pesan", title: "Pesan", icon: "message", intro: "Simpan pesan yang dihapus, diedit, atau hilang sendiri.",
      sections: [
        { title: "Pesan yang dihapus", items: [
            { type: "toggle", key: "saveDeletedMsgs", icon: "trash", desc: "Pesan yang dihapus pengirim tetap terlihat dan ditandai merah." },
            { type: "toggle", key: "saveDeletedStatus", icon: "trash", desc: "Status yang dihapus pengirim tetap bisa dilihat." },
        ] },
        { title: "Edit dan pesan sementara", items: [
            { type: "toggle", key: "saveEdits", icon: "edit", desc: "Tombol \"↺ asli\" muncul di pesan yang diedit untuk melihat versi sebelumnya." },
            { type: "toggle", key: "keepDisappearing", icon: "clock", desc: "Salinan tersimpan untuk pesan yang diterima setelah opsi ini aktif. Lihat dari menu chat: \"Pesan sementara tersimpan\"." },
        ] },
        { title: "Catatan", items: [
            { type: "note", text: "Pesan yang diterima saat tab WhatsApp Web tertutup tidak bisa disimpan. Aktifkan Vault supaya arsip terenkripsi." },
        ] },
      ] },
    { id: "notifikasi", title: "Notifikasi", icon: "bell", intro: "Notifikasi kecil di layar saat sesuatu terjadi.",
      sections: [
        { title: "Peringatan", items: [
            { type: "toggle", key: "toastOnDelete", icon: "trash", desc: "Muncul saat pengirim menghapus pesan." },
            { type: "toggle", key: "toastOnEdit", icon: "edit", desc: "Muncul saat pengirim mengedit pesan." },
            { type: "note", text: "Kalau salah satu blur layar aktif, isi pesan disembunyikan dari notifikasi dan hanya nama chat yang tampil." },
        ] },
      ] },
    { id: "layar", title: "Layar & Kunci", icon: "lock", intro: "Sembunyikan layar dari orang di sekitar dan kunci dengan passcode.",
      sections: [
        { title: "Blur", items: [
            { type: "toggle", key: "blurChatList", icon: "list", desc: "Nama dan cuplikan pesan di daftar chat. Arahkan kursor untuk membuka blur." },
            { type: "toggle", key: "blurMessages", icon: "message", desc: "Isi pesan di dalam chat. Arahkan kursor untuk membuka blur." },
            { type: "toggle", key: "blurMedia", icon: "image", desc: "Foto dan video di dalam chat." },
            { type: "toggle", key: "blurAvatars", icon: "user", desc: "Foto profil di seluruh aplikasi." },
        ] },
        { title: "Kunci layar", items: [
            { type: "toggle", key: "lockEnabled", icon: "lock", desc: "Layar tertutup sampai passcode dimasukkan." },
            { type: "number", key: "lockIdleMinutes", icon: "clock", unit: "menit", desc: "Kunci otomatis setelah tidak ada aktivitas." },
            { type: "action", action: "lock-setup", icon: "key", label: "Atur passcode", desc: "Buat atau ganti passcode kunci layar." },
            { type: "action", action: "lock-now", icon: "lock", label: "Kunci sekarang", desc: "Kunci layar saat ini juga." },
            { type: "note", text: "Kunci ini layar privasi, bukan pengaman data. Untuk melindungi data, gunakan Vault." },
        ] },
      ] },
    { id: "vault", title: "Vault", icon: "shield", intro: "Brankas terenkripsi untuk arsip pesan.",
      sections: [
        { title: "Status", items: [
            { type: "vault-status" },
            { type: "action", action: "vault", icon: "key", label: "Kelola vault", desc: "Buat, buka, atau kunci vault." },
        ] },
        { title: "Penyimpanan", items: [
            { type: "number", key: "vaultRetentionDays", icon: "calendar", unit: "hari", desc: "Arsip yang lebih lama dihapus otomatis." },
            { type: "number", key: "vaultMaxMB", icon: "database", unit: "MB", desc: "Kalau melebihi batas, arsip tertua dihapus lebih dulu." },
            { type: "note", text: "Lupa passphrase berarti arsip hilang permanen. Tidak ada pemulihan." },
        ] },
      ] },
    { id: "jadwal", title: "Penjadwalan", icon: "clock", intro: "Centang biru dan pesan yang dikirim nanti. Tab WhatsApp Web harus tetap terbuka.",
      sections: [
        { title: "Centang biru terjadwal", items: [ { type: "scheduled-receipts" } ] },
        { title: "Pesan terjadwal", items: [ { type: "scheduled-messages" } ] },
        { title: "Cara menjadwalkan", items: [
            { type: "note", text: "Buka menu sebuah chat di daftar chat, lalu pilih \"Kirim centang biru nanti…\" atau \"Jadwalkan pesan…\". Pesan terjadwal disimpan di browser ini tanpa enkripsi sampai terkirim." },
        ] },
      ] },
    { id: "utilitas", title: "Utilitas", icon: "tool", intro: "Alat bantu kecil.",
      sections: [
        { title: "Audio", items: [
            { type: "select", key: "voiceNoteRate", icon: "mic", desc: "Kecepatan awal saat voice note diputar. Tombol kecepatan WhatsApp tetap dihormati." },
        ] },
        { title: "Status", items: [
            { type: "toggle", key: "allowStatusDownload", icon: "download", desc: "Tombol unduh muncul di penampil status." },
            { type: "note", text: "Di penampil status ada tombol \"⬇ Semua\" untuk mengunduh semua status satu kontak sekaligus." },
        ] },
      ] },
    { id: "diagnostik", title: "Diagnostik", icon: "activity", intro: "Cek apakah semua bagian WhatsApp Web yang dibutuhkan ekstensi ditemukan.",
      sections: [ { title: "Hasil pemeriksaan", items: [ { type: "diagnostics" } ] } ] },
];

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

var settingsActions = {
    "lock-setup": function() { openLockSetupModal(); },
    "lock-now": function()
    {
        if (window.WAIncognitoLock && window.WAIncognitoLock.hasPasscode()) { window.WAIncognitoLock.lockNow(); }
        else WAModal.fire({ title: "Belum ada passcode", text: "Atur passcode dulu sebelum mengunci layar.", icon: "info" });
    },
    "vault": function() { openVaultModal(); },
};

var settingsHandle = null;

function openSettingsDialog(initialCategory)
{
    if (settingsHandle && !settingsHandle.closed) { return; }
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

    var split = make("div", "wam-split");
    var nav = make("nav", "wam-nav");
    nav.setAttribute("role", "tablist");
    nav.setAttribute("aria-orientation", "vertical");
    nav.setAttribute("aria-label", "Kategori pengaturan");
    var panel = make("section", "wam-panel");
    panel.setAttribute("role", "tabpanel");
    panel.tabIndex = -1;
    split.appendChild(nav);
    split.appendChild(panel);
    handle.body.appendChild(split);

    var options = {};
    var activeId = null;

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
        var category = SETTINGS_CATEGORIES.find(function(c) { return c.id == id; });
        renderPanel(category);
        panel.scrollTop = 0;
    }

    SETTINGS_CATEGORIES.forEach(function(category)
    {
        var tab = make("button", "wam-nav-item");
        tab.type = "button";
        tab.id = "wam-tab-" + category.id;
        tab.dataset.category = category.id;
        tab.setAttribute("role", "tab");
        tab.innerHTML = settingsIconSVG(category.icon) + "<span></span>";
        tab.lastChild.textContent = category.title;
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

    function rowShell(item, tag)
    {
        var entry = item.key ? settingsSchemaEntry(item.key) : null;
        var row = make(tag || "div", "wam-row");
        var iconBox = make("span", "wam-row-icon");
        iconBox.innerHTML = settingsIconSVG(item.icon || "check");
        var text = make("span", "wam-row-text");
        text.appendChild(make("span", "wam-row-label", item.label || (entry ? entry.label : "")));
        if (item.desc) text.appendChild(make("span", "wam-row-desc", item.desc));
        row.appendChild(iconBox);
        row.appendChild(text);
        return row;
    }

    function renderToggle(item)
    {
        var row = rowShell(item, "label");
        row.classList.add("wam-row-toggle");
        var input = make("input", "wam-switch-input");
        input.type = "checkbox";
        input.setAttribute("role", "switch");
        input.checked = item.key in options ? !!options[item.key] : !!settingsSchemaEntry(item.key).default;
        var track = make("span", "wam-switch");
        track.appendChild(input);
        track.appendChild(make("span", "wam-switch-track"));
        row.appendChild(track);
        input.addEventListener("change", function()
        {
            options[item.key] = input.checked;
            setOptionFromMenu(item.key, input.checked);
        });
        return row;
    }

    function renderNumber(item)
    {
        var entry = settingsSchemaEntry(item.key);
        var row = rowShell(item);
        var field = make("span", "wam-row-control");
        var input = make("input", "wam-input wam-input-number");
        input.type = "number";
        input.min = "0";
        input.value = item.key in options ? options[item.key] : entry.default;
        input.setAttribute("aria-label", entry.label);
        field.appendChild(input);
        if (item.unit) field.appendChild(make("span", "wam-unit", item.unit));
        row.appendChild(field);
        input.addEventListener("change", function()
        {
            var value = parseOptionValue(item.key, input.value);
            input.value = value;
            options[item.key] = value;
            setOptionFromMenu(item.key, value);
        });
        return row;
    }

    function renderSelect(item)
    {
        var entry = settingsSchemaEntry(item.key);
        var row = rowShell(item);
        var select = make("select", "wam-select");
        select.setAttribute("aria-label", entry.label);
        entry.choices.forEach(function(choice)
        {
            var option = make("option", "", choice + "x");
            option.value = String(choice);
            select.appendChild(option);
        });
        select.value = String(item.key in options ? options[item.key] : entry.default);
        var field = make("span", "wam-row-control");
        field.appendChild(select);
        row.appendChild(field);
        select.addEventListener("change", function()
        {
            var value = parseOptionValue(item.key, select.value);
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
        return make("p", "wam-note", item.text);
    }

    function renderVaultStatus()
    {
        var box = make("div", "wam-callout");
        box.textContent = "Memeriksa vault…";
        sendVaultCommand("status").then(function(result)
        {
            if (!result.ok || !result.status) { box.textContent = "Vault tidak tersedia: " + (result.error || "halaman belum siap") + "."; return; }
            var status = result.status;
            if (!status.isSetUp) box.textContent = "Vault belum dibuat. Arsip tersimpan tanpa enkripsi di browser ini.";
            else if (!status.isUnlocked) box.textContent = "Vault terkunci. Arsip baru tetap tersimpan terenkripsi, tapi isinya baru bisa dilihat setelah dibuka.";
            else box.textContent = "Vault terbuka: " + status.count + " arsip, " + formatMegabytes(status.bytes) + ".";
        });
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
        var cancel = make("button", "wam-btn wam-btn-secondary wam-btn-small", "Batalkan");
        cancel.type = "button";
        cancel.addEventListener("click", function() { cancel.disabled = true; onCancel().then(function() { row.remove(); }); });
        row.appendChild(iconBox);
        row.appendChild(text);
        row.appendChild(cancel);
        return row;
    }

    function chatLabel(item)
    {
        return item.name || (item.jid ? String(item.jid).split("@")[0] : "Chat");
    }

    function renderScheduledReceipts()
    {
        var items = receiptScheduler.list();
        if (items.length == 0) return listBlock("Tidak ada centang biru terjadwal.");
        var list = make("div", "wam-list");
        items.forEach(function(item)
        {
            list.appendChild(scheduledRow(chatLabel(item), "Dikirim " + formatEditTime(item.dueAt), function() { return receiptScheduler.cancel(item.jid); }));
        });
        return list;
    }

    function renderScheduledMessages()
    {
        var items = sendScheduler.list();
        if (items.length == 0) return listBlock("Tidak ada pesan terjadwal.");
        var list = make("div", "wam-list");
        items.forEach(function(item)
        {
            var status = item.status == "error" ? " Gagal: " + (item.error || "tidak diketahui") : (item.status == "overdue" ? " Terlewat." : "");
            var preview = item.text.length > 70 ? item.text.slice(0, 70) + "…" : item.text;
            list.appendChild(scheduledRow(chatLabel(item) + " · " + formatEditTime(item.dueAt), preview + status, function() { return sendScheduler.cancel(item.id); }));
        });
        return list;
    }

    function renderDiagnostics()
    {
        var box = make("div", "wam-diag");
        var toolbar = make("div", "wam-diag-toolbar");
        var rerun = make("button", "wam-btn wam-btn-secondary", "Periksa ulang");
        var copy = make("button", "wam-btn wam-btn-primary", "Salin laporan");
        rerun.type = copy.type = "button";
        toolbar.appendChild(rerun);
        toolbar.appendChild(copy);
        var legend = make("p", "wam-note", "Status \"unseen\" berarti elemen atau aksi itu belum muncul di layar, belum tentu rusak.");
        var tableWrap = make("div", "wam-table-wrap");
        box.appendChild(toolbar);
        box.appendChild(legend);
        box.appendChild(tableWrap);
        var results = [];

        async function load()
        {
            tableWrap.textContent = "Memeriksa…";
            results = (await requestPageDiagnostics()).concat(Diagnostics.run());
            var table = make("table", "wam-table");
            var head = make("tr");
            ["Status", "Fitur", "Jenis", "Dependensi"].forEach(function(name) { head.appendChild(make("th", "", name)); });
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
                WAModal.fire({ title: "Laporan disalin", icon: "success", toast: true, timer: 3000 });
            }
            catch (e)
            {
                WAModal.fire({ title: "Salin manual", html: "<textarea class='wam-textarea' readonly rows='10'>" + WAModal.escapeText(report) + "</textarea>", width: 600 });
            }
        });
        load();
        return box;
    }

    var renderers = {
        toggle: renderToggle, number: renderNumber, select: renderSelect, action: renderAction, note: renderNote,
        "vault-status": renderVaultStatus, "scheduled-receipts": renderScheduledReceipts,
        "scheduled-messages": renderScheduledMessages, diagnostics: renderDiagnostics,
    };

    function renderPanel(category)
    {
        panel.textContent = "";
        var heading = make("h3", "wam-panel-title", category.title);
        panel.appendChild(heading);
        if (category.intro) panel.appendChild(make("p", "wam-panel-intro", category.intro));
        category.sections.forEach(function(section)
        {
            var group = make("section", "wam-section");
            group.appendChild(make("h4", "wam-section-title", section.title));
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

    browser.runtime.sendMessage({ name: "getOptions" }, function(loaded)
    {
        options = loaded || {};
        if (handle.closed) return;
        select(initialCategory || SETTINGS_CATEGORIES[0].id);
        var active = nav.querySelector(".wam-nav-active");
        if (active) active.focus();
    });
}

function closeSettingsDialog()
{
    if (settingsHandle) settingsHandle.close();
}
