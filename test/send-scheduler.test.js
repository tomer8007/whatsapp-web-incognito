const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const MINUTE = 60 * 1000;

function setup({ initial = [], send, minIntervalMs } = {}) {
    const sandbox = loadScripts(createSandbox(), ["core/send_scheduler.js"]);
    let clock = 1000;
    const timers = new Map();
    let nextHandle = 1;
    const sent = [];
    const overdue = [];
    const state = { items: initial };
    const scheduler = sandbox.createSendScheduler({
        now: () => clock,
        setTimer: (fn, ms) => { const handle = nextHandle++; timers.set(handle, { fn, at: clock + ms }); return handle; },
        clearTimer: (handle) => { timers.delete(handle); },
        store: { get: async () => JSON.parse(JSON.stringify(state.items)), set: async (items) => { state.items = JSON.parse(JSON.stringify(items)); } },
        send: send || (async (message) => { sent.push({ ...message, at: clock }); return { ok: true }; }),
        onOverdue: (items) => { overdue.push(...items.map((i) => ({ ...i }))); },
        minIntervalMs,
    });
    const advance = async (ms) => {
        clock += ms;
        for (let round = 0; round < 5; round++) {
            const due = [...timers].filter(([, timer]) => timer.at <= clock);
            if (due.length == 0) break;
            for (const [handle, timer] of due) { timers.delete(handle); await timer.fn(); }
        }
    };
    return { scheduler, timers, sent, overdue, state, advance };
}

const plain = (value) => JSON.parse(JSON.stringify(value));

test("add returns an id, lists the item, persists it, and sends it when due", async () => {
    const t = setup();
    const id = await t.scheduler.add("1@c.us", "halo", 5000);
    assert.ok(id);
    assert.deepStrictEqual(plain(t.scheduler.list()).map((i) => [i.id, i.jid, i.text, i.dueAt]), [[id, "1@c.us", "halo", 5000]]);
    assert.strictEqual(t.state.items.length, 1);

    await t.advance(3999);
    assert.strictEqual(t.sent.length, 0);
    await t.advance(1);
    assert.deepStrictEqual(plain(t.sent).map((s) => [s.jid, s.text]), [["1@c.us", "halo"]]);
    assert.strictEqual(t.scheduler.list().length, 0);
    assert.strictEqual(t.state.items.length, 0);
});

test("cancel removes the item and its timer", async () => {
    const t = setup();
    const id = await t.scheduler.add("1@c.us", "halo", 5000);
    await t.scheduler.cancel(id);
    assert.strictEqual(t.timers.size, 0);
    assert.strictEqual(t.scheduler.list().length, 0);
    assert.strictEqual(t.state.items.length, 0);
    await t.advance(10000);
    assert.strictEqual(t.sent.length, 0);
});

test("ids are unique", async () => {
    const t = setup();
    const a = await t.scheduler.add("1@c.us", "a", 5000);
    const b = await t.scheduler.add("1@c.us", "b", 5000);
    assert.notStrictEqual(a, b);
});

test("two messages due together are spaced by the minimum interval", async () => {
    const t = setup({ minIntervalMs: MINUTE });
    await t.scheduler.add("1@c.us", "satu", 2000);
    await t.scheduler.add("2@c.us", "dua", 2000);
    await t.advance(1000);
    assert.deepStrictEqual(plain(t.sent).map((s) => s.text), ["satu"]);
    await t.advance(30 * 1000);
    assert.deepStrictEqual(plain(t.sent).map((s) => s.text), ["satu"], "still inside the interval");
    await t.advance(30 * 1000);
    assert.deepStrictEqual(plain(t.sent).map((s) => s.text), ["satu", "dua"]);
    assert.ok(t.sent[1].at - t.sent[0].at >= MINUTE);
});

test("the default minimum interval is 60 seconds", async () => {
    const t = setup();
    await t.scheduler.add("1@c.us", "satu", 2000);
    await t.scheduler.add("2@c.us", "dua", 2000);
    await t.advance(1000);
    await t.advance(59 * 1000);
    assert.strictEqual(t.sent.length, 1);
    await t.advance(1000);
    assert.strictEqual(t.sent.length, 2);
});

test("restore does not send overdue items: they go to onOverdue and stay in the list", async () => {
    const t = setup({ initial: [{ id: "old", jid: "1@c.us", text: "overdue", dueAt: 500 }, { id: "soon", jid: "2@c.us", text: "later", dueAt: 4000 }] });
    await t.scheduler.restore();
    assert.strictEqual(t.sent.length, 0, "nothing sent automatically");
    assert.deepStrictEqual(plain(t.overdue).map((i) => i.id), ["old"]);
    assert.deepStrictEqual(plain(t.scheduler.list()).map((i) => [i.id, i.status]), [["old", "overdue"], ["soon", "pending"]]);

    await t.advance(3000);
    assert.deepStrictEqual(plain(t.sent).map((s) => s.text), ["later"], "the future item was re-armed");
});

test("an overdue item can be sent now, or cancelled", async () => {
    const t = setup({ initial: [{ id: "old", jid: "1@c.us", text: "overdue", dueAt: 500 }, { id: "old2", jid: "1@c.us", text: "cancelled", dueAt: 600 }] });
    await t.scheduler.restore();
    await t.scheduler.sendNow("old");
    assert.deepStrictEqual(plain(t.sent).map((s) => s.text), ["overdue"]);
    await t.scheduler.cancel("old2");
    assert.strictEqual(t.scheduler.list().length, 0);
    assert.strictEqual(t.state.items.length, 0);
});

test("a failing send keeps the item with status error", async () => {
    const t = setup({ send: async () => { throw new Error("jaringan"); } });
    const id = await t.scheduler.add("1@c.us", "halo", 2000);
    await t.advance(1000);
    const item = plain(t.scheduler.list())[0];
    assert.strictEqual(item.id, id);
    assert.strictEqual(item.status, "error");
    assert.ok(item.error.includes("jaringan"));
    assert.strictEqual(t.state.items.length, 1, "still stored");
    assert.strictEqual(plain(t.state.items)[0].status, "error");
});

test("a send that answers ok:false also becomes status error", async () => {
    const t = setup({ send: async () => ({ ok: false, error: "send-function-not-found" }) });
    await t.scheduler.add("1@c.us", "halo", 2000);
    await t.advance(1000);
    const item = plain(t.scheduler.list())[0];
    assert.strictEqual(item.status, "error");
    assert.strictEqual(item.error, "send-function-not-found");
});

test("a failed item can be retried with sendNow", async () => {
    let attempts = 0;
    const t = setup({ send: async () => { attempts++; if (attempts == 1) throw new Error("x"); return { ok: true }; } });
    const id = await t.scheduler.add("1@c.us", "halo", 2000);
    await t.advance(1000);
    await t.advance(60 * 1000);
    await t.scheduler.sendNow(id);
    assert.strictEqual(attempts, 2);
    assert.strictEqual(t.scheduler.list().length, 0);
});

// ---- page-world send action ----

function loadInterception(globals) {
    const sandbox = createSandbox(globals);
    loadScripts(sandbox, ["core/interception.js"]);
    sandbox.__timers.length = 0;
    return sandbox;
}

test("sendTextToChat prefers sendTextMsgToChat", async () => {
    const calls = [];
    const s = loadInterception({});
    s.getChatByJID = async () => ({ id: "chat" });
    s.findExport = (name) => (name == "sendTextMsgToChat" || name == "addAndSendMsgToChat") ? async (chat, text) => { calls.push([name, text]); } : null;
    const result = await s.sendTextToChat("1@c.us", "halo");
    assert.deepStrictEqual({ ...result }, { ok: true });
    assert.deepStrictEqual(calls.map((c) => [...c]), [["sendTextMsgToChat", "halo"]]);
});

test("sendTextToChat falls back to addAndSendMsgToChat", async () => {
    const calls = [];
    const s = loadInterception({});
    s.getChatByJID = async () => ({ id: "chat" });
    s.findExport = (name) => name == "addAndSendMsgToChat" ? async (chat, message) => { calls.push(message.body); } : null;
    const result = await s.sendTextToChat("1@c.us", "halo");
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual([...calls], ["halo"]);
});

test("sendTextToChat reports a missing send function and a missing chat", async () => {
    const s = loadInterception({});
    s.getChatByJID = async () => ({ id: "chat" });
    s.findExport = () => null;
    assert.deepStrictEqual({ ...(await s.sendTextToChat("1@c.us", "halo")) }, { ok: false, error: "send-function-not-found" });

    s.findExport = () => async () => {};
    s.getChatByJID = async () => null;
    assert.deepStrictEqual({ ...(await s.sendTextToChat("1@c.us", "halo")) }, { ok: false, error: "chat-not-found" });
});

test("sendTextToChat reports an error thrown by WhatsApp", async () => {
    const s = loadInterception({});
    s.getChatByJID = async () => ({ id: "chat" });
    s.findExport = () => async () => { throw new Error("rejected"); };
    const result = await s.sendTextToChat("1@c.us", "halo");
    assert.strictEqual(result.ok, false);
    assert.ok(result.error.includes("rejected"));
});

test("alsoReceipt: onSent runs after a successful send, not after a failed one", async () => {
    const sandbox = loadScripts(createSandbox(), ["core/send_scheduler.js"]);
    let clock = 1000;
    const timers = new Map();
    let nextHandle = 1;
    const state = { items: [] };
    const sentTo = [];
    let ok = true;
    const scheduler = sandbox.createSendScheduler({
        now: () => clock,
        setTimer: (fn, ms) => { const h = nextHandle++; timers.set(h, { fn, at: clock + ms }); return h; },
        clearTimer: (h) => { timers.delete(h); },
        store: { get: async () => [], set: async (items) => { state.items = JSON.parse(JSON.stringify(items)); } },
        send: async () => (ok ? { ok: true } : { ok: false, error: "x" }),
        onSent: (item) => { sentTo.push(item.jid); },
        minIntervalMs: 0,
    });
    await scheduler.add("1@c.us", "a", 2000, "n", { alsoReceipt: true });
    await scheduler.add("2@c.us", "b", 2000, "n");
    assert.strictEqual(state.items[0].alsoReceipt, true);
    assert.strictEqual(state.items[1].alsoReceipt, undefined);
    clock = 3000;
    for (const [h, timer] of [...timers]) { timers.delete(h); await timer.fn(); }
    assert.deepStrictEqual([...sentTo], ["1@c.us"]);
    ok = false;
    await scheduler.add("3@c.us", "c", 4000, "n", { alsoReceipt: true });
    clock = 5000;
    for (const [h, timer] of [...timers]) { timers.delete(h); await timer.fn(); }
    assert.deepStrictEqual([...sentTo], ["1@c.us"]);
});

test("resolveSendLaterPreset: 10 minutes, 1 hour, tomorrow 08:00", () => {
    const sandbox = loadScripts(createSandbox(), ["core/send_scheduler.js"]);
    const now = new Date(2026, 10, 20, 15, 30, 0).getTime();
    assert.strictEqual(sandbox.resolveSendLaterPreset("10m", now), now + 10 * MINUTE);
    assert.strictEqual(sandbox.resolveSendLaterPreset("1h", now), now + 60 * MINUTE);
    const d = new Date(sandbox.resolveSendLaterPreset("tomorrow", now));
    assert.deepStrictEqual([d.getFullYear(), d.getMonth(), d.getDate(), d.getHours(), d.getMinutes()], [2026, 10, 21, 8, 0]);
    assert.strictEqual(sandbox.resolveSendLaterPreset("custom", now), null);
});
