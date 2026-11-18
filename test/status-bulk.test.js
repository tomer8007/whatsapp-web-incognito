const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load() {
    return loadScripts(createSandbox(), ["core/status_bulk.js"]);
}

// 2026-03-07 09:05:02 local time, in seconds like WhatsApp's message.t
const TS = Math.floor(new Date(2026, 2, 7, 9, 5, 2).getTime() / 1000);

test("statusFileName builds status_<name>_<YYYYMMDD-HHMMSS>_<n>.<ext> with padded dates", () => {
    const { statusFileName } = load();
    assert.strictEqual(statusFileName("Budi", TS, 1, "image/jpeg"), "status_Budi_20260307-090502_1.jpg");
    assert.strictEqual(statusFileName("Budi", TS * 1000, 12, "video/mp4"), "status_Budi_20260307-090502_12.mp4", "milliseconds work too");
});

test("statusFileName replaces unsafe characters with _", () => {
    const { statusFileName } = load();
    assert.strictEqual(statusFileName("Ani/Bu: \"Kantor\"?", TS, 1, "image/webp"), "status_Ani_Bu_Kantor_20260307-090502_1.webp");
    assert.ok(!/[\/\\:*?"<>|\s]/.test(statusFileName("a b\\c", TS, 1, "image/png")));
    assert.ok(statusFileName("", TS, 1, "image/png").startsWith("status_kontak_"));
    assert.ok(statusFileName("Siti Nur", TS, 1, "image/png").startsWith("status_Siti_Nur_"));
});

test("statusFileName maps mimetypes to extensions", () => {
    const { statusFileName } = load();
    const ext = (mime) => statusFileName("x", TS, 1, mime).split(".").pop();
    assert.strictEqual(ext("image/jpeg"), "jpg");
    assert.strictEqual(ext("video/mp4"), "mp4");
    assert.strictEqual(ext("image/webp"), "webp");
    assert.strictEqual(ext("audio/ogg; codecs=opus"), "ogg");
    assert.strictEqual(ext(undefined), "bin");
});

test("collectStatusMediaMessages skips text statuses", () => {
    const { collectStatusMediaMessages } = load();
    const media = collectStatusMediaMessages([
        { id: { id: "1" }, type: "chat", body: "teks" },
        { id: { id: "2" }, isMedia: true, mediaKey: "k" },
        { id: { id: "3" }, mediaKey: "k2" },
    ]);
    assert.deepStrictEqual([...media.map((m) => m.id.id)], ["2", "3"]);
});

test("runStatusBulk downloads every media status one by one and reports done", async () => {
    const { runStatusBulk } = load();
    const items = [];
    let done = null;
    await runStatusBulk({
        messages: [
            { id: { id: "a" }, t: TS, mimetype: "image/jpeg", directPath: "/a" },
            { id: { id: "b" }, t: TS + 60, mimetype: "video/mp4", directPath: "/b" },
        ],
        contactName: "Budi",
        download: async (m) => m.directPath,
        toBase64: (data) => "b64:" + data,
        emitItem: (item) => items.push(item),
        emitDone: (result) => { done = result; },
    });
    assert.deepStrictEqual(items.map((i) => ({ ...i })), [
        { index: 1, total: 2, name: "status_Budi_20260307-090502_1.jpg", mimetype: "image/jpeg", b64: "b64:/a" },
        { index: 2, total: 2, name: "status_Budi_20260307-090602_2.mp4", mimetype: "video/mp4", b64: "b64:/b" },
    ]);
    assert.deepStrictEqual({ ...done }, { total: 2, failed: 0 });
});

test("runStatusBulk keeps going when one download fails", async () => {
    const { runStatusBulk } = load();
    const items = [];
    let done = null;
    await runStatusBulk({
        messages: [{ id: { id: "a" }, t: TS, mimetype: "image/jpeg" }, { id: { id: "b" }, t: TS, mimetype: "image/jpeg" }],
        contactName: "x",
        download: async (m) => { if (m.id.id == "a") throw new Error("expired"); return "ok"; },
        toBase64: (d) => d,
        emitItem: (item) => items.push(item),
        emitDone: (result) => { done = result; },
    });
    assert.strictEqual(items.length, 1);
    assert.strictEqual(items[0].index, 2);
    assert.deepStrictEqual({ ...done }, { total: 2, failed: 1 });
});

test("runStatusBulk with no media reports total 0", async () => {
    const { runStatusBulk } = load();
    let done = null;
    await runStatusBulk({ messages: [], contactName: "x", download: async () => "", toBase64: (d) => d, emitItem() {}, emitDone: (r) => { done = r; } });
    assert.deepStrictEqual({ ...done }, { total: 0, failed: 0 });
});
