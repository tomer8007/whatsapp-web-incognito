const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const path = require("node:path");
const { createSandbox, loadScripts, ROOT } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox({ crypto: globalThis.crypto, TextEncoder, atob }), ["core/options_schema.js", "core/privacy_screen.js"]);
}

function makeLock(overrides = {}) {
    const { createLock } = load();
    let clock = 0;
    const lock = createLock({
        now: () => clock,
        verify: async (code) => code === "1234",
        idleMs: 10 * 60 * 1000,
        ...overrides,
    });
    return { lock, advance: (ms) => { clock += ms; } };
}

test("a new lock starts locked; a wrong code keeps it locked, the right one unlocks", async () => {
    const { lock } = makeLock();
    assert.strictEqual(lock.state(), "locked");
    assert.strictEqual(await lock.unlock("0000"), false);
    assert.strictEqual(lock.state(), "locked");
    assert.strictEqual(await lock.unlock("1234"), true);
    assert.strictEqual(lock.state(), "unlocked");
});

test("tick relocks once idle for idleMs", async () => {
    const { lock, advance } = makeLock();
    await lock.unlock("1234");
    advance(10 * 60 * 1000 - 1);
    lock.tick();
    assert.strictEqual(lock.state(), "unlocked");
    advance(1);
    lock.tick();
    assert.strictEqual(lock.state(), "locked");
});

test("activity resets the idle timer", async () => {
    const { lock, advance } = makeLock();
    await lock.unlock("1234");
    advance(9 * 60 * 1000);
    lock.activity();
    advance(9 * 60 * 1000);
    lock.tick();
    assert.strictEqual(lock.state(), "unlocked");
    advance(2 * 60 * 1000);
    lock.tick();
    assert.strictEqual(lock.state(), "locked");
});

test("lockNow locks immediately, and activity does not unlock", async () => {
    const { lock } = makeLock();
    await lock.unlock("1234");
    lock.lockNow();
    assert.strictEqual(lock.state(), "locked");
    lock.activity();
    assert.strictEqual(lock.state(), "locked");
});

test("a verify that throws counts as a wrong code", async () => {
    const { lock } = makeLock({ verify: async () => { throw new Error("boom"); } });
    assert.strictEqual(await lock.unlock("x"), false);
    assert.strictEqual(lock.state(), "locked");
});

test("hashPasscode is deterministic per salt and differs between salts", async () => {
    const { hashPasscode } = load();
    const a1 = await hashPasscode("1234", "garam-a");
    const a2 = await hashPasscode("1234", "garam-a");
    const b = await hashPasscode("1234", "garam-b");
    const other = await hashPasscode("4321", "garam-a");
    assert.strictEqual(a1, a2);
    assert.notStrictEqual(a1, b);
    assert.notStrictEqual(a1, other);
    assert.ok(!a1.includes("1234"));
});

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

test("the lock UI shows the required disclaimer", () => {
    const { PRIVACY_LOCK_DISCLAIMER } = load();
    assert.strictEqual(PRIVACY_LOCK_DISCLAIMER, "Kunci ini layar privasi, bukan pengaman data. Untuk melindungi data, gunakan Vault.");
});
