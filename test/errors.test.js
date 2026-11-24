const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    const s = loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/errors.js"]);
    return s;
}

test("known codes and English exception messages become translated texts", () => {
    const s = load();
    assert.strictEqual(s.userErrorText("wrong-passphrase"), "Wrong passphrase");
    assert.strictEqual(s.userErrorText(new Error("Vault is locked")), "Vault locked");
    assert.strictEqual(s.userErrorText("send-function-not-found"), s.t("err.sendNotFound"));
    assert.strictEqual(s.userErrorText("no-answer"), s.t("sched.noAnswer"));
    assert.strictEqual(s.userErrorText("not-a-group"), s.t("hidetag.notGroup"));
    assert.strictEqual(s.userErrorText("status-not-found"), s.I18N_DICT.en["err.statusNotFound"]);
});

test("unknown errors get one translated sentence with the raw detail, empty errors a translated 'unknown'", () => {
    const s = load();
    assert.strictEqual(s.userErrorText("boom 42"), "Something went wrong (boom 42)");
    assert.strictEqual(s.userErrorText(null), s.t("sched.unknown"));
    assert.ok(/boom/.test(s.userErrorText("boom")));
});

test("every code the page world can report maps to a translation", () => {
    const s = load();
    for (const code of ["no-answer", "wrong-passphrase", "vault-locked", "vault-not-loaded", "send-function-not-found", "create-function-not-found", "sticker-send-function-not-found",
                        "chat-not-found", "status-not-found", "status-download-failed", "no-media", "media-unavailable", "disabled", "not-a-group", "empty-selection",
                        "no-members", "no-metadata", "unknown-member", "empty-text"]) {
        assert.ok(!/Something went wrong/.test(s.userErrorText(code)), code + " is not mapped");
    }
});

test("a failed send result never leaks the raw WhatsApp value: it becomes a translated sentence", () => {
    const s = load();
    for (const code of ["send-result:ERROR_UNKNOWN", "send-result:ERROR_NETWORK", "send-result:undefined"]) {
        const text = s.userErrorText(code);
        assert.strictEqual(text, s.I18N_DICT.en["err.sendFailed"]);
        assert.ok(!/ERROR_|undefined|send-result/.test(text));
    }
    assert.strictEqual(s.userErrorText("send-result:ERROR_CANCEL"), s.I18N_DICT.en["err.sendCancelled"]);
    assert.ok(/boom/.test(s.userErrorText("boom")), "unknown values keep the generic wrapper with the detail");
});
