const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const wid = (s) => ({ toString: () => s });

function load(requireMap = {}) {
    const sandbox = createSandbox({ require: (name) => { if (requireMap[name]) return requireMap[name]; throw new Error("no module " + name); } });
    loadScripts(sandbox, ["core/utils.js", "core/hidetag.js"]);
    return sandbox;
}

const groupWith = (ids, extra = {}) => ({ id: Object.assign(wid("1@g.us"), { server: "g.us" }), groupMetadata: { participants: { getModelsArray: () => ids.map((id) => ({ id: wid(id) })) } }, ...extra });

test("the plan lists every member except the user, PN and LID alike, without duplicates", () => {
    const s = load();
    const chat = groupWith(["9@lid", "628111@c.us", "7@lid", "7:3@lid", "5@lid"]);
    const plan = s.buildHidetagPlan(chat, ["5@lid", "628999@c.us"]);
    assert.strictEqual(plan.ok, true);
    assert.deepStrictEqual([...plan.wids.map((w) => w.toString())], ["9@lid", "628111@c.us", "7@lid"]);
    assert.strictEqual(plan.count, 3);
    assert.strictEqual(plan.big, false);
});

test("the user's own PN form is excluded too (LID group, self known by PN)", () => {
    const s = load();
    const plan = s.buildHidetagPlan(groupWith(["628999@c.us", "9@lid"]), ["628999@s.whatsapp.net"]);
    assert.deepStrictEqual([...plan.wids.map((w) => w.toString())], ["9@lid"]);
});

test("edge cases: only the user (nobody to mention), a chat that is not a group, missing metadata", () => {
    const s = load();
    assert.strictEqual(s.buildHidetagPlan(groupWith(["5@lid"]), ["5@lid"]).count, 0);
    assert.strictEqual(s.buildHidetagPlan({ id: Object.assign(wid("1@c.us"), { server: "c.us" }) }, []).error, "not-a-group");
    assert.strictEqual(s.buildHidetagPlan({ id: Object.assign(wid("1@g.us"), { server: "g.us" }) }, []).error, "no-metadata");
    assert.strictEqual(s.buildHidetagPlan(groupWith(["1@lid", "2@lid"]), []).count, 2, "1-member style groups still work");
});

test("a big group is flagged above 256 members", () => {
    const s = load();
    const ids = Array.from({ length: 257 }, (_, i) => i + "@lid");
    assert.strictEqual(s.buildHidetagPlan(groupWith(ids), []).big, true);
    assert.strictEqual(s.buildHidetagPlan(groupWith(ids.slice(0, 256)), []).big, false);
});

test("the options are exactly what WhatsApp's text sender reads", () => {
    const s = load();
    const plan = s.buildHidetagPlan(groupWith(["1@lid", "2@lid"]), []);
    const options = s.buildHidetagOptions(plan);
    assert.deepStrictEqual(Object.keys(options).sort(), ["groupMentions", "mentionedJidList"]);
    assert.strictEqual(options.mentionedJidList.length, 2);
    assert.deepStrictEqual([...options.groupMentions], []);
});

test("dry run builds the message with createTextMsgData and sends nothing; the summary has no text", async () => {
    const sent = [];
    const s = load({
        WAWebSendTextMsgChatAction: { createTextMsgData: async (chat, text, options) => ({ body: text, mentionedJidList: options.mentionedJidList, groupMentions: options.groupMentions, id: "x" }) },
        WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => wid("5@lid"), getMaybeMePnUser: () => wid("628999@c.us") },
    });
    s.findSendTextFunction = () => (...args) => { sent.push(args); };
    const result = await s.sendHidetag(groupWith(["5@lid", "1@lid", "2@lid"]), "halo", true);
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.count, 2);
    assert.strictEqual(result.dry.mentionedJidListLength, 2);
    assert.strictEqual(result.dry.bodyIsText, true);
    assert.ok(!JSON.stringify(result).includes("halo"));
    assert.strictEqual(sent.length, 0);
});

test("the real send passes the mention list through the sender and checks the result", async () => {
    const calls = [];
    const s = load({
        WAWebSendMsgResultAction: { SendMsgResult: { OK: "OK" } },
        WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => wid("5@lid") },
    });
    s.findSendTextFunction = () => async (chat, text, options) => { calls.push({ text, options }); return { messageSendResult: "OK" }; };
    const ok = await s.sendHidetag(groupWith(["5@lid", "1@lid"]), "halo", false);
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].text, "halo");
    assert.strictEqual(calls[0].options.mentionedJidList.length, 1);
    s.findSendTextFunction = () => async () => ({ messageSendResult: "ERROR_UNKNOWN" });
    const failed = await s.sendHidetag(groupWith(["5@lid", "1@lid"]), "halo", false);
    assert.strictEqual(failed.ok, false);
    assert.ok(/send result/.test(failed.error));
});

test("empty text, no members and a missing sender are refused without sending", async () => {
    const s = load({});
    s.findSendTextFunction = () => null;
    assert.strictEqual((await s.sendHidetag(groupWith(["1@lid"]), "   ", false)).error, "empty-text");
    assert.strictEqual((await s.sendHidetag(groupWith([]), "x", false)).error, "no-members");
    assert.strictEqual((await s.sendHidetag(groupWith(["1@lid"]), "x", false)).error, "send function not found");
});

// ---- the "choose members" mode ----

test("selected mode mentions exactly the chosen members (subset, PN/LID mix, deduped)", () => {
    const s = load();
    const chat = groupWith(["9@lid", "628111@c.us", "7@lid", "5@lid"]);
    const plan = s.buildHidetagPlan(chat, ["5@lid"], ["628111@c.us", "7@lid", "7:2@lid", "628111@s.whatsapp.net"]);
    assert.strictEqual(plan.ok, true);
    assert.deepStrictEqual([...plan.wids.map((w) => w.toString())], ["628111@c.us", "7@lid"]);
    assert.strictEqual(plan.count, 2);
});

test("a chosen id that is not in the group is rejected, and so is an empty or invalid selection", () => {
    const s = load();
    const chat = groupWith(["9@lid", "7@lid"]);
    assert.strictEqual(s.buildHidetagPlan(chat, [], ["9@lid", "555@lid"]).error, "unknown-member");
    assert.strictEqual(s.buildHidetagPlan(chat, [], []).error, "empty-selection");
    assert.strictEqual(s.buildHidetagPlan(chat, [], "9@lid").error, "empty-selection");
    assert.strictEqual(s.buildHidetagPlan(chat, [], null).count, 2, "null means everybody");
});

test("the user is excluded even when selected; selecting only the user leaves nobody", () => {
    const s = load();
    const chat = groupWith(["9@lid", "5@lid"]);
    const plan = s.buildHidetagPlan(chat, ["5@lid"], ["9@lid", "5@lid"]);
    assert.deepStrictEqual([...plan.wids.map((w) => w.toString())], ["9@lid"]);
    assert.strictEqual(s.buildHidetagPlan(chat, ["5@lid"], ["5@lid"]).count, 0);
});

test("a PN selection matches a LID participant through WhatsApp's mapping", () => {
    const s = load();
    s.liveLidCounterparts = (jid) => (jid == "9@lid" ? ["628111@c.us"] : []);
    const plan = s.buildHidetagPlan(groupWith(["9@lid", "7@lid"]), [], ["628111@c.us"]);
    assert.deepStrictEqual([...plan.wids.map((w) => w.toString())], ["9@lid"]);
});

test("the selected send passes only the chosen members and the dry run stays text-free", async () => {
    const calls = [];
    const s = load({
        WAWebSendTextMsgChatAction: { createTextMsgData: async (chat, text, options) => ({ body: text, mentionedJidList: options.mentionedJidList, groupMentions: [] }) },
        WAWebSendMsgResultAction: { SendMsgResult: { OK: "OK" } },
    });
    s.findSendTextFunction = () => async (chat, text, options) => { calls.push(options.mentionedJidList.map((w) => w.toString())); return { messageSendResult: "OK" }; };
    const chat = groupWith(["1@lid", "2@lid", "3@lid"]);
    const dry = await s.sendHidetag(chat, "halo", true, ["2@lid"]);
    assert.strictEqual(dry.dry.mentionedJidListLength, 1);
    assert.ok(!JSON.stringify(dry).includes("halo"));
    assert.strictEqual((await s.sendHidetag(chat, "halo", false, ["1@lid", "3@lid"])).ok, true);
    assert.deepStrictEqual(calls.map((c) => [...c]), [["1@lid", "3@lid"]]);
    assert.strictEqual((await s.sendHidetag(chat, "halo", false, ["9@lid"])).error, "unknown-member");
    assert.strictEqual(calls.length, 1);
});

test("member names: contact name, else the last 4 digits only, never the full number", () => {
    const s = load({ WAWebContactCollection: { ContactCollection: { get: (w) => (w.toString() == "1@lid" ? { name: "Budi" } : null) } } });
    const chat = groupWith(["1@lid", "628111222333@c.us", "5@lid"]);
    const members = [...s.listHidetagMembers(chat, ["5@lid"])];
    assert.deepStrictEqual(members.map((m) => m.name).sort(), ["...2333", "Budi"]);
    assert.ok(!JSON.stringify(members.map((m) => m.name)).includes("628111"));
    assert.strictEqual(s.maskedMemberName("12@c.us"), "...");
});

// ---- reply, composer and sticker ----

test("a reply hidetag passes quotedMsg to the sender; a plain one does not", async () => {
    const seen = [];
    const s = load({ WAWebSendMsgResultAction: { SendMsgResult: { OK: "OK" } } });
    s.findSendTextFunction = () => async (chat, text, options) => { seen.push({ ...options }); return { messageSendResult: "OK" }; };
    const chat = groupWith(["1@lid", "2@lid"]);
    const quoted = { id: "quoted-model" };
    assert.strictEqual((await s.sendHidetag(chat, "halo", false, null, quoted)).ok, true);
    assert.strictEqual((await s.sendHidetag(chat, "halo", false, null)).ok, true);
    assert.strictEqual(seen[0].quotedMsg, quoted);
    assert.ok(!("quotedMsg" in seen[1]));
    assert.strictEqual(seen[0].mentionedJidList.length, 2);
});

test("dry run reports whether the built message is a reply, without the text", async () => {
    const s = load({ WAWebSendTextMsgChatAction: { createTextMsgData: async (chat, text, options) => ({ body: text, mentionedJidList: options.mentionedJidList, quotedMsg: options.quotedMsg, quotedStanzaID: options.quotedMsg ? "S1" : undefined }) } });
    const chat = groupWith(["1@lid"]);
    const reply = await s.sendHidetag(chat, "rahasia", true, null, { id: "m" });
    const plain = await s.sendHidetag(chat, "rahasia", true, null);
    assert.strictEqual(reply.dry.hasQuoted, true);
    assert.strictEqual(plain.dry.hasQuoted, false);
    assert.ok(!JSON.stringify([reply, plain]).includes("rahasia"));
});

test("a failing reply send reports the error and leaves nothing half-done", async () => {
    const s = load({ WAWebSendMsgResultAction: { SendMsgResult: { OK: "OK" } } });
    s.findSendTextFunction = () => async () => { throw new Error("boom"); };
    const result = await s.sendHidetag(groupWith(["1@lid"]), "x", false, null, { id: "m" });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.error, "boom");
});

test("composer: the draft is read from the chat model, else from the text box; clearing empties text and reply target", () => {
    const s = load();
    assert.strictEqual(s.readComposerText({ getComposeContents: () => ({ text: "draf", timestamp: 1 }) }), "draf");
    s.document = { querySelector: () => ({ innerText: "dari kotak" }) };
    assert.strictEqual(s.readComposerText({ getComposeContents: () => { throw new Error("x"); } }), "dari kotak");
    assert.strictEqual(s.readComposerText(null), "dari kotak");
    const calls = [];
    const chat = { setComposeContents: (c) => calls.push(c), composeQuotedMsg: { id: 1 }, composeQuotedMsgRemoteJid: "x" };
    s.document = { querySelector: () => null, execCommand() {} };
    s.clearComposer(chat);
    assert.strictEqual(calls.length, 1);
    assert.strictEqual(calls[0].text, "");
    assert.strictEqual(chat.composeQuotedMsg, null);
    assert.doesNotThrow(() => s.clearComposer({ setComposeContents() { throw new Error("no"); } }));
});

test("sticker arm: merged once, never mutates the original options, honors the reply target, expires", () => {
    const s = load();
    const arm = { options: { mentionedJidList: ["a", "b"], groupMentions: [] }, useQuote: true, expires: 5000 };
    const original = { stickerSendOrigin: 3, quotedMsg: null };
    const used = s.applyStickerArm(arm, { composeQuotedMsg: { id: "q" } }, ["chat", "sticker", original], 1000);
    assert.strictEqual(used.used, true);
    assert.deepStrictEqual([...used.args[2].mentionedJidList], ["a", "b"]);
    assert.strictEqual(used.args[2].stickerSendOrigin, 3);
    assert.deepStrictEqual({ ...used.args[2].quotedMsg }, { id: "q" });
    assert.deepStrictEqual({ ...original }, { stickerSendOrigin: 3, quotedMsg: null }, "caller object untouched");
    assert.strictEqual(s.applyStickerArm(arm, null, ["c", "s", {}], 5001).used, false, "expired");
    assert.strictEqual(s.applyStickerArm(null, null, ["c", "s", {}], 1).used, false, "not armed");
    assert.strictEqual(s.applyStickerArm(arm, { composeQuotedMsg: { id: "q" } }, ["c", "s", { quotedMsg: { id: "own" } }], 1).args[2].quotedMsg.id, "own", "an existing reply target wins");
});

test("sticker wrapper: pass-through when not armed, one-shot injection when armed, never throws, wraps once", () => {
    const s = load();
    const calls = [];
    const mod = { sendStickerToChat: function(...args) { calls.push(args); return "sent"; } };
    assert.strictEqual(s.installStickerHook(mod), true);
    assert.strictEqual(s.installStickerHook(mod), true);
    const first = mod.sendStickerToChat("chat", "sticker", { stickerSendOrigin: 3 });
    assert.strictEqual(first, "sent");
    assert.deepStrictEqual({ ...calls[0][2] }, { stickerSendOrigin: 3 }, "untouched when not armed");
    s.stickerArm = { options: { mentionedJidList: ["x"], groupMentions: [] }, useQuote: false, expires: Date.now() + 3000 };
    mod.sendStickerToChat("chat", "sticker", { stickerSendOrigin: 3 });
    assert.deepStrictEqual([...calls[1][2].mentionedJidList], ["x"]);
    mod.sendStickerToChat("chat", "sticker", { stickerSendOrigin: 3 });
    assert.ok(!("mentionedJidList" in calls[2][2]), "one shot");
    s.stickerArm = { options: null, useQuote: false, expires: Date.now() + 3000 }; // a broken arm must not break sending
    assert.doesNotThrow(() => mod.sendStickerToChat("chat", "sticker", {}));
    assert.strictEqual(calls.length, 4);
    assert.strictEqual(s.installStickerHook({}), false);
    assert.strictEqual(s.installStickerHook(null), false);
});

test("arming needs members and a sticker module; the arm lasts about three seconds", () => {
    const mod = { sendStickerToChat() {} };
    const s = load({ WAWebSendStickerAction: mod, WAWebUserPrefsMeUser: { getMaybeMeLidUser: () => wid("5@lid") } });
    const before = Date.now();
    const result = s.armStickerHidetag(groupWith(["5@lid", "1@lid", "2@lid"]), null);
    assert.deepStrictEqual([result.ok, result.count], [true, 2]);
    assert.ok(s.stickerArm.expires >= before + 2900 && s.stickerArm.expires <= Date.now() + 3100);
    assert.strictEqual(s.armStickerHidetag(groupWith(["5@lid"]), null).error, "no-members");
    assert.strictEqual(s.armStickerHidetag(groupWith(["1@lid"]), ["9@lid"]).error, "unknown-member");
    const none = load({});
    assert.strictEqual(none.armStickerHidetag(groupWith(["1@lid"]), null).error, "sticker send function not found");
});
