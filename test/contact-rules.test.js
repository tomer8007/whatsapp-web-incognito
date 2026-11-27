const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function loadRules() {
    return loadScripts(createSandbox(), ["core/utils.js", "core/contact_rules.js"]);
}

test("resolveRule: default follows the global setting", () => {
    const { resolveRule } = loadRules();
    assert.strictEqual(resolveRule({}, ["1@c.us"], "readReceipts", true), true);
    assert.strictEqual(resolveRule({}, ["1@c.us"], "readReceipts", false), false);
    assert.strictEqual(resolveRule({ "1@c.us": { readReceipts: "default" } }, ["1@c.us"], "readReceipts", true), true);
});

test("resolveRule: block and allow override the global setting", () => {
    const { resolveRule } = loadRules();
    const rules = { "1@c.us": { readReceipts: "block", typing: "allow" } };
    assert.strictEqual(resolveRule(rules, ["1@c.us"], "readReceipts", false), true, "block beats global off");
    assert.strictEqual(resolveRule(rules, ["1@c.us"], "typing", true), false, "allow beats global on");
    assert.strictEqual(resolveRule(rules, ["2@c.us"], "readReceipts", false), false, "other contacts follow global");
});

test("resolveRule: the field is independent, and any candidate (pn or lid) can match", () => {
    const { resolveRule } = loadRules();
    const rules = { "99@lid": { typing: "block" } };
    assert.strictEqual(resolveRule(rules, ["1@c.us", "99@lid"], "typing", false), true);
    assert.strictEqual(resolveRule(rules, ["1@c.us", "99@lid"], "readReceipts", false), false);
    assert.strictEqual(resolveRule(null, ["1@c.us"], "typing", true), true, "no rules at all");
});

test("jidCandidates normalizes and adds the counterpart from the lid/pn map", () => {
    const sandbox = loadRules();
    const map = new Map();
    map.set("99@lid", "628@c.us");
    map.set("628@c.us", "99@lid");
    assert.deepStrictEqual([...sandbox.jidCandidates("99:5@lid", map)], ["99@lid", "628@c.us"]);
    assert.deepStrictEqual([...sandbox.jidCandidates("628@s.whatsapp.net", map)], ["628@c.us", "99@lid"]);
    assert.deepStrictEqual([...sandbox.jidCandidates("777@c.us", map)], ["777@c.us"]);
    assert.deepStrictEqual([...sandbox.jidCandidates(null, map)], []);
});

test("rememberLidPair stores both directions", () => {
    const sandbox = loadRules();
    const map = new Map();
    sandbox.rememberLidPair(map, "99:2@lid", "628@s.whatsapp.net");
    assert.strictEqual(map.get("99@lid"), "628@c.us");
    assert.strictEqual(map.get("628@c.us"), "99@lid");
    sandbox.rememberLidPair(map, null, "628@s.whatsapp.net"); // nothing to pair
    assert.strictEqual(map.size, 2);
});

test("applyContactRule sets a field, drops default fields and empty contacts", () => {
    const { applyContactRule } = loadRules();
    let rules = applyContactRule({}, "1@c.us", "typing", "block");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), { "1@c.us": { typing: "block" } });
    rules = applyContactRule(rules, "1@c.us", "readReceipts", "allow");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), { "1@c.us": { typing: "block", readReceipts: "allow" } });
    rules = applyContactRule(rules, "1@c.us", "typing", "default");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), { "1@c.us": { readReceipts: "allow" } });
    rules = applyContactRule(rules, "1@c.us", "readReceipts", "default");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), {});
});

test("applyContactRule ignores invalid fields and values", () => {
    const { applyContactRule } = loadRules();
    const rules = { "1@c.us": { typing: "block" } };
    assert.deepStrictEqual(JSON.parse(JSON.stringify(applyContactRule(rules, "1@c.us", "online", "block"))), rules);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(applyContactRule(rules, "1@c.us", "typing", "maybe"))), rules);
});

// ---- NodeHandler.isSentNodeAllowed with contact rules ----

function loadHandlerWithRules(rules, globals = {}) {
    const sandbox = createSandbox({ deepClone: (o) => JSON.parse(JSON.stringify(o)), Message: { ProtocolMessage: { Type: { REVOKE: { value: 0 } } } } });
    loadScripts(sandbox, ["core/utils.js", "core/contact_rules.js", "core/node_handler.js", "core/interception.js"]);
    sandbox.__timers.length = 0;
    sandbox.WhatsAppAPI = {};
    Object.assign(sandbox, globals);
    sandbox.contactRules = rules;
    return sandbox;
}

const readNode = (jid) => ({ tag: "receipt", attrs: { type: "read", to: jid }, content: [] });
const typingNode = (jid) => ({ tag: "chatstate", attrs: { to: jid }, content: [{ tag: "composing" }] });
const playedNode = (jid) => ({ tag: "receipt", attrs: { type: "played", to: jid }, content: [] });

test("isSentNodeAllowed: a contact set to allow gets read receipts even when blocking globally", () => {
    const s = loadHandlerWithRules({ "111@c.us": { readReceipts: "allow" } });
    s.readConfirmationsHookEnabled = true;
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(readNode("111@s.whatsapp.net")), true);
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(readNode("222@s.whatsapp.net")), false, "others stay blocked");
});

test("isSentNodeAllowed: a contact set to block gets no receipts even when globally allowed", () => {
    const s = loadHandlerWithRules({ "111@c.us": { readReceipts: "block" } });
    s.readConfirmationsHookEnabled = false;
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(readNode("111@s.whatsapp.net")), false);
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(readNode("222@s.whatsapp.net")), true);
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(playedNode("111@s.whatsapp.net")), false, "played is blocked for an explicit block");
});

test("isSentNodeAllowed: typing follows the contact rule", () => {
    const s = loadHandlerWithRules({ "111@c.us": { typing: "block" }, "222@c.us": { typing: "allow" } });
    s.typingUpdatesHookEnabled = false;
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(typingNode("111@s.whatsapp.net")), false);
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(typingNode("333@s.whatsapp.net")), true);
    s.typingUpdatesHookEnabled = true;
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(typingNode("222@s.whatsapp.net")), true);
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(typingNode("333@s.whatsapp.net")), false);
});

test("isSentNodeAllowed: the online presence stays global", () => {
    const s = loadHandlerWithRules({ "111@c.us": { readReceipts: "allow", typing: "allow" } });
    s.onlineUpdatesHookEnabled = true;
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed({ tag: "presence", attrs: { type: "available", to: "111@s.whatsapp.net" }, content: [] }), false);
});

test("isSentNodeAllowed: a rule stored under the lid matches through the lid/pn map", () => {
    const s = loadHandlerWithRules({ "99@lid": { readReceipts: "allow" } });
    s.readConfirmationsHookEnabled = true;
    s.rememberLidPair(s.lidPnMap, "99@lid", "111@s.whatsapp.net");
    assert.strictEqual(s.NodeHandler.isSentNodeAllowed(readNode("111@s.whatsapp.net")), true);
});

test("onReceivedMessageNode remembers the lid/pn pair of the sender", async () => {
    const s = loadHandlerWithRules({});
    s.MultiDevice = { decryptE2EMessagesFromMessageNode: async () => [] };
    await s.NodeHandler.onReceivedMessageNode({ tag: "message", attrs: { id: "M", from: "99@lid", sender_pn: "628@s.whatsapp.net" }, content: [] });
    assert.strictEqual(s.lidPnMap.get("99@lid"), "628@c.us");
});

// ---- background messages ----

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
    return { store, send: (message) => new Promise((resolve) => listener(message, {}, resolve)) };
}

test("background: getContactRules returns {} by default and setContactRule persists", async () => {
    const bg = loadBackground();
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await bg.send({ name: "getContactRules" }))), {});
    const rules = await bg.send({ name: "setContactRule", jid: "1@c.us", field: "typing", value: "block" });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), { "1@c.us": { typing: "block" } });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(bg.store.contactRules)), { "1@c.us": { typing: "block" } });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(await bg.send({ name: "getContactRules" }))), { "1@c.us": { typing: "block" } });
});

// ---- per-contact settings beyond blue ticks and typing ----

test("the schema covers the 15 per-contact keys with a kind each", () => {
    const { CONTACT_RULE_SCHEMA } = loadRules();
    assert.deepStrictEqual([...CONTACT_RULE_SCHEMA.map((e) => e.key)], [
        "readReceipts", "typing", "showDeviceTypes", "autoReceiptOnReplay", "showReadWarning", "saveDeletedMsgs", "markDeleted",
        "saveEdits", "toastOnDelete", "toastOnEdit", "keepDisappearing", "blurMessages", "blurMedia", "blurAvatars", "autoSchedule"]);
});

test("onOff keys: on/off override the global value, default follows it", () => {
    const { resolveToggle } = loadRules();
    const rules = { "1@c.us": { saveEdits: "on", toastOnEdit: "off" }, "9@lid": { keepDisappearing: "on" } };
    assert.strictEqual(resolveToggle(rules, ["1@c.us"], "saveEdits", false), true, "on beats global off");
    assert.strictEqual(resolveToggle(rules, ["1@c.us"], "toastOnEdit", true), false, "off beats global on");
    assert.strictEqual(resolveToggle(rules, ["1@c.us"], "keepDisappearing", true), true, "no rule follows global");
    assert.strictEqual(resolveToggle(rules, ["1@c.us", "9@lid"], "keepDisappearing", false), true, "found through the LID form");
    assert.strictEqual(resolveToggle(rules, ["2@c.us"], "saveEdits", false), false, "other contacts follow global");
    assert.strictEqual(resolveToggle(null, ["1@c.us"], "saveEdits", true), true);
});

test("a stored value of the wrong kind is ignored (block on an onOff key, on on a blockAllow key)", () => {
    const { resolveToggle, resolveRule } = loadRules();
    assert.strictEqual(resolveToggle({ "1@c.us": { saveEdits: "block" } }, ["1@c.us"], "saveEdits", true), true);
    assert.strictEqual(resolveRule({ "1@c.us": { readReceipts: "on" } }, ["1@c.us"], "readReceipts", false), false);
});

test("choice keys: a stored number wins, anything else follows global", () => {
    const { resolveChoice } = loadRules();
    assert.strictEqual(resolveChoice({ "1@c.us": { autoSchedule: 15 } }, ["1@c.us"], "autoSchedule", 0), 15);
    assert.strictEqual(resolveChoice({ "1@c.us": { autoSchedule: 9 } }, ["1@c.us"], "autoSchedule", 60), 60, "not an allowed delay");
    assert.strictEqual(resolveChoice({}, ["1@c.us"], "autoSchedule", 0), 0);
    assert.strictEqual(resolveChoice({ "9@lid": { autoSchedule: 60 } }, ["1@c.us", "9@lid"], "autoSchedule", 0), 60);
});

test("applyContactRule validates per kind, keeps old rules, drops defaults, and clearContactRules resets", () => {
    const { applyContactRule, clearContactRules, countContactRules } = loadRules();
    let rules = { "1@c.us": { readReceipts: "block" } }; // an old-style rule keeps working
    rules = applyContactRule(rules, "1@c.us", "saveEdits", "on");
    rules = applyContactRule(rules, "1@c.us", "autoSchedule", 15);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(rules)), { "1@c.us": { readReceipts: "block", saveEdits: "on", autoSchedule: 15 } });
    assert.deepStrictEqual(JSON.parse(JSON.stringify(applyContactRule(rules, "1@c.us", "saveEdits", "block"))), JSON.parse(JSON.stringify(rules)), "wrong kind ignored");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(applyContactRule(rules, "1@c.us", "autoSchedule", 7))), JSON.parse(JSON.stringify(rules)), "delay not allowed");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(applyContactRule(rules, "1@c.us", "nope", "on"))), JSON.parse(JSON.stringify(rules)));
    assert.strictEqual(countContactRules(rules, ["1@c.us", "9@lid"]), 3);
    rules["9@lid"] = { saveEdits: "off" };
    assert.strictEqual(countContactRules(rules, ["1@c.us", "9@lid"]), 3, "the same key under two forms counts once");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(clearContactRules(rules, ["1@c.us", "9@lid"]))), {});
    let single = applyContactRule({ "1@c.us": { saveEdits: "on" } }, "1@c.us", "saveEdits", "default");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(single)), {});
});

test("contactOptionsFor applies the toggles of one contact to the options, nothing else", () => {
    const s = loadRules();
    const options = { ...s.defaultOptions?.(), saveEdits: false, toastOnEdit: true, keepDisappearing: false, safetyDelay: 5 };
    const map = new Map([["628@c.us", "9@lid"], ["9@lid", "628@c.us"]]);
    const rules = { "9@lid": { saveEdits: "on", toastOnEdit: "off" } };
    const result = s.contactOptionsFor("628@s.whatsapp.net", options, rules, map);
    assert.strictEqual(result.saveEdits, true);
    assert.strictEqual(result.toastOnEdit, false);
    assert.strictEqual(result.keepDisappearing, false);
    assert.strictEqual(result.safetyDelay, 5);
    assert.strictEqual(options.saveEdits, false, "the global options object is not changed");
});

test("jidCandidates also uses WhatsApp's own LID mapping when it is available", () => {
    const s = loadRules();
    s.liveLidCounterparts = (jid) => (jid == "628@c.us" ? ["9@lid"] : []);
    assert.deepStrictEqual([...s.jidCandidates("628@c.us", null)], ["628@c.us", "9@lid"]);
});

test("isBlockedForContact does no lookups for JIDs without a user part, and still follows the rules for contacts and groups", () => {
    const sandbox = loadScripts(createSandbox(), ["core/options_schema.js", "core/utils.js", "core/contact_rules.js", "core/node_handler.js"]);
    let lookups = 0;
    sandbox.liveLidCounterparts = () => { lookups++; return []; };
    sandbox.contactRules = { "1@c.us": { readReceipts: "allow" }, "9@g.us": { readReceipts: "block" } };
    for (const jid of ["", "s.whatsapp.net", "call", null, undefined]) assert.strictEqual(sandbox.NodeHandler.isBlockedForContact(jid, "readReceipts", true), true, String(jid));
    assert.strictEqual(lookups, 0);
    assert.strictEqual(sandbox.NodeHandler.isBlockedForContact("1@c.us", "readReceipts", true), false);
    assert.strictEqual(sandbox.NodeHandler.isBlockedForContact("9@g.us", "readReceipts", false), true);
    assert.strictEqual(sandbox.NodeHandler.isBlockedForContact("2@c.us", "readReceipts", true), true);
});
