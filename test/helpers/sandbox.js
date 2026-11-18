const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const ROOT = path.resolve(__dirname, "..", "..");

const silentConsole = { log() {}, info() {}, warn() {}, error() {}, dirxml() {} };

// A fake browser global scope. Timers are queued, never run on their own: call drainTimers().
function createSandbox(globals = {}) {
    const timers = [];
    const sandbox = {
        console: silentConsole,
        setTimeout(fn, ms) { timers.push({ fn, ms }); return timers.length; },
        clearTimeout() {},
        btoa: (s) => Buffer.from(s, "binary").toString("base64"),
        indexedDB: { open: () => ({}) },
        document: { dispatchEvent() {}, addEventListener() {}, querySelector: () => null },
        CustomEvent: class CustomEvent {
            constructor(type, init) { this.type = type; this.detail = init ? init.detail : undefined; }
        },
        wsHook: {},
        require: () => ({}),
        ...globals,
    };
    sandbox.window = sandbox;
    sandbox.self = sandbox;
    vm.createContext(sandbox);
    sandbox.__timers = timers;
    return sandbox;
}

// Runs extension scripts in the sandbox, in order, like <script> tags.
function loadScripts(sandbox, relativePaths) {
    // Page-world files that open IndexedDB rely on core/idb_open.js, which core_injection.js loads before them.
    const needsOpener = relativePaths.some((p) => p === "core/interception.js" || p === "core/vault.js");
    if (needsOpener && !relativePaths.includes("core/idb_open.js")) relativePaths = ["core/idb_open.js", ...relativePaths];
    for (const relativePath of relativePaths) {
        const code = fs.readFileSync(path.join(ROOT, relativePath), "utf8");
        vm.runInContext(code, sandbox, { filename: relativePath });
    }
    return sandbox;
}

// Runs queued timers (including ones they queue) until none remain or `limit` is hit.
async function drainTimers(sandbox, limit = 1000) {
    let ran = 0;
    while (sandbox.__timers.length > 0 && ran < limit) {
        const timer = sandbox.__timers.shift();
        await timer.fn();
        ran++;
    }
    return ran;
}

// Builds an ArrayBuffer inside the sandbox realm, so `instanceof ArrayBuffer` holds there.
function sandboxArrayBuffer(sandbox, bytes) {
    return vm.runInContext(`new Uint8Array(${JSON.stringify(bytes)}).buffer`, sandbox);
}

module.exports = { ROOT, createSandbox, loadScripts, drainTimers, sandboxArrayBuffer };
