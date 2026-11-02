// Scheduled message outbox queue.
// Pure, dependency-free logic used by the background service worker and unit tests.

function createScheduledQueue(initial) {
    const queue = Array.isArray(initial) ? initial.map((q) => ({ ...q })) : [];

    function nowMs() {
        return Date.now();
    }

    function add(item) {
        if (!item || !item.chat_jid || !item.message_text) {
            throw new Error("chat_jid and message_text are required");
        }
        const ts = Number(item.scheduled_timestamp);
        if (!Number.isFinite(ts) || ts <= 0) {
            throw new Error("scheduled_timestamp must be a positive number");
        }
        const entry = {
            id: item.id || `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            chat_jid: String(item.chat_jid),
            message_text: String(item.message_text),
            scheduled_timestamp: ts,
            status: "pending",
            created_at: item.created_at || nowMs(),
        };
        queue.push(entry);
        return entry;
    }

    function list() {
        return queue.map((q) => ({ ...q }));
    }

    function cancel(id) {
        const idx = queue.findIndex((q) => q.id === id);
        if (idx === -1) return false;
        queue.splice(idx, 1);
        return true;
    }

    function due(now) {
        const t = Number.isFinite(now) ? now : nowMs();
        return queue.filter((q) => q.status === "pending" && q.scheduled_timestamp <= t);
    }

    function markSent(id) {
        const q = queue.find((q) => q.id === id);
        if (!q) return false;
        q.status = "sent";
        q.sent_at = nowMs();
        return true;
    }

    function markFailed(id, reason) {
        const q = queue.find((q) => q.id === id);
        if (!q) return false;
        q.status = "failed";
        q.error = reason || "unknown";
        return true;
    }

    function pending() {
        return queue.filter((q) => q.status === "pending");
    }

    return { add, list, cancel, due, markSent, markFailed, pending };
}

module.exports = { createScheduledQueue };