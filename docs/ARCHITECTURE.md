# WAIncognito desktop — architecture

Short by design. This file records only what is **not obvious from reading the code** and
cost real time to discover. Everything else lives where it belongs: rationale in the code
comments, local changes in `patches/manifest.json`, guarantees in the assertion suite.

The previous 819-line `ELECTRON_APP_PLAN.md` was deleted rather than maintained. It had
drifted — it still recommended `sandbox: true` and knew nothing about the four bugs below
— and a long document that is partly wrong is worse than no document, because people trust
it.

---

## 1. Shape of the thing

One source of truth at the repo root produces three outputs:

| Output | Path | Built by |
|---|---|---|
| Electron app | `app/.build/` → `release/` | `scripts/build.mjs --target=electron` |
| Chrome extension | `dist/extension/chrome` | `--target=chrome` |
| Firefox extension | `dist/extension/firefox` | `--target=firefox` |

The extension file list is **derived from `manifest.json`**, not hardcoded, so an upstream
release that adds or removes a file propagates to every target automatically. Root is the
Firefox manifest (it uses `background.scripts`); Chrome needs
`background.service_worker` and must drop `browser_specific_settings`.

`core/` and `lib/` use exactly **two** extension APIs — `chrome.runtime.getURL` (4 sites,
all images) and `browser.runtime.sendMessage` (15 sites, only `getOptions`/`setOptions`).
Everything else they touch is native in a webview. That is the entire reason the port is
feasible: the app supplies a transport, not a reimplementation.

Option defaults are **parsed out of `background.js`** at build time rather than restated,
so the app and the extension cannot disagree about what a default is.

---

## 2. Load-bearing constraints

### C1 — Inject from the preload, at `document_start`

`webContents.executeJavaScript` awaits `did-stop-loading` (Electron's
`waitTillCanExecuteJavaScript`). `core/ws_hook.js` must replace the `WebSocket`
constructor before WhatsApp opens its first socket, so post-load injection is far too
late.

`webFrame.executeJavaScript` from the preload has no such gate and targets the **main
world**. That pair is the only correct one. Do not use
`executeJavaScriptInIsolatedWorld` — that is the isolated world.

In the sequence, `nativeWs` and `critical` come **first**. Everything else can be late;
only `ws_hook.js` has a deadline, and every step hoisted above it is latency added to it.

### C2 — `contextIsolation: true`, and `sandbox: false` deliberately

`contextIsolation` is the real boundary and is non-negotiable. `nodeIntegration: false`.

`sandbox` is **off** on purpose, reversing an earlier recommendation. A sandboxed preload
cannot `require('fs')`, and the preload must read `app/.build/*`. The only sandboxed route
to those bytes is a synchronous `ipcRenderer.sendSync` to main — which puts the main
process on the critical path of the one file with a hard deadline. Trading a real C1 risk
for defence-in-depth on our own preload is a bad trade.

### C3 — main and ui stay separate scripts

`interception.js` and `ui.js` both declared and called a top-level `initialize`.
Concatenating the bundles makes the last declaration win for the whole script, so
`interception.js` silently called `ui.js`'s version, the hook never armed, and **nothing
errored**. Patch P1 removed the cause (renamed to `initializeUI`, 2 lines); keeping the
bundles separate is now defence in depth. Assertion `A11` guards it.

### C4 — CSP forbids shell-owned schemes

CSS is one inline `<style>`; images are `data:` URIs; code goes through
`webFrame.executeJavaScript`; prefs are a JS literal so `getOptions` stays synchronous
(`ui.js:23` reads the result immediately and an IPC round-trip would race it).

### C5 — `partition: 'persist:wai'`

Without it the user is logged out on every restart. Declared once as `PARTITION` because
two places need it — `session.fromPartition(PARTITION)` to configure the session and
`webPreferences.partition` to attach the window. Out of sync means configuring a session
the window does not use, which fails silently.

### C6 — the engine must be recent

WhatsApp Web gates on the user agent **and** on the engine. Electron 33 embeds Chromium
130 (Oct 2024); by 2026 that is refused outright, with a "please update your browser" page
and nothing in our logs. `assessEngine()` checks `process.versions.chrome` at boot and
fails loudly below major 140. The fix is always to upgrade Electron, never to raise the
number or lie in the UA.

---

## 3. Traps that cost real time

These are the four that produced a "silent" failure — the app looked installed and did
nothing, or looked broken for reasons the logs did not explain.

### 3.1 One world, not two

The extension runs its code in **two** JS worlds: a page world (`document_start`) and an
isolated content-script world (`document_idle`). Electron gives **one**.

`lib/drop.js`, `lib/pako.js`, `lib/pbf` and `lib/sweetalert.min.js` each open with a UMD
wrapper that prefers `define.amd`. In the extension they run in the isolated world, where
WhatsApp's globals do not exist, so the browser-global branch is taken. In the app they
see WhatsApp's global AMD `define` and publish **nothing**.

`core/` calls `pako.inflate(...)` as a bare global in three places. With `pako` undefined,
every compressed frame throws inside `wsHook.before`, the catch passes the frame through
**UNBLOCKED**, and the watchdog still reports `PROTECTED` because the hook did arm. Silent
receipt leak. Nothing throws at load time — the global is simply absent until the first
message.

Fixed by wrapping each UMD file so the globals are shadowed by function-scoped vars
(mutation of `window.define` would be undone by any non-writable or accessor property),
inside a non-strict IIFE so top-level `this` is still the global object. Asserted by
`A-umd`, which evaluates the real emitted chunk against a global AMD `define`.

### 3.2 A UMD bundle that registers nothing still looks healthy

The watchdog reports `PROTECTED` on hook presence. It cannot know whether a *library* it
depends on loaded. Hence `A-umd`: it checks the globals `core/` actually calls
(`pako`, `Pbf`, `Tether`, `Drop`, `swal`) against the built artifact, under exactly the
condition that broke it.

### 3.3 Ordering: a log can be right and the page still wrong

The user agent was rewritten correctly and our log printed a clean
`Chrome/152.0.7977.130 Safari/537.36` — while the page received
`...WAIncognito/2.5.6 Chrome/152... Electron/44.4.5...` and WhatsApp served its gate page.

The `BrowserWindow` was constructed **before** the session UA was applied, so the renderer
had already captured the stock UA. Setting it afterwards changed nothing that mattered.

Worse, a standalone probe **missed this entirely**, because it happened to set the UA
before creating its window. A probe that does not run the production path cannot catch an
ordering bug in the production path.

Hence `WAI_SELFTEST=1` (`pnpm one` step 6): the real app reports the UA its own window
received, the title, script count, hook state and the vendor globals. Exit 0 healthy,
1 gated, 2 blank.

### 3.4 Close-to-hide plus a single-instance lock looks like a crash

The shell hides on window-close so the WhatsApp session survives, and a second launch only
focuses the existing window. So closing the window leaves an **invisible** process running
the old Electron and old bundles; relaunching prints
`another instance is already running; this one is exiting` and looks like a crash — and
after an upgrade, looks like "the fix did nothing".

`pnpm kill` ends that ambiguity. Quit from the tray, not the X.

---

## 4. Background operation

**Hot, never suspend:** the WebSocket, `wsHook`, and the per-frame
decrypt → decode → intercept → re-encrypt path. That path *is* read-receipt blocking. A
slow app is an annoyance; a silently leaking one is worse than no app.

**Can idle when hidden:** the DOM observer (the dominant cost), painting, analytics.
`backgroundThrottling: false` is mandatory — WhatsApp's keepalive is timer-driven, so
throttling churns the socket and opens leak windows. Efficiency therefore cannot come from
the hidden state; it comes from the observer and from request filtering.

`watchdog.js` polls from the **main process**, never a page `setInterval` — a throttled page
timer is exactly what is being defended against. It reports `PROTECTED` /
`RECONNECTING` / `NOT_PROTECTED`, because a dead hook is otherwise indistinguishable from
a working one.

The lost-injection signal is generation **decrease**, zero, or "no injection after a
navigation" — *not* "unchanged". `generation` is bumped once per `arm()`, once per
document, so it is constant while healthy; testing "unchanged" would report
`NOT_PROTECTED` forever and reload-loop the app.

---

## 5. Commands

| | |
|---|---|
| `pnpm one` | kill stale → env → build → 22 assertions → 46 tests → **real app** → verdict |
| `pnpm one:ci` | same without the real-window check |
| `pnpm kill` | stop stale instances (`--dry`, `--all` also stops watchers) |
| `pnpm doctor` | bare-window probe: is WhatsApp reachable, and which engine is installed |
| `pnpm dev` | watcher (terminal 1); `pnpm start:dev` in terminal 2 |
| `pnpm check` | everything except the real-window check |
| `pnpm build:ext` | stage the Chrome and Firefox extensions |

Dev reload has two genuinely different scopes, and the distinction is tested: edits under
`core/` or `lib/` re-inject the live page (~170 ms, window/socket/login survive); edits to
`app/electron/*.js` relaunch, because a preload cannot be swapped into a live renderer and
pretending otherwise leaves a torn context.

---

## 6. Known limitations

- **Tray requires a GNOME AppIndicator extension.** GNOME 42+ removed the legacy status
  area, so a correct `Tray` has nowhere to render without it. Measured on this machine:
  `Tray.setMenu` no longer exists in Electron 44 (use `setContextMenu`), and
  `nativeImage.createFromPath` returns an **empty** image for every SVG in `images/` while
  all four PNGs load. Without a tray, closing the window quits rather than hides, since
  there would be no way to restore it.
- **The UA rewrite is a browser-gate bypass, not anonymity.** It changes one signal.
  Electron remains distinguishable by renderer strings, feature quirks and network
  fingerprint. Overridable with `WAI_USER_AGENT`.
- **CI is not yet publish-safe.** `.github/workflows/create-release.yml` and
  `convert-to-safari.yml` both do `mv !(.github)`, so `app/`, `scripts/` and `patches/`
  leak into the published extension zip and the Safari project. Needs an explicit
  allowlist from `app/.build/ext-files.json` before any release.
- **Patch P2 (MutationObserver scoping) is planned, not applied.** It is the only patch
  that changes *when* UI work happens, so it must pass the full feature parity matrix
  before shipping.
- **No automated interception test yet.** The self test proves the hook arms and the page
  loads; it does not prove a `read` stanza is actually blocked. That needs a live
  two-account run.
- **Install size is ~150–200 MB.** "Light" here means one window, one process tree and no
  browser chrome — not bytes.
