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
