const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const DEFAULTS = {
    onlineUpdatesHook: false,
    typingUpdatesHook: false,
    readConfirmationsHook: true,
    showReadWarning: true,
    safetyDelay: 0,
    saveDeletedMsgs: false,
    showDeviceTypes: true,
    autoReceiptOnReplay: true,
    allowStatusDownload: true,
    // added by the options schema (core/options_schema.js)
    toastOnDelete: false,
    toastOnEdit: false,
    saveEdits: false,
    deleteForEveryoneAnyTime: false,
    keepDisappearing: false,
    saveDeletedStatus: false,
    vaultRetentionDays: 90,
    vaultMaxMB: 500,
    blurChatList: false,
    blurMessages: false,
    blurMedia: false,
    blurAvatars: false,
    language: "en",
    hidetagEnabled: false,
    voiceNoteRate: 1,
};

function loadBackground(stored = {}) {
    const store = { ...stored };
    let listener = null;
    const chrome = {
        storage: { local: {
            set: async (items) => { Object.assign(store, items); },
            get: async (keys) => Object.fromEntries(keys.filter((k) => k in store).map((k) => [k, store[k]])),
        } },
        runtime: { onMessage: { addListener: (fn) => { listener = fn; } } },
        action: { onClicked: { addListener() {} } },
        tabs: { create() {} },
    };
    const sandbox = createSandbox({ chrome });
    sandbox.importScripts = (...paths) => loadScripts(sandbox, paths);
    loadScripts(sandbox, ["background.js"]);
    return {
        store,
        listener: (message) => new Promise((resolve) => listener(message, {}, resolve)),
        getOptions: () => new Promise((resolve) => listener({ name: "getOptions" }, {}, resolve)),
        setOptions: (options) => listener({ name: "setOptions", ...options }, {}, () => {}),
    };
}

test("getOptions returns defaults when nothing is stored", async () => {
    const bg = loadBackground();
    assert.deepStrictEqual({ ...(await bg.getOptions()) }, DEFAULTS);
});

test("getOptions prefers stored values", async () => {
    const bg = loadBackground({ readConfirmationsHook: false, safetyDelay: 5 });
    assert.deepStrictEqual({ ...(await bg.getOptions()) }, { ...DEFAULTS, readConfirmationsHook: false, safetyDelay: 5 });
});

test("setOptions stores known options and ignores unknown keys", async () => {
    const bg = loadBackground();
    bg.setOptions({ saveDeletedMsgs: true, safetyDelay: 3, bogus: 1 });
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepStrictEqual(bg.store, { saveDeletedMsgs: true, safetyDelay: 3 });
});
