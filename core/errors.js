//
// Error texts for the user (isolated world). The page world reports machine codes or English exception messages;
// they are mapped here to translated texts. Anything unknown becomes a generic translated sentence with the raw detail attached.
//

var USER_ERROR_MAP = [
    [/^no-answer$/, "sched.noAnswer"],
    [/^wrong-passphrase$/, "vault.wrong"],
    [/Vault is locked|^vault-locked$/, "vault.locked"],
    [/Vault is not set up/, "err.vaultNotSetUp"],
    [/Vault is already set up/, "err.vaultAlreadySetUp"],
    [/Vault is not initialized|^vault-not-loaded$/, "err.vaultNotLoaded"],
    [/Empty passphrase/, "vault.err.short"],
    [/^send-function-not-found$|^create-function-not-found$|^sticker-send-function-not-found$/, "err.sendNotFound"],
    [/^chat-not-found$/, "err.chatNotFound"],
    [/^status-not-found$/, "err.statusNotFound"],
    [/^status-download-failed$/, "err.statusDownloadFailed"],
    [/^no-media$/, "err.noMedia"],
    [/^media-unavailable$/, "err.mediaUnavailable"],
    [/^disabled$/, "hidetag.disabled"],
    [/^not-a-group$/, "hidetag.notGroup"],
    [/^empty-selection$|^no-members$/, "hidetag.noneSelected"],
    [/^no-metadata$/, "hidetag.none"],
    [/^unknown-member$/, "hidetag.unknownMember"],
    [/^empty-text$/, "hidetag.empty"],
    [/WhatsAppAPI is not ready yet/, "vault.pageNotReady"],
];

// error: a code, an exception message or an Error. -> a translated text
function userErrorText(error)
{
    var text = String(error && error.message ? error.message : (error == null ? "" : error));
    if (text == "") return t("sched.unknown");
    for (var i = 0; i < USER_ERROR_MAP.length; i++)
    {
        if (USER_ERROR_MAP[i][0].test(text)) return t(USER_ERROR_MAP[i][1]);
    }
    return t("err.generic", { detail: text });
}
