const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/i18n.js", "core/i18n_strings.js", "core/privacy_screen.js"]);
}

test("blurClassesFor maps the options to body classes", () => {
    const { blurClassesFor, defaultOptions } = load();
    assert.deepStrictEqual([...blurClassesFor(defaultOptions())], []);
    assert.deepStrictEqual([...blurClassesFor({ ...defaultOptions(), blurChatList: true, blurMedia: true })], ["incognito-blur-chatlist", "incognito-blur-media"]);
    assert.deepStrictEqual([...blurClassesFor({ ...defaultOptions(), blurMessages: true, blurAvatars: true })], ["incognito-blur-messages", "incognito-blur-avatars"]);
});

test("every blur selector used for diagnostics is really in styles.css", () => {
    const { PRIVACY_BLUR_TARGETS } = load();
    const css = fs.readFileSync(path.join(ROOT, "styles.css"), "utf8");
    for (const target of Object.values(PRIVACY_BLUR_TARGETS)) {
        assert.ok(target.selectors.includes(target.selector));
        for (const selector of target.selectors) {
            assert.ok(css.includes(`.${target.cls} ${selector}`), `styles.css is missing ${selector}`);
        }
    }
});

test("the screen lock is gone: no lock options, no lock code", () => {
    const s = load();
    assert.ok(![...s.OPTIONS_SCHEMA].some((o) => /^lock/.test(o.key)));
    for (const name of ["createLock", "hashPasscode", "isLockShortcut", "shouldLockAfterHidden"]) assert.strictEqual(typeof s[name], "undefined", name);
});
