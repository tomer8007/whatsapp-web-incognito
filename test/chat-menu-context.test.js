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

test("listChatContexts lists chats newest first, names only, and skips unnamed ones", () => {
    const s = load();
    const chats = [
        { id: wid("1@c.us"), formattedTitle: "Lama", t: 10, msgs: "secret" },
        { id: wid("2@c.us"), formattedTitle: "Baru", t: 99 },
        { id: wid("3@c.us"), t: 50 },
    ];
    s.WhatsAppAPI = { ChatCollection: { getModelsArray: () => chats } };
    const list = [...s.listChatContexts()];
    assert.deepStrictEqual(list.map((c) => c.name), ["Baru", "Lama"]);
    assert.ok(!JSON.stringify(list).includes("secret"));
    s.WhatsAppAPI = {};
    assert.deepStrictEqual([...s.listChatContexts()], []);
});

test("a group is recognised from the jid server too", () => {
    const { buildChatMenuContext } = load();
    const context = buildChatMenuContext({ id: Object.assign(wid("1203@g.us"), { server: "g.us" }), formattedTitle: "G" });
    assert.strictEqual(context.isGroup, true);
});

// ---- LID / PN chat lookup (core/utils.js) ----
function fakeLookup(chats, pnToLid = {}) {
    const wid = (jid) => ({ jid, toString: () => jid });
    const byId = new Map(chats.map((c) => [c.id.toString(), c]));
    return {
        collection: { get: (w) => byId.get(w.jid), getModelsArray: () => chats },
        createWid: (jid) => wid(jid),
        lidUtils: {
            toLid: (w) => (pnToLid[w.jid] ? wid(pnToLid[w.jid]) : undefined),
            toPn: (w) => { const pn = Object.keys(pnToLid).find((k) => pnToLid[k] === w.jid); return pn ? wid(pn) : undefined; },
        },
        lidPnMap: new Map(),
    };
}
const lidChat = (lid, ids = []) => ({ id: Object.assign(wid(lid), { server: "lid" }), msgs: { getModelsArray: () => ids.map((id) => ({ id: { id } })) } });

test("a PN lookup finds the chat that WhatsApp keys by LID", () => {
    const s = load();
    const chat = lidChat("9@lid");
    const deps = fakeLookup([chat], { "628111@c.us": "9@lid" });
    assert.strictEqual(s.resolveChat(deps, "628111@c.us"), chat);
    assert.strictEqual(s.resolveChat(deps, "628111@s.whatsapp.net"), chat);
});

test("a LID lookup finds the chat directly, and a PN-keyed chat is found from its LID", () => {
    const s = load();
    const lid = lidChat("9@lid");
    const pnChat = { id: Object.assign(wid("5@c.us"), { server: "c.us" }), msgs: { getModelsArray: () => [] } };
    const deps = fakeLookup([lid, pnChat], { "5@c.us": "7@lid", "628111@c.us": "9@lid" });
    assert.strictEqual(s.resolveChat(deps, "9@lid"), lid);
    assert.strictEqual(s.resolveChat(deps, "7@lid"), pnChat);
});

test("when no mapping exists, the chat is found by scanning for the message id", () => {
    const s = load();
    const a = lidChat("1@lid", ["X1"]);
    const b = lidChat("2@lid", ["TARGET", "X2"]);
    const deps = fakeLookup([a, b], {});
    assert.strictEqual(s.resolveChat(deps, "628999@c.us", "TARGET"), b);
    assert.strictEqual(s.resolveChat(deps, "628999@c.us"), null);
    assert.strictEqual(s.resolveChat(deps, "628999@c.us", "NOPE"), null);
});

test("our own lid/pn map is the last mapping tried, and lookup errors never throw", () => {
    const s = load();
    const chat = lidChat("3@lid");
    const deps = fakeLookup([chat], {});
    deps.lidPnMap.set("628111@c.us", "3@lid");
    assert.strictEqual(s.resolveChat(deps, "628111@c.us"), chat);
    deps.lidUtils.toLid = () => { throw new Error("no mapping"); };
    assert.strictEqual(s.resolveChat(deps, "628111@c.us"), chat);
    assert.strictEqual(s.resolveChat({ collection: null }, "x@c.us"), null);
});

test("chatMatchesJid matches the PN of a LID chat, and the chat context lists the PN form too", () => {
    const s = load();
    const chat = Object.assign(lidChat("9@lid"), { accountLid: wid("9@lid"), formattedTitle: "Budi" });
    s.require = () => ({ toPn: () => wid("628111@c.us") });
    assert.strictEqual(s.chatMatchesJid(chat, "628111@c.us"), true);
    assert.strictEqual(s.chatMatchesJid(chat, "9@lid"), true);
    assert.strictEqual(s.chatMatchesJid(chat, "777@c.us"), false);
    assert.deepStrictEqual([...s.buildChatMenuContext(chat).jids].sort(), ["628111@c.us", "9@lid"]);
});

// ---- no wid for JIDs that are not people (WhatsApp logs "Domain not supported") ----

test("lookupCandidateJids builds a wid only for a person's JID", () => {
    const s = load();
    for (const [jid, expectCalls] of [["s.whatsapp.net", 0], ["@s.whatsapp.net", 0], ["status@broadcast", 0], ["123@g.us", 0], ["call", 0], ["", 0], [null, 0],
                                      ["123@newsletter", 0], ["123@bot", 0], ["123@c.us", 1], ["123@s.whatsapp.net", 1], ["123:7@lid", 1]]) {
        let calls = 0;
        const deps = { lidUtils: { toLid: () => undefined, toPn: () => undefined }, createWid: (j) => { calls++; return wid(j); } };
        assert.doesNotThrow(() => s.lookupCandidateJids(jid, deps));
        assert.strictEqual(calls, expectCalls, String(jid));
    }
});

test("lookupCandidateJids still maps PN to LID and back for people", () => {
    const s = load();
    const deps = { lidUtils: { toLid: (w) => wid("9@lid"), toPn: () => wid("628@c.us") }, createWid: (j) => wid(j) };
    assert.deepStrictEqual([...s.lookupCandidateJids("628@s.whatsapp.net", deps)], ["628@c.us", "9@lid"]);
    assert.deepStrictEqual([...s.lookupCandidateJids("9@lid", deps)], ["9@lid", "628@c.us"]);
    assert.deepStrictEqual([...s.lookupCandidateJids("123@g.us", deps)], ["123@g.us"]);
});

test("chat lookup keeps working for groups and status, but never feeds createWid a bare domain", () => {
    const s = load();
    const group = { id: Object.assign(wid("123@g.us"), { server: "g.us" }), msgs: { getModelsArray: () => [] } };
    const seen = [];
    const deps = { collection: { get: (w) => (w.jid == "123@g.us" ? group : undefined), getModelsArray: () => [group] },
                   createWid: (jid) => { seen.push(jid); return Object.assign(wid(jid), { jid }); }, lidUtils: null, lidPnMap: new Map([["s.whatsapp.net", "x"]]) };
    assert.strictEqual(s.resolveChat(deps, "123@g.us"), group);
    assert.strictEqual(s.resolveChat(deps, "s.whatsapp.net"), null);
    assert.ok(!seen.includes("s.whatsapp.net") && !seen.includes("x"), "createWid saw: " + seen.join(","));
});

test("liveLidCounterparts skips non-person JIDs and answers repeated asks from its cache", () => {
    const s = load();
    let widCalls = 0;
    s.window.WhatsAppAPI = { ChatCollection: {}, WAWebWidFactory: { createWid: (j) => { widCalls++; return wid(j); } } };
    s.require = () => ({ toLid: () => wid("9@lid"), toPn: () => wid("628@c.us") });
    assert.deepStrictEqual([...s.liveLidCounterparts("s.whatsapp.net")], []);
    assert.deepStrictEqual([...s.liveLidCounterparts("status@broadcast")], []);
    assert.strictEqual(widCalls, 0);
    for (let i = 0; i < 5; i++) assert.deepStrictEqual([...s.liveLidCounterparts("628@c.us")], ["9@lid"]);
    assert.strictEqual(widCalls, 1, "resolved once, then cached");
});

test("jidParts needs a user and a server", () => {
    const s = load();
    assert.strictEqual(s.jidParts("s.whatsapp.net"), null);
    assert.strictEqual(s.jidParts("@s.whatsapp.net"), null);
    assert.strictEqual(s.jidParts("123@"), null);
    assert.deepStrictEqual({ ...s.jidParts("123:4@lid") }, { user: "123:4", server: "lid" });
});
