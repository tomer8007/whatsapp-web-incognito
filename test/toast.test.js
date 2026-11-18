const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function loadToast() {
    return loadScripts(createSandbox(), ["core/options_schema.js", "core/toast.js"]);
}

test("queue keeps at most 3 toasts and drops the oldest first", () => {
    const { createToastQueue } = loadToast();
    const queue = createToastQueue();
    assert.strictEqual(queue.push({ id: 1 }), null);
    assert.strictEqual(queue.push({ id: 2 }), null);
    assert.strictEqual(queue.push({ id: 3 }), null);
    assert.strictEqual(queue.push({ id: 4 }).id, 1);
    assert.strictEqual(queue.push({ id: 5 }).id, 2);
    assert.deepStrictEqual([...queue.items().map((i) => i.id)], [3, 4, 5]);
});

test("remove(id) takes a toast out of the queue", () => {
    const { createToastQueue } = loadToast();
    const queue = createToastQueue(2);
    queue.push({ id: "a" });
    queue.push({ id: "b" });
    queue.remove("a");
    assert.deepStrictEqual([...queue.items().map((i) => i.id)], ["b"]);
    assert.strictEqual(queue.push({ id: "c" }), null, "removing freed a slot");
});

test("formatToast builds title and body, cutting the preview to 80 characters", () => {
    const { formatToast } = loadToast();
    const long = "x".repeat(200);
    const t = formatToast({ kind: "delete", chatName: "Budi", preview: long }, { hidePreview: false });
    assert.strictEqual(t.title, "🗑️ Pesan dihapus");
    assert.ok(t.body.startsWith("Budi: "));
    assert.ok(t.body.length <= "Budi: ".length + 81, "preview cut to 80 chars (+ ellipsis)");
    assert.strictEqual(formatToast({ kind: "edit", chatName: "Budi", preview: "hai" }, {}).title, "✏️ Pesan diedit");
    assert.strictEqual(formatToast({ kind: "edit", chatName: "Budi", preview: "hai" }, {}).body, "Budi: hai");
    assert.ok(formatToast({ kind: "status-delete", chatName: "Budi", preview: "" }, {}).title.includes("Status"));
});

test("hidePreview shows only the chat name", () => {
    const { formatToast } = loadToast();
    const t = formatToast({ kind: "delete", chatName: "Budi", preview: "rahasia" }, { hidePreview: true });
    assert.strictEqual(t.body, "Budi");
});

test("shouldShowToast follows toastOnDelete / toastOnEdit", () => {
    const { shouldShowToast, defaultOptions } = loadToast();
    const options = defaultOptions();
    assert.strictEqual(shouldShowToast("delete", options), false, "off by default");
    assert.strictEqual(shouldShowToast("delete", { ...options, toastOnDelete: true }), true);
    assert.strictEqual(shouldShowToast("status-delete", { ...options, toastOnDelete: true }), true);
    assert.strictEqual(shouldShowToast("edit", { ...options, toastOnDelete: true }), false);
    assert.strictEqual(shouldShowToast("edit", { ...options, toastOnEdit: true }), true);
});

test("hidePreview is on when any blur option is on", () => {
    const { isAnyBlurEnabled, defaultOptions } = loadToast();
    assert.strictEqual(isAnyBlurEnabled(defaultOptions()), false);
    assert.strictEqual(isAnyBlurEnabled({ ...defaultOptions(), blurMedia: true }), true);
});
