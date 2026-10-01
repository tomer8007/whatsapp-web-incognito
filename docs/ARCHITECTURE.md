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

This also settles the Chromium-level sandbox. A port from another Electron app brought
`ELECTRON_DISABLE_SANDBOX=1` along with it, and this app now does the equivalent itself:
`app/electron/main.js` appends `--no-sandbox` on Linux, **unconditionally**. The
justification changed. The port's reasoning was that this app runs
`webPreferences.sandbox: true` and has to load its hook bundle from disk, which is only half
true — the renderer `sandbox: false` above is the part that actually forced it. What decided
it is the environment. Chromium requires `chrome-sandbox` to be root-owned with mode `4755`,
an `npm`/`pnpm` install never produces that, and where the unprivileged-namespace fallback is
*also* unavailable — a container, a restricted VM, a seccomp/AppArmor profile blocking
`unshare(CLONE_NEWUSER)` — Chromium aborts with

```
[FATAL:sandbox/linux/suid/client/setuid_sandbox_host.cc] The SUID sandbox helper binary
was found, but is not configured correctly. Rather than run without sandboxing I'm aborting now.
```

before a window exists. There is no settings screen to reach and no diagnostic to read. The
only real alternative is a `sudo chown`/`chmod` of a file inside `node_modules`, which an app
cannot ask of its user at every launch and which a reinstall undoes.

**What that costs:** the zygote boundary is off process-wide on Linux, so utility processes
are not contained. The two narrower boundaries are untouched — the per-renderer
`sandbox: false`, which covers the one renderer that loads our bundles, and the navigation
lock, which confines the app to `web.whatsapp.com`. Windows and macOS are unaffected: the
switch is Linux-only. `scripts/doctor.cjs` passes `--no-sandbox` on its own command line,
which is a deliberate, local choice for a standalone diagnostic run and not app state.

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

## 4. Settings

### 4.1 One list, two surfaces

`app/electron/settings-menu.js` holds every setting as a descriptor: a key, a label, a group
and — for the one integer — the values worth offering. It holds **no defaults**, because
defaults are parsed out of `background.js` at build time (§1) and a `default:` field here
would be a second source of truth nothing keeps in sync.

The desktop app renders that table as a native `Menu` — from the tray, from `Ctrl`/`Cmd` + `,`
(`before-input-event`, because Windows and Linux deliberately have no menu bar), and from the
macOS Settings menu. `safetyDelay` is a radio submenu rather than a number field: the page only
ever accepted whole seconds 1–30, and radio choices cannot be mis-entered. Its validation
bound is derived from the same `choices` array, so the values offered and the values accepted
cannot drift.

The extension still uses the panel injected into WhatsApp's own menu bar, because a browser
extension has no native menu to offer. That panel has no tests, so `A-panelkeys` guards the one
thing that breaks silently there: a key `background.js` does not know is ignored, and the
checkbox appears to work while nothing is saved.

### 4.2 A pref must take effect, not just persist

The globals that decide whether a receipt is blocked — `readConfirmationsHookEnabled`,
`saveDeletedMsgsHookEnabled`, `showDeviceTypesEnabled`, `autoReceiptOnReplay`,
`allowStatusDownload` — are read by `core/node_handler.js` on every decoded stanza, and the
only thing that ever mutates them is `core/injected_ui.js`'s `onOptionsUpdate` listener.

So `shim.js`'s `applyPrefs` **dispatches that event** when a change arrives from the host. It
did not: a tray toggle updated the shim's own `PREFS` and stopped, which left the checkbox
saved, the tray agreeing with itself, and the page enforcing the old value until the next
document load. The `fromPage` flag suppresses the dispatch for the page's own round-trip, since
`core/ui.js`'s tick handlers already dispatch right after calling `setOptions`.

`A-liveprefs` evaluates the real emitted shim and watches the event, because a grep for the
event name cannot tell a dispatch that happens from one that is merely mentioned.

### 4.3 The fallback, and why there is one

The native menu is better in every way that matters — it cannot break when WhatsApp renames a
class, and it needs no injected HTML. But "you cannot change your settings" is worse than the
old panel, so if building or showing the menu throws, `openSettings` asks the page to open the
panel it injects (`__WAI__.openOptions` → `onOpenIncognitoOptions` → `Drop.open()`), and if
that is unavailable too, it says so in a dialog instead of failing silently.

The panel reports honestly rather than optimistically: it is anchored to an element inside
WhatsApp's menu bar, so when the anchor is missing the answer is `false` — unavailable, not
closed.

---

## 5. Background operation

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

## 6. Commands

| | |
|---|---|
| `pnpm one` | kill stale → env → build → 27 assertions → 112 tests → **real app** → verdict |
| `pnpm check` | same without the real-window check — this is what CI runs |
| `pnpm kill` | stop stale instances (`--dry`, `--all` also stops watchers) |
| `pnpm doctor` | bare-window probe: is WhatsApp reachable, and which engine is installed |
| `pnpm dev` | the whole loop: build → verify → watch → launch the app pointed at the dev server |
| `pnpm start` | bring the app back after quitting it; the watcher keeps running |
| `pnpm build:ext` | stage the Chrome and Firefox extensions |

Everything else is either a single-target shortcut (`build:chrome`, `build:firefox`,
`build:electron`, `package:chrome`, `package:firefox`) or a raw flag away: `dev.mjs --once`
for a single build-and-verify pass with no watcher, and `build.mjs --clean`. Those two are
deliberately not npm scripts — an entry nobody references is an entry nobody finds, and both
files document the flag in their own header.

Local desktop packaging is `pnpm exec electron-builder`, which is what the release workflow
runs. It was never an npm script, because a second packaging path that nothing exercises is
one that quietly rots.

Dev reload has two genuinely different scopes, and the distinction is tested: edits under
`core/` or `lib/` re-inject the live page (~170 ms, window/socket/login survive); edits to
`app/electron/*.js` relaunch, because a preload cannot be swapped into a live renderer and
pretending otherwise leaves a torn context.

`pnpm dev` used to be two terminals — the watcher in one, `pnpm start` in the other. The
split itself is deliberate and still holds: the dev server knows nothing about the app, the
app polls it, so files can be edited with or without a window open. What changed is that
`dev` now spawns the app itself, so the common case is one command. `--no-launch` is a flag,
not a script, for the watch-only case.

---

## 7. Known limitations

- **Tray requires a GNOME AppIndicator extension.** GNOME 42+ removed the legacy status
  area, so a correct `Tray` has nowhere to render without it. Measured on this machine:
  `Tray.setMenu` no longer exists in Electron 44 (use `setContextMenu`), and
  `nativeImage.createFromPath` returns an **empty** image for every SVG in `images/` while
  all four PNGs load. Without a tray, closing the window quits rather than hides, since
  there would be no way to restore it. The settings menu survives this: `Ctrl`/`Cmd` + `,`
  does not go through the tray, and it falls back to the in-page panel (§4.3).
- **On Linux the zygote sandbox is off** (`--no-sandbox`, passed by `main.js`; see §2 for why
  and what it costs). There is no runtime toggle and no alternative path: the only other fix
  was a `sudo chown`/`chmod` inside `node_modules`, so it was dropped rather than offered.
  Linux is also where this app is developed, which is how the failure was found at all.
- **The extension's settings panel is untested and breakable.** It is HTML injected into
  WhatsApp's DOM, so a WhatsApp release that renames the menu item's class makes it vanish —
  which is the "temporarily broken" dialog in `core/ui.js`. The desktop app no longer depends
  on it; the extension still does, and `A-panelkeys` only guards the option keys, not the
  anchor. A `chrome.options_page` would remove the dependency and is the obvious next step.
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
  browser chrome — not bytes. Settings follow the same rule: a native `Menu`, not a second
  window and not a bundled settings page, so the feature costs no new dependency and no new
  window.
