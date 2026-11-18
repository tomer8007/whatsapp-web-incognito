const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function setup(initial = []) {
    const sandbox = loadScripts(createSandbox(), ["core/receipt_scheduler.js"]);
    let clock = 1000;
    const timers = new Map();
    let nextHandle = 1;
    const sent = [];
    const state = { items: initial };
    const scheduler = sandbox.createReceiptScheduler({
        now: () => clock,
        setTimer: (fn, ms) => { const handle = nextHandle++; timers.set(handle, { fn, at: clock + ms }); return handle; },
        clearTimer: (handle) => { timers.delete(handle); },
        store: { get: async () => JSON.parse(JSON.stringify(state.items)), set: async (items) => { state.items = JSON.parse(JSON.stringify(items)); } },
        send: (jid) => { sent.push(jid); },
    });
    const advance = async (ms) => {
        clock += ms;
        for (const [handle, timer] of [...timers]) {
            if (timer.at <= clock) { timers.delete(handle); await timer.fn(); }
        }
    };
    return { sandbox, scheduler, timers, sent, state, advance, setClock: (t) => { clock = t; } };
}

test("a scheduled receipt is sent when due, and removed from the list and the store", async () => {
    const t = setup();
    await t.scheduler.schedule("1@c.us", 5000);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.scheduler.list())), [{ jid: "1@c.us", dueAt: 5000 }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.state.items)), [{ jid: "1@c.us", dueAt: 5000 }]);

    await t.advance(3999);
    assert.deepStrictEqual([...t.sent], []);
    await t.advance(1);
    assert.deepStrictEqual([...t.sent], ["1@c.us"]);
    assert.strictEqual(t.scheduler.list().length, 0);
    assert.strictEqual(t.state.items.length, 0);
});

test("cancel stops the timer and removes the item", async () => {
    const t = setup();
    await t.scheduler.schedule("1@c.us", 5000);
    await t.scheduler.cancel("1@c.us");
    assert.strictEqual(t.timers.size, 0);
    assert.strictEqual(t.scheduler.list().length, 0);
    assert.strictEqual(t.state.items.length, 0);
    await t.advance(10000);
    assert.deepStrictEqual([...t.sent], []);
});

test("scheduling the same JID twice replaces the earlier schedule", async () => {
    const t = setup();
    await t.scheduler.schedule("1@c.us", 5000);
    await t.scheduler.schedule("1@c.us", 9000);
    assert.strictEqual(t.timers.size, 1);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.scheduler.list())), [{ jid: "1@c.us", dueAt: 9000 }]);
    await t.advance(5000);
    assert.deepStrictEqual([...t.sent], [], "the old time no longer fires");
    await t.advance(4000);
    assert.deepStrictEqual([...t.sent], ["1@c.us"]);
});

test("restore sends overdue receipts immediately and re-arms future ones", async () => {
    const t = setup([{ jid: "old@c.us", dueAt: 500 }, { jid: "soon@c.us", dueAt: 4000 }]);
    await t.scheduler.restore();
    assert.deepStrictEqual([...t.sent], ["old@c.us"]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.scheduler.list())), [{ jid: "soon@c.us", dueAt: 4000 }]);
    assert.deepStrictEqual(JSON.parse(JSON.stringify(t.state.items)), [{ jid: "soon@c.us", dueAt: 4000 }]);
    await t.advance(3000);
    assert.deepStrictEqual([...t.sent], ["old@c.us", "soon@c.us"]);
});

test("a failing send does not break the scheduler", async () => {
    const sandbox = loadScripts(createSandbox(), ["core/receipt_scheduler.js"]);
    const timers = [];
    const scheduler = sandbox.createReceiptScheduler({
        now: () => 0, setTimer: (fn) => { timers.push(fn); return timers.length; }, clearTimer() {},
        store: { get: async () => [], set: async () => {} },
        send: () => { throw new Error("boom"); },
    });
    await scheduler.schedule("1@c.us", 10);
    await timers[0]();
    assert.strictEqual(scheduler.list().length, 0);
});

test("resolveScheduleChoice: relative choices and a specific time of day", () => {
    const { resolveScheduleChoice } = loadScripts(createSandbox(), ["core/receipt_scheduler.js"]);
    const now = new Date(2026, 10, 18, 10, 0, 0).getTime();
    assert.strictEqual(resolveScheduleChoice("15m", now), now + 15 * 60 * 1000);
    assert.strictEqual(resolveScheduleChoice("1h", now), now + 60 * 60 * 1000);
    assert.strictEqual(resolveScheduleChoice("3h", now), now + 3 * 60 * 60 * 1000);
    assert.strictEqual(resolveScheduleChoice("time", now, "13:30"), new Date(2026, 10, 18, 13, 30, 0).getTime());
    assert.strictEqual(resolveScheduleChoice("time", now, "09:15"), new Date(2026, 10, 19, 9, 15, 0).getTime(), "a time already past means tomorrow");
    assert.strictEqual(resolveScheduleChoice("time", now, ""), null);
    assert.strictEqual(resolveScheduleChoice("bogus", now), null);
});
