const test = require("node:test");
const assert = require("node:assert/strict");
const { createScheduledQueue } = require("./scheduled_queue");

test("add schedules a pending message", () => {
    const q = createScheduledQueue();
    const e = q.add({ chat_jid: "123@c.us", message_text: "hi", scheduled_timestamp: Date.now() + 1000 });
    assert.equal(e.status, "pending");
    assert.equal(q.list().length, 1);
});

test("add requires chat_jid and message_text", () => {
    const q = createScheduledQueue();
    assert.throws(() => q.add({ message_text: "hi", scheduled_timestamp: 1 }), /chat_jid/);
    assert.throws(() => q.add({ chat_jid: "x", scheduled_timestamp: 1 }), /message_text/);
});

test("add requires positive scheduled_timestamp", () => {
    const q = createScheduledQueue();
    assert.throws(() => q.add({ chat_jid: "x", message_text: "hi", scheduled_timestamp: 0 }), /scheduled_timestamp/);
    assert.throws(() => q.add({ chat_jid: "x", message_text: "hi", scheduled_timestamp: -5 }), /scheduled_timestamp/);
});

test("due returns only pending messages at or before now", () => {
    const now = 1000;
    const q = createScheduledQueue();
    q.add({ chat_jid: "a", message_text: "m1", scheduled_timestamp: 500 });
    q.add({ chat_jid: "b", message_text: "m2", scheduled_timestamp: 1500 });
    const d = q.due(now);
    assert.equal(d.length, 1);
    assert.equal(d[0].message_text, "m1");
});

test("markSent changes status and tracks sent_at", () => {
    const q = createScheduledQueue();
    const e = q.add({ chat_jid: "a", message_text: "m", scheduled_timestamp: 10 });
    assert.ok(q.markSent(e.id));
    const sent = q.list().find((x) => x.id === e.id);
    assert.equal(sent.status, "sent");
    assert.ok(typeof sent.sent_at === "number");
});

test("cancel removes entry", () => {
    const q = createScheduledQueue();
    const e = q.add({ chat_jid: "a", message_text: "m", scheduled_timestamp: 10 });
    assert.ok(q.cancel(e.id));
    assert.equal(q.list().length, 0);
    assert.ok(!q.cancel(e.id));
});

test("pending excludes sent", () => {
    const q = createScheduledQueue();
    const e = q.add({ chat_jid: "a", message_text: "m", scheduled_timestamp: 10 });
    q.markSent(e.id);
    assert.equal(q.pending().length, 0);
});