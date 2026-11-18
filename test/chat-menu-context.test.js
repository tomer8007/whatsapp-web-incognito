const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    const sandbox = createSandbox();
    // helpers that live in core/utils.js (loaded before this file in the page world)
    loadScripts(sandbox, ["core/utils.js", "core/chat_menu_context.js"]);
    return sandbox;
}

const wid = (s) => ({ toString: () => s });

test("findChatInMenuItems returns the chat of the first menu item that has one", () => {
    const { findChatInMenuItems } = load();
    const chat = { id: wid("628111@c.us") };
    const items = [null, { key: "a", props: {} }, { key: "mark_unread", props: { chat } }, { key: "b", props: { chat: { id: wid("x@c.us") } } }];
    assert.strictEqual(findChatInMenuItems(items), chat);
    assert.strictEqual(findChatInMenuItems([null, { props: {} }]), null);
    assert.strictEqual(findChatInMenuItems(null), null);
});

test("buildChatMenuContext gives normalized pn and lid candidates plus the name", () => {
    const { buildChatMenuContext } = load();
    const context = buildChatMenuContext({
        id: wid("628111@c.us"), accountLid: wid("9999:3@lid"), isGroup: false, formattedTitle: "Budi",
    });
    assert.deepStrictEqual([...context.jids], ["628111@c.us", "9999@lid"]);
    assert.strictEqual(context.name, "Budi");
    assert.strictEqual(context.isGroup, false);
    assert.strictEqual(context.primaryJid, "628111@c.us");
});

test("buildChatMenuContext works for a group and for a chat without lid", () => {
    const { buildChatMenuContext } = load();
    const context = buildChatMenuContext({ id: wid("1203@g.us"), isGroup: true, name: "Keluarga" });
    assert.deepStrictEqual([...context.jids], ["1203@g.us"]);
    assert.strictEqual(context.name, "Keluarga");
    assert.strictEqual(context.isGroup, true);
});

test("buildChatMenuContext never throws on odd input", () => {
    const { buildChatMenuContext } = load();
    assert.strictEqual(buildChatMenuContext(null), null);
    assert.strictEqual(buildChatMenuContext({}), null);
});
