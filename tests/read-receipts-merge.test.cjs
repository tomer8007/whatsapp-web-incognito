const assert = require("node:assert/strict");
const fs = require("node:fs");
const test = require("node:test");
const vm = require("node:vm");

function load(context, file)
{
    vm.runInContext(fs.readFileSync(`${__dirname}/../core/${file}.js`, "utf8"), context);
}

test("the document-start hook patches only the WhatsApp comms gate", () =>
{
    const manifest = require("../manifest.json");
    const script = manifest.content_scripts.find(entry => entry.js.includes("core/comms_worker_fix.js"));
    assert.equal(script.world, "MAIN");
    assert.equal(script.run_at, "document_start");

    const window = {};
    const context = vm.createContext({ window });
    load(context, "comms_worker_fix");
    window.__d = (id, deps, factory) => factory({ exports: { isCommsInWorker: () => true } });
    const exportsFromFactory = module => module.exports;
    assert.equal(window.__d("OtherModule", [], exportsFromFactory).isCommsInWorker(), true);
    assert.equal(window.__d("WAWebCommsGating", [], exportsFromFactory).isCommsInWorker(), false);
    assert.equal(window.WAIncognitoCommsModeFix.patched, true);
});

test("a blocked read receipt settles only its own acknowledgement while Mark as read works", async () =>
{
    const callbacks = [];
    const listeners = new Map();
    const settled = [];
    const receipt = (to, id) => ({ type: "read", to, id });
    const ack = attrs => ({ stanza: { attrs }, reject: () => settled.push(attrs.id) });
    const otherChat = ack(receipt("456@c.us", "other-chat"));
    const manualReceipt = ack(receipt("123@c.us", "manual"));
    const partialAck = ack({ type: "read" });
    const comms = { ackHandlers: [otherChat, manualReceipt, partialAck, ack(receipt("123:2@s.whatsapp.net", "blocked"))] };
    const chat = { id: "123@c.us", unreadCount: 1 };
    const WhatsAppAPI = {
        Communication: comms,
        ChatCollection: { find: async () => chat },
        Seen: {
            sendSeen: async ({ chat: nativeChat, afterAvailable }) =>
            {
                assert.equal(nativeChat, chat);
                assert.equal(afterAvailable, false);
                assert.equal(context.NodeHandler.isSentNodeAllowed({ tag: "receipt", attrs: receipt("123@c.us", "manual") }), true);
                nativeChat.unreadCount = 0;
            }
        }
    };
    const context = vm.createContext({
        window: { WhatsAppAPI }, WhatsAppAPI,
        console: { log() {} },
        document: {
            addEventListener: (type, callback) => listeners.set(type, callback),
            dispatchEvent() {},
            getElementsByClassName: () => []
        },
        CustomEvent,
        setTimeout: (callback, delay) => { if (delay === 200) callbacks.push(callback); },
        readConfirmationsHookEnabled: true,
        readReceiptExceptions: new Map(),
        blockedChats: new Map()
    });
    load(context, "utils");
    load(context, "node_handler");
    load(context, "injected_ui");

    assert.equal(context.NodeHandler.isSentNodeAllowed({ tag: "receipt", attrs: receipt("123@c.us", "blocked") }), false);
    await listeners.get("sendReadConfirmation")({ detail: '{"jid":"123@c.us","unreadCount":1}' });
    assert.equal(chat.unreadCount, 0);
    for (const callback of callbacks) callback();
    assert.deepEqual(settled, ["blocked"]);
    assert.deepEqual(Array.from(comms.ackHandlers), [otherChat, manualReceipt, partialAck]);
});

test("a reopened chat restores its warning only while the receipt is blocked", () =>
{
    const callbacks = [];
    const listeners = new Map();
    const blockedChats = new Map([["123@lid", new Set(["123@lid"])]]);
    const chat = { accountLid: "123:1@lid" };
    const context = vm.createContext({
        window: { WhatsAppAPI: { ChatCollection: { getActive: () => chat } } },
        document: { addEventListener: (type, callback) => listeners.set(type, callback), dispatchEvent() {} },
        CustomEvent,
        setTimeout: callback => callbacks.push(callback),
        blockedChats,
        readConfirmationsHookEnabled: true
    });
    load(context, "utils");
    load(context, "injected_ui");
    const marked = [];
    context.markChatAsBlocked = chat => marked.push(chat);

    listeners.get("onPaneChatOpened")();
    callbacks.pop()();
    assert.deepEqual(marked, [chat]);
    listeners.get("onPaneChatOpened")();
    blockedChats.clear();
    callbacks.pop()();
    assert.deepEqual(marked, [chat]);
});
