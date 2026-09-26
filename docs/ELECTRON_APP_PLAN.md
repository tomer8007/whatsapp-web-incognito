# Plan: WAIncognito Electron "light" app + Chrome/Firefox extension

**Status:** verified against the working tree on 2026-09-26. Every claim in §2–§4 was
checked by reading the code or by running it, not assumed. Numbers I could not measure
here are marked **UNVERIFIED** and carry a benchmark step.

**Decisions taken:**

- The wry / Tauri / Wails attempts are abandoned — native webviews were tried and
  rejected over webview issues. Fresh Electron shell, no code carried over.
- **We are allowed to edit `core/` and `lib/`.** This changes the design substantially:
  the performance and robustness fixes become ordinary source patches instead of
  fragile build-time transforms on emitted bundles, and the single worst landmine
  (§2.3) can be removed at its root rather than worked around forever.
- Upstream compatibility is therefore redefined as **"a small, recorded, rebaseable
  patch set"** rather than "zero diff". See §1.

---

## 1. Upstream compatibility, redefined

The project exists to carry upstream's WhatsApp-Web-compat fixes, so `git merge
upstream/master` must stay cheap. But the tree is **not** a pristine mirror today
(§2.7), and the README tells users to clone and "load unpacked" — so the working tree
*is* the shipped extension. Reverting local fixes to achieve a zero diff would
actively break extension users.

So the invariant is:

> `core/` and `lib/` carry **only** the changes listed in `patches/`, the patch set is
> recorded in the repo, and the build fails if the real diff ever exceeds it.

Mechanism:

1. `patches/manifest.json` lists every local change with a one-line rationale and the
   upstream file/line it touches.
2. `scripts/verify-bundles.mjs` computes `git diff <upstream-ref> -- core lib` and
   asserts the changed file set and hunk count match the recorded manifest. Accidental
   edits fail the build; deliberate ones require a manifest update.
3. On each `git merge upstream/master`, the merge is expected to conflict **only** in
   the §2.7 files. That is the signal to rebase the patch set — a feature, not a bug.
4. Every patch is an upstream-PR candidate. Two are already real bug fixes (§2.7);
   shipping them upstream is what stops this list from growing forever.

**Why not patch files applied at build time?** That was considered and rejected: the
README's load-unpacked-from-source path would silently ship an *unpatched* extension,
so extension users and app users would run different code. Keeping the fixes in the
tree and *recording* them keeps one code path and still makes drift visible.

---

## 2. Verified facts about the codebase

These drive every design decision below.

### 2.1 The extension API surface is two functions

Exhaustive grep of `core/` and `lib/`:

| API | Sites | Used for |
|---|---|---|
| `browser.runtime.sendMessage` | 15 | `{name:"getOptions"}` / `{name:"setOptions"}` only |
| `chrome.runtime.getURL` | 4 | `download.svg`, `incognito_gray_24_hollow_9.svg`, `computer.svg`, `phone.svg` |

Nothing else. No `chrome.storage` outside `background.js`, no `chrome.tabs`, no
`chrome.scripting`. `indexedDB`, `localStorage`, `fetch`, and the DOM are native in a
webview and need nothing.

**Consequence:** `core/` and `ui.js` need **no** API shims beyond those two functions.
The port is transport plumbing underneath them. This is why the project is feasible.

Note `ui.js:12` does `if (chrome != undefined) { var browser = chrome; }` — the app
must define `window.chrome` **before** `ui.js` evaluates, or `ui.js` throws on
`browser.runtime`.

### 2.2 The extension runs two JS worlds; Electron gives one

| | page world (`document_start`) | isolated world (`document_idle`) |
|---|---|---|
| files | `ws_hook`, `pbf`, `libsignal`, `pako`, `parsing/*`, `utils`, `ui_class_names`, `injected_ui`, `multi_device`, `node_handler`, `interception`, `moduleraid` | `ui_class_names`, `ui.js`, `drop`, `sweetalert`, `status_download` |
| bridge | DOM `CustomEvent` on the shared `document` | |

Electron has one world, so the bridge collapses to direct calls. One consequence worth
stating: **`core/ui_class_names.js` is loaded in both worlds upstream, so upstream has
two independent copies of `var UIClassNames`.** In the app there is exactly one, from
the main bundle. `ui.js` reads `UIClassNames` 29 times, `injected_ui.js` writes it 14
times — the single shared copy is what lets the menu find elements the other file
created. **This is the real reason the main bundle must be injected first.**

### 2.3 One name collision — and it is now removable (was the worst landmine)

Measured by extracting every column-0 `var|let|const|function|class` declaration:

- main group: 228 top-level names
- ui group: 43 top-level names
- **shared: exactly one — `initialize`**

Both are function declarations invoked at top level:

- `core/interception.js:28` → `initialize();` … `function initialize()` at `:520`
- `core/ui.js:18` → `initialize();` … `function initialize()` at `:20`

Faithful harness (`vm.runInContext`, separate scripts vs. one script):

```
separate scripts, main then ui  -> ["interception.initialize", "ui.initialize"]   OK
ONE concatenated script         -> ["ui.initialize",           "ui.initialize"]   BROKEN
separate scripts, ui then main  -> ["ui.initialize", "interception.initialize"]   OK
```

Concatenating makes the **last** declaration win across the whole script, so
`interception.js:28` silently calls `ui.js`'s `initialize`, the WebSocket hook never
arms, and **nothing errors**. The app looks installed and blocks nothing.

**Removable at the root (patch P1).** Verified: `initialize` occurs in `ui.js` exactly
twice — the call at `:18` and the definition at `:20` — is never re-invoked from any
handler, and is never referenced from any other file (`drop.js:522` is
`module.initialize`, `multi_device.js` is `MultiDevice.initialize`, both namespaced).
Renaming `ui.js`'s to `initializeUI` is a **2-line** change that deletes the collision
permanently. After P1, bundle layout stops being load-bearing and "keep them separate"
becomes defence in depth rather than the only thing standing between us and a silent
no-op.

### 2.4 Intra-bundle collisions are benign

Collapsing each group into one file changes hoisting *within* a group. Measured — 4
duplicate names in the main group:

```
KeyExchangeMessage          WhisperTextProtocol.js:49  <->  WAProto.js:4204
SenderKeyMessage            WhisperTextProtocol.js:71  <->  WAProto.js:9562
SenderKeyRecordStructure    WhisperTextProtocol.js:177 <->  WAProto.js:9580
SenderKeyStateStructure     WhisperTextProtocol.js:157 <->  WAProto.js:9594
```

All four are `var X = self.X = {}` — `var`, so no redeclaration error, and last-wins is
*identical* to the extension's separate-`<script>` behaviour. The ui group has zero
duplicates. **Concatenating within a group is safe.** A2 (§7) still guards it: a
`let`/`const`/`class` duplicate *would* be a fatal `SyntaxError` killing the whole bundle.

### 2.5 Bundle sizes (measured, `stat`)

| group | bytes |
|---|---|
| main (15 files) | 1,320,896 |
| ui (4 files) | 185,872 |
| deferred (`moduleraid.js`) | 1,694 |
| css (2 files) | 9,638 |

Main-group breakdown — this drives §8:

| file | KB | % of main | needed at `document_start`? |
|---|---|---|---|
| `WAProto.js` | 583 | 44% | no — first stanza decode |
| `libsignal-protocol.min.js` | 244 | 18% | no — first decrypt |
| `pako.js` | 224 | 17% | no — first gzip frame |
| `node_reader_writer.js` | 93 | 7% | no — first stanza |
| everything else | 168 | 13% | partly |
| **`ws_hook.js`** | **2.6** | **0.2%** | **yes — the only hard deadline** |

**1,076 KB (81%) of the main bundle is first touched only when a message arrives.**
Top-level execution of the vendor libs, measured in Node (median of 7): `pako` 1.05 ms,
`pbf` 0.89 ms — so vendor *init* is cheap; the cost is shipping and parsing bytes on
the critical path.

### 2.6 Repo state

- `dist/` is **gitignored build output**, not tracked. Currently populated and correct:
  `chrome/` has `background.service_worker`, `firefox/` has `background.scripts` +
  `browser_specific_settings`, both otherwise byte-identical to root. Regenerable,
  never source.
- Root `manifest.json` **is the Firefox variant** (`background.scripts`), byte-identical
  to `dist/extension/firefox/manifest.json`. Chrome MV3 rejects `background.scripts`,
  so the Chrome manifest must be derived, never copied.
- No `package.json`. `node_modules/` and `scripts/` are empty. `app/loader`,
  `app/packaging`, `app/prefs` exist but are empty.
- `background.js` holds 9 option keys, defaults in its `getOptions` handler:
  `readConfirmationsHook: true`, `showReadWarning: true`, `showDeviceTypes: true`,
  `autoReceiptOnReplay: true`, `allowStatusDownload: true`, `onlineUpdatesHook: false`,
  `typingUpdatesHook: false`, `saveDeletedMsgs: false`, `safetyDelay: 0`.

### 2.7 The tree already carries local patches

`git merge-base upstream/master HEAD` is `30ebd4a`; HEAD is **9 local commits ahead**,
and 8 files differ from `upstream/master` today:

| File | Nature |
|---|---|
| `core/node_handler.js` | **functional** — drops up-front JID normalisation, adds `receipt`/`received`/`played` blocking, moves JID derivation into the `switch` |
| `core/ui.js` | **functional** — deletes the `isOutgoingMessage = innerHTML.includes('aria-label="You:"')` override that broke device badges |
| `core/utils.js` | **functional** — drops `accountLid` matching in `isChatBlocked` |
| `core/parsing/protobuf/WAProto.js` | **encoding only** — 1,194,576 → 597,287 bytes (UTF-16 → UTF-8) |
| `core/parsing/protobuf/WhisperTextProtocol.js` | **encoding only** — 17,442 → 8,720 bytes (UTF-16 → UTF-8) |
| `manifest.json` | `browser_specific_settings`, `background.scripts` |
| `styles.css` | 2 lines |
| `.github/workflows/create-release.yml` | — |

The first three are unmerged upstream **bug fixes** and are the files most likely to
conflict on the next merge. `core/ui.js` is already in the patch set, so P2 lands in a
file that is already touched — one conflict domain, not two.

**Encoding:** `core/ui.js` and `background.js` still carry a UTF-8 BOM; the protobuf
files had theirs stripped by the `encode in utf8` commit. A BOM mid-script is legal JS
(harmless whitespace), but the build should strip BOMs anyway. All byte figures in
§2.5 are post-re-encode; pre-re-encode they were ~2× larger.

---

## 3. The permitted patch set

Every entry is small, deliberate, and an upstream-PR candidate. `patches/manifest.json`
is the record; §7's A7 enforces it.

| ID | File | Change | Why | Risk |
|---|---|---|---|---|
| **P0a** | `node_handler.js` | *(already in tree)* receipt blocking fix | upstream bug fix | low |
| **P0b** | `ui.js` | *(already in tree)* device-badge fix | upstream bug fix | low |
| **P0c** | `utils.js` | *(already in tree)* drop `accountLid` match | upstream bug fix | low |
| **P1** | `ui.js` | rename `initialize` → `initializeUI` (2 lines) | kills the §2.3 landmine at the root | very low |
| **P2** | `ui.js` | scope the body observer; short-circuit non-elements; gate the `"two"` probe behind a `uiReady` flag | §8.4 — removes the dominant steady-state cost | **medium** |
| **P3** | `interception.js` | gate the two `checkNodeEncoderSanity` calls + the `isEqualArray` compare behind `WAdebugMode` (6 lines) | §8.3 — removes a full decode+re-encode per frame | low |
| **P4** | 6 files | delete 15 live `debugger;` statements | §8.2 — app freezes on send with DevTools open | very low |
| **P5** | `interception.js` | `:66` `isIncoming = false` → `isIncoming === false` | assignment creates a stray global; landmine | very low |

**P1, P3, P4, P5 are the ones to land first** — small, mechanical, each with a
measurable or provable win. **P2 is the only one that needs a parity re-test**, because
it changes when UI work happens; it is scoped to `onMutationsObserved` and must be
re-validated against the §10 feature matrix.

On P4, the 15 sites (all *live*, `//debugger;` excluded):

```
interception.js            5   :74 :469 :600 :645 :703
multi_device.js            5   :140 :300 :338 :426 :517
utils.js                   2   :153 :372
parsing/binary_reader.js   1   :61
parsing/node_reader_writer.js 1 :2490
ui.js                      1   :759
```

The dangerous ones: `interception.js:74` and `:703` fire on **every outbound frame**
whose re-encoding is not byte-identical; `:600` (`hookedPromiseError`) is installed by
default because `WALogs = true` and fires on **every unhandled promise rejection**
anywhere in WhatsApp, which is routine; `utils.js:153` is `if (jid == undefined)
debugger;` inside `getChatByJID`, i.e. per JID parse. A `debugger` statement is free
with no debugger attached but **suspends when DevTools is open** — and Electron users
will open DevTools. Note P3 already removes the `:74`/`:703` trigger condition, so P4 is
mostly about `:600` and the rest.

---

## 4. Hard constraints

Checked against code or Electron source. All fail *silently* if violated.

### C1 — `webContents.executeJavaScript` cannot be used

Electron source, `lib/browser/api/web-contents.ts`:

```ts
const waitTillCanExecuteJavaScript = async (webContents) => {
  if (webContents.getURL() && !webContents.isLoadingMainFrame()) return
  return new Promise((resolve) => { webContents.once('did-stop-loading', resolve) })
}
WebContents.prototype.executeJavaScript = async function (code, hasUserGesture) {
  await waitTillCanExecuteJavaScript(this)
  ...
}
```

It blocks until `did-stop-loading`. `core/ws_hook.js` must replace the `WebSocket`
constructor *before* WhatsApp opens its first socket; after load is far too late.
**→ inject from `preload.js`**, which runs before the web contents begin loading — the
exact `document_start` equivalent of the manifest's `run_at: document_start`.

`webFrame.executeJavaScript(code)` has **no** such gate and evaluates "in the current
page context", i.e. the **main world**. (`executeJavaScriptInIsolatedWorld` is the
isolated one — do not use it.) So preload + `webFrame` is the only correct pair.

### C2 — keep `contextIsolation: true`

`contextIsolation: true` is the actual security boundary and is non-negotiable: the main
world is entered by one explicit `webFrame.executeJavaScript`, so page script never
reaches preload scope. `nodeIntegration: false` so the page's main world has no Node.

**`sandbox` is deliberately OFF, and this reverses an earlier draft of this plan.** The
original reasoning was that `sandbox: true` costs nothing because a sandboxed preload's
`require` still exposes `contextBridge`, `ipcRenderer`, and `webFrame` — the only modules
we needed. That reasoning was wrong: it assumed the preload would never touch the
filesystem, but the preload has to read `app/.build/*`, and a sandboxed preload **cannot**
require `fs` or read files at all.

The only sandboxed route to those bytes is `ipcRenderer.sendSync` to the main process,
which puts main on the critical path of the single file with a hard deadline: if main is
busy when the window is created, `core/ws_hook.js` lands late and interception silently
never arms (§2.3). Trading a real C1 risk for a defence-in-depth property we do not need
is a bad trade, because the preload is our own trusted code either way.

With `sandbox: false` the preload reads `critical.js` (2.7 KB) straight off disk: no IPC,
no ordering risk. If that decision is ever revisited, the constraint to re-check is
"nothing on the pre-socket path may depend on the main process being responsive".

### C3 — keep main and ui as separate scripts (defence in depth after P1)

Proven in §2.3. After **P1** the collision is gone, so this is no longer the sole
guarantee — but keep it anyway: separate scripts also preserve the *ordering*
guarantee in §2.2 (one shared `UIClassNames` created by main before `ui.js` reads it),
which a single IIFE-wrapped blob would not. Assert at build time (A1) and at runtime
(§10 step 3).

### C4 — WhatsApp's CSP forbids shell-owned schemes

A `<script src>`, `<link>`, or `fetch()` to any scheme the shell owns is refused, so:

- CSS → injected as a single inline `<style>` (`style-src` permits `'unsafe-inline'`)
- images → `data:` URIs (`img-src` permits `data:`)
- code → `webFrame.executeJavaScript` (Electron-internal, not CSP-governed)
- prefs → injected as a JS literal so `getOptions` stays **synchronous**; `ui.js:23`
  passes a callback but depends on the value being there immediately, and a round-trip
  to the main process would race it

### C5 — persist the session partition

Electron shares no profile with the user's Chrome. Without `partition: 'persist:wai'`
the user is logged out on every restart. This is the #1 "the app is broken" report.

### C6 — two manifests, derived from one

Root is the Firefox variant. Chrome needs `background: { service_worker:
"background.js" }` and must **drop** `browser_specific_settings` (gecko-only; Chrome
rejects it). Version is single-sourced from root `manifest.json` so the three outputs
can never disagree.

---

## 5. Target layout

```
/core /lib /images /styles.css /manifest.json /background.js /core_injection.js
                                   ↑ UPSTREAM + recorded patch set (§3)
/patches/manifest.json            the patch-set record (P0a…P5), with rationale
/app/electron/main.js             window lifecycle, tray, single-instance, nav lock
/app/electron/preload.js          C1 bridge + C3-ordered injection + C4 inlining
/app/electron/prefs-store.js      atomic JSON store in userData, 9 keys, validated
/app/electron/watchdog.js         §9.4 liveness signals, poll loop, tray status
/app/electron/tray.js              tray menu, hook toggles, blocked-count badge
/app/electron/smoke.js            headless self-test (§10)
/app/packaging/                   electron-builder config, icons
/scripts/build.mjs                one build → 3 outputs
/scripts/verify-bundles.mjs       A1–A10 assertions
/docs/                            this file
```

`app/loader` is removed (wry lineage). `app/packaging` and `app/prefs` are reused; prefs
logic lives in `app/electron/prefs-store.js` so it ships with the shell.

---

## 6. Build pipeline

### 6.1 `scripts/build.mjs`

Derive the file list from `manifest.json` rather than hardcoding it. Walk
`content_scripts[].js`, `content_scripts[].css`, `web_accessible_resources` (expanding
`lib/*`, `core/*`, `images/*`), `icons`, `action.default_icon`, and `background`. Then
assert every bundle file in §6.2 exists — so an upstream manifest change cannot silently
drop part of the injection chain.

Targets:

- `--target=firefox` → `dist/extension/firefox`, `manifest.json` verbatim from root.
- `--target=chrome` → same files, `background` → `service_worker`,
  `browser_specific_settings` deleted.
- `--target=electron` → `app/.build/{main,ui,deferred}.js` + `assets.json`.

Injection order, mirroring `core_injection.js` exactly:

```
main:     ws_hook → pbf → libsignal → pako → binary_reader → binary_writer
          → node_reader_writer → WhisperTextProtocol → WAProto → utils
          → ui_class_names → injected_ui → multi_device → node_handler
          → interception
deferred: moduleraid                      (needs WhatsApp's webpack registry)
ui:       ui_class_names → ui.js → drop → sweetalert → status_download
```

`deferred` mirrors upstream's `setTimeout(…, 10)` at `core_injection.js:19` and
self-polls for the webpack registry. `ui_class_names` is repeated in `ui` on purpose —
idempotent (`var UIClassNames = {}` + an IIFE that repopulates), and it keeps the ui
group mirroring the manifest's second content script.

### 6.2 Three files, never fewer

`main.js`, `ui.js`, `deferred.js` are emitted as **three separate files** and injected
as **three separate `webFrame.executeJavaScript` calls**. §7's A1 fails the build if
`main` and `ui` are ever emitted as one file. After P1 this is belt-and-braces, not the
only safeguard.

### 6.3 `preload.js` phase machine

| point | preload does | main process does |
|---|---|---|
| preload start | `contextBridge` → `window.__WAI_IPC__`; inline prefs literal + `data:` assets | — |
| immediately | `webFrame.executeJavaScript(MAIN)` | — |
| immediately | `webFrame.executeJavaScript(DEFERRED)` | — |
| on `DOMContentLoaded` signal from page | `webFrame.executeJavaScript(UI)` | — |
| prefs change | `ipcRenderer.send('wai:prefs')` | atomic write, broadcast to window |

Prefs reach preload as `additionalArguments: ['--wai-prefs=' + JSON.stringify(prefs)]`
in `webPreferences`, read from `process.argv`, and substituted into the shim source
before eval. This keeps `getOptions` synchronous (C4).

The shim defines `window.chrome`, `chrome.runtime.getURL` (→ `data:` URIs),
`chrome.runtime.sendMessage`, and aliases `window.browser = window.chrome` (§2.1). It
also installs the §10 failure banner, so a dead hook can never look like a working one.

---

## 7. Build-time assertions

Each turns a silent failure into a build failure.

| # | Assertion | Why |
|---|---|---|
| A1 | `main` and `ui` emitted as separate files | §2.3 / C3 |
| A2 | No duplicate top-level `let`/`const`/`class` within any bundle | §2.4 — a lexical dup is a fatal `SyntaxError` killing the whole bundle |
| A3 | Every file in the §6.1 order exists | upstream manifest change cannot silently drop the chain |
| A4 | Chrome manifest has `service_worker`, no `browser_specific_settings`; Firefox manifest byte-identical to root | C6 |
| A5 | All three outputs report the same `version`, read from root `manifest.json` | C6 |
| A6 | The 5 `getURL` images exist and inline to `data:` URIs | a missing one is a silently broken icon |
| A7 | `git diff <upstream-ref> -- core lib` matches `patches/manifest.json` (file set + hunk count) | §1 — catches accidental edits; the recorded patch set is the budget |
| A8 | Zero `debugger` statements in the shipped bundles | P4 |
| A9 | `checkNodeEncoderSanity` calls are `WAdebugMode`-gated | P3 — catches a regression restoring per-frame re-encoding |
| A10 | No UTF-8 BOM at any bundle seam or file start | §2.7 |
| A11 | Exactly one top-level `initialize` across main+ui, or zero after P1 | P1 landed |

---

## 8. Performance plan

Baseline: the extension running in a normal browser tab. Three classes — pure waste,
things the app can do better than a `<script src>` chain, and things only a shell can
block.

### 8.1 81% of the critical-path bundle is not needed at `document_start`

From §2.5. Upstream injects 1,291 KB at `document_start`, but only `ws_hook.js`
(2.6 KB) has a hard deadline. `WAProto` (583 KB), `libsignal` (244 KB) and `pako`
(224 KB) are first touched when a message is decrypted or a stanza decoded — tens of
seconds later, at the earliest.

**Change:** at `document_start` inject `ws_hook.js` plus a small loader that pulls
`MAIN_REMAINDER` and `ui` on first use, with three safe triggers:

1. first WebSocket `open` (a socket exists ⇒ frames are imminent), or
2. `DOMContentLoaded` (nothing to lose if no message ever arrives), or
3. WhatsApp's own first WebSocket send.

Everything after `ws_hook` already lives inside `wsHook.before`/`after`, so the loader
runs at most once per frame behind one boolean check.

Valid for the **extension targets too**, and the single largest win available. It
changes *when* upstream code loads, never *what* it does, so A7 still holds. Ship behind
a flag for one release before defaulting on.

**Expected:** `document_start` payload 1,291 KB → ~5 KB; cold-start JS parse work down
~81%. Exact Chromium figures are **UNVERIFIED** — §10 measures them.

### 8.2 Fifteen `debugger;` statements, one of them per frame

See §3 P4 for the full inventory and the three dangerous sites. Because we may now edit
source, this is a **6-file source patch**, not the build-time regex transform an
earlier draft proposed — no tokenizer needed, no risk to a `debugger` identifier inside a
string. A8 keeps it from coming back.

P3 removes the `:74`/`:703` trigger first, so P4's marginal value is `:600`
(per-unhandled-rejection, installed by default via `WALogs = true`) plus the rest.

### 8.3 A debug-only re-encode runs on every frame

`core/interception.js:66` and `:142`, both **unconditional**, inside the per-frame loop:

```js
await checkNodeEncoderSanity(decryptedFrameOriginal, isIncoming = false);   // :66
```

`checkNodeEncoderSanity` (`:686`) does a full `decodeStanza` **plus** a full
`encodeStanza` **plus** a byte-wise `isEqualArray` — on every inbound *and* outbound
frame — purely as a determinism self-check. Then `:71` computes `isEqualArray` a
*second* time to decide whether to hit `debugger`. So every message is decoded twice and
encoded once, and the result is discarded unless `WAdebugMode` is set.

**Change:** patch **P3** — gate both sanity calls and the byte comparison behind
`WAdebugMode`. This is dev-only work removed from the hot path, the biggest
*steady-state* win available, and it applies to the extension targets too. `WAdebugMode`
stays available for anyone debugging.

P5 fixes the `isIncoming = false` assignment in the same lines: `isIncoming` is never
declared in that scope, so under sloppy mode it silently creates a global.

### 8.4 The dominant steady-state cost is the DOM observer

`core/ui.js:40` observes `document.body` with `{ childList: true, subtree: true }` — the
widest possible scope — and `onMutationsObserved` (`:44`) runs, for **every added node**:

```js
if (addedNode.getElementsByClassName("two").length > 0) { ... }
```

`getElementsByClassName` walks the node's whole subtree and allocates a live collection.
Cost is O(mutations × subtree size) and scales with how chatty the conversation is.
`core/status_download.js:167` adds a second body-level observer.

**Change:** patch **P2** — now permitted, and it is the fix:

- scope the observer to the app pane root once it exists, instead of all of `body`
- short-circuit on `addedNode.nodeType !== 1` before touching `classList`
- the `"two"` probe is only needed until `onMainUIReady` fires once, so gate it behind a
  `uiReady` flag

`ui.js` is already in the patch set (P0b), so this adds no new conflict domain. **P2 is
the one change that alters when UI work happens, so it must pass the §10 parity matrix
before it ships** — treat a P2 regression as a release blocker, not a follow-up.

### 8.5 The app can beat a browser tab on network and idle cost

A normal WhatsApp Web tab registers a service worker, opens a push channel, and fires
analytics/crash-reporting beacons. None are needed. In `app/electron/main.js`:

- `session.webRequest.onBeforeRequest` — block telemetry/analytics/beacon hosts
- block service-worker and push endpoints
- `session.setPermissionRequestHandler` — deny by default; there is no legitimate
  camera/mic/geo use here

Effect: fewer requests, less main-thread work, no background-sync wakeups.
**UNVERIFIED** — §10 counts requests with and without. Keep a config flag: blocking the
service worker may affect notifications.

### 8.6 Injection mechanics the app can beat `<script src>` on

- **One `webFrame.executeJavaScript` per bundle** instead of 19 `<script>` elements: no
  per-file DOM insertion, no 19 × `getURL`, no reflow between them.
- **CSS inlined once** as a single `<style>` (9.6 KB) instead of two stylesheet requests.
- **V8 code cache** so 1.29 MB is deserialized rather than reparsed each launch. Pairs
  with §8.1 — after that change the cached `document_start` payload is ~5 KB, so measure
  before building this.
- **`backgroundThrottling: false`** so timers are not throttled in a background window.

### 8.7 What will not improve, stated honestly

- **Install size.** The Electron runtime is ~150–200 MB unpacked. Trimming 1.3 MB of app
  source is irrelevant to that. "Light" here must mean *one window, one process tree,
  tray-resident, no browser chrome* — **not bytes.** If bytes are the real goal, say so
  now (§11.1); the only alternative is a native webview, which has already been tried
  and abandoned.
- **Per-message crypto.** `decryptNoisePacket` + `encryptAndPackNodesForSending` in
  `wsHook.before` is Curve25519 + AES per frame. That *is* the feature. Identical in the
  app and the extension; no parity gap to close.
- **Parse/compile time.** Bounded by bytes; §8.1 is the fix.

---

## 9. Background and tray mode — efficient *and* useful

These two goals are in direct tension, and resolving that tension is most of the design.

### 9.1 The governing rule: split "must stay hot" from "must stay idle"

**Must stay hot — suspending it breaks the actual feature:**

- the WebSocket, `ws_hook`, and the per-frame decrypt → decode → intercept → re-encrypt path.
  That path *is* read-receipt blocking. If it stops, receipts leak. A slow app is an
  annoyance; a silently-leaking app is worse than no app at all.

Two verified facts make this workable:

- `core/` has **zero visibility awareness** — no `visibilityState`, no `document.hidden`,
  no `visibilitychange` anywhere. It cannot know it is backgrounded, so **the shell must
  own the policy**, and no upstream change can silently opt us into background work.
- `core/ws_hook.js` returns the **real** `WSObject` from its patched constructor and only
  proxies `onmessage` plus one added listener. WhatsApp's own socket lifecycle —
  open, close, keepalive, reconnect — therefore stays native and intact. We did not
  break reconnection, which is the thing that would have made background mode fragile.

**Safe to idle when hidden:** the DOM observers (P2 — the big one), painting and
compositing, analytics/service-worker traffic (§8.5), and the `moduleraid` deferred probe
until something actually needs it.

### 9.2 `backgroundThrottling: false` is required, and it costs us

Chromium throttles timers in hidden windows. WhatsApp's keepalive/ping and reconnect
backoff are timer-driven, and the Noise transport expects regular traffic. Throttling
would drop and re-churn the socket — **more** total work, plus windows where receipts
could leak. So set `backgroundThrottling: false`.

The consequence must be stated plainly: **efficiency cannot come from the hidden state.**
Hiding the window saves painting, not script execution. Every real CPU saving has to
come from §8.4 (P2) and §8.5. Anyone who promises a tray app that "sleeps" is not
describing this design.

### 9.3 Hide the window; never destroy it

- `win.hide()` — removes it from the compositor entirely. `setOpacity(0)` does not, and
  leaves it painting. Add `app.dock.hide()` on macOS, `setSkipTaskbar(true)` elsewhere.
- **Keep the `BrowserWindow` alive.** Destroying it tears down the page, the hook, and
  the socket, and forces a full reload and re-injection on next show. C5's persistent
  partition keeps the *login* across that, but the reload is still the worst outcome.
  The window is the session.

### 9.4 Liveness watchdog — the highest-value piece of this whole section

This is what makes background mode *trustworthy*, and it exists because of a specific,
verified hazard: **a dead hook is indistinguishable from a working one** (§2.3), `core/`
has no self-check, and WhatsApp Web performs hard reloads on updates and route changes —
each of which destroys the injected hook. Left alone, the app can sit in a tray for days
looking healthy while quietly leaking every read receipt.

**Signals the page must expose** (added by the shim in §6.3 — *not* a `core/` edit, so
P-set/A7 are untouched):

| signal | meaning |
|---|---|
| `injectionGeneration` | monotonic counter, bumped on every preload injection |
| `hookAlive` | `typeof wsHook.before === 'function'` **and** `WebSocket` is still the patched constructor |
| `socketState` / `socketAge` | `readyState` of the underlying socket, and how long it has been in that state |
| `framesIn` / `framesOut` / `lastFrameAt` | incremented in `wsHook.after` / `wsHook.before` |
| `prefsEcho` | hash of the prefs the page believes, vs. what main holds |

**Main-process poll** — every 15–30 s, and immediately on `did-navigate` /
`did-start-navigation`:

- `hookAlive === false`, or `window.__WAI__` missing entirely → re-arm, else reload.
  Never assume a dead hook healed itself.
- `generation` **decreased**, or is 0, or a main-frame navigation was seen and no
  injection followed within ~8 s → re-arm, else reload. This is the WhatsApp-hard-reload
  case.
- socket closed longer than a threshold → tray shows **disconnected**, and the status
  must say receipts are *not* being protected. Honest state beats a reassuring icon.
- `prefsEcho` mismatch → re-push prefs; catches a lost IPC write.

> **Correction — an earlier draft of this section was logically wrong.** It said
> "generation unchanged since the last poll → injection was lost". But `generation` is
> bumped once per `arm()`, and `arm()` runs once per *document*, so the counter is
> **constant while everything is healthy**. A literal implementation of that rule reports
> NOT_PROTECTED forever and reload-loops the app continuously. The signals that actually
> indicate a lost injection are *decrease*, *zero*, and *no injection following a
> navigation* — never "unchanged".

On any failure: tray notification + automatic recovery. **The watchdog must be driven by
the main process, never by a `setInterval` inside the page** — a page timer is exactly
the thing we cannot trust, since throttled or suspended timers are the failure mode we
are defending against.

### 9.5 What actually saves CPU while hidden — and the benchmark to prove it

Idle cost is **not** the WebSocket. When nothing happens, no frames arrive and the
per-frame crypto path is ~free. Idle cost is the DOM observer, whose price scales with
how much the page churns — and a backgrounded WhatsApp session still churns constantly
(other chats' presence, typing indicators, preview updates, and the unopened-chat list).

So the ranked list of real wins while hidden:

1. **P2** (§8.4) — the observer, dominant by a wide margin.
2. **§8.5 blocking** — no service worker, no beacons, no analytics.
3. **`win.hide()`** — no compositing or paint.
4. Nothing else. `backgroundThrottling` is off, and per-frame crypto is already ~0.

Add to §10 as a background benchmark: 10 minutes idle-and-hidden, recording renderer
CPU% and wakeup count across four configurations — baseline, +P2, +§8.5, +both. Set an
explicit target (e.g. **< 2 % average CPU idle**) and record the measured numbers in this
file. Without a number this section is just intention.

### 9.6 Usefulness while hidden — what the tray is actually for

Running in the background is only worth it if the app is doing something *for* you:

- **Honest status, not a static icon.** Tray menu shows Connected / Reconnecting /
  **NOT PROTECTED**, driven by §9.4. This is the single most useful thing in the tray,
  because it closes the §2.3 gap where failure is invisible.
- **Toggle the three hooks without opening the window** — prefs change over IPC straight
  to the page (`onlineUpdatesHook`, `typingUpdatesHook`, `readConfirmationsHook`). Cheap
  to build, genuinely useful, and it exercises the prefs round-trip from §10 step 6.
- **Surface the receipt queue that already exists.** `autoReceiptOnReplay`,
  `exceptionsList`, and `blinkingChats` in `core/interception.js` already implement
  "decide later when to send receipts" — that is the actual payoff of background
  operation, and it requires the live socket. Do **not** build a second queue; expose
  the existing one (e.g. tray tooltip: *N receipts held*).
- **Blocked-count badge** so background mode is visibly doing something, not just idling.

### 9.7 The honest cost — state it before shipping

A hidden Electron window holding a live socket and a full React app is **not free**.
Expect tens of MB of RSS and a small but non-zero CPU floor. This is the same order of
magnitude as a backgrounded WhatsApp tab in a real browser: the app is lighter by
removing browser chrome, tab management, and analytics — not by being magic.

And the hard constraint worth stating out loud: **a truly 0 %-CPU app cannot work.**
Blocking read receipts requires a live, connected, decrypting WebSocket. Anyone asking
for both "invisible" and "no running cost" is asking for two incompatible things, and
the right answer is to say so rather than to ship a leak.

---

## 10. Smoke test — the part that actually protects users

`app/electron/smoke.js`, run headless in CI and locally via `npm run smoke`. Assert, in
order:

1. `WebSocket` is patched **before** `did-finish-load` (proves C1).
2. the `__WAI_IPC__` handshake reports `booted` with the real `href`.
3. `wsHook.before` is a function **and** `initializeUI` ran — i.e. the ui group did not
   clobber interception (§2.3). Nothing else catches that class of bug.
4. `typeof Drop === 'function'` and `typeof swal === 'function'` (ui group landed).
5. a synthetic outbound `<iq type="read">` is dropped by
   `NodeHandler.interceptOutgoingNode`, and an `<iq type="presence">` likewise.
6. prefs round-trip: `setOptions` → disk → `getOptions` returns the new value.
7. `UIClassNames` is populated and the options menu renders in the DOM.
8. zero `debugger` statements in the loaded bundle (A8).
9. **for §8.1:** with lazy injection on, assert a `read` stanza is still blocked after
   the deferred load fires; and assert the loader has *not* run at `document_start`.
10. **for §8.4:** count `getElementsByClassName` calls in a scripted 500-message
    conversation, before and after P2, and assert the reduction.
11. **for §9.4 (watchdog):** force a `webContents.reload()` and assert the watchdog
    notices the lost `injectionGeneration` within one poll interval, re-arms, and
    reports *Protected* again — and that it reported *NOT PROTECTED* in between. A
    watchdog that never fires is indistinguishable from no watchdog.
12. **for §9.2:** with the window hidden, assert the socket stays open across 5 minutes
    and `framesIn` keeps advancing — i.e. `backgroundThrottling: false` is genuinely in
    effect and the session is genuinely alive.
13. **for §9.5:** the idle benchmark from §9.5, reported as a number with a pass/fail
    against the < 2 % target.

Fail loudly, in the page, with a visible banner (§6.3).

Then the **feature parity matrix**, extension vs. app side by side, pass bar = identical:
read/presence/typing block, deleted-message restore, view-once, status download, device
badge. Re-run the whole matrix after P2 and after §8.1 lands.

---

## 11. Work breakdown

| Phase | Work | Exit criterion |
|---|---|---|
| **0** | `package.json` (runtime deps **none**; dev: `electron`, `electron-builder`). Rewrite `.gitignore` for the new layout — drop Rust/Tauri entries. Create `patches/manifest.json` from the current `git diff upstream/master -- core lib` (P0a–P0c). | `npm install` clean; A7 green on day one |
| **1** | `scripts/build.mjs` (3 targets, manifest-driven) + `scripts/verify-bundles.mjs` (A1–A11) | `dist/extension/{chrome,firefox}` byte-identical to today's committed output |
| **2** | **P1, P5, P4, P3** — the four mechanical patches (§3) | A8/A9/A11 green; smoke 1–8 pass |
| **3** | `prefs-store.js` (atomic `tmp`+`rename`, 9 keys, reject unknown, clamp `safetyDelay` 0–30 to match `ui.js`) | unit tests green |
| **4** | `main.js` — `BrowserWindow` with C1/C2/C5 prefs, tray, `requestSingleInstanceLock`, navigation lock to `web.whatsapp.com`, §8.5 blocking | window opens, session survives restart |
| **5** | `preload.js` — bridge, C3-ordered injection, C4 inlining, prefs literal | smoke 1–4, 7 pass |
| **6** | `smoke.js` per §10 | smoke 1–8 pass, parity matrix green |
| **7** | **P2** — observer scoping; measure | smoke 10 shows the reduction; parity matrix green |
| **8** | §8.1 lazy injection behind a flag; measure; then default on | smoke 9; before/after recorded here |
| **9** | §8.5 request blocking; measure | request counts recorded |
| **10** | **Background mode** — `watchdog.js` + `tray.js`, `backgroundThrottling: false`, `win.hide()` on close (§9) | smoke 11, 12, 13 pass |
| **11** | Fix both CI workflows (§11.2); add build-and-upload workflow | extension zip contains no `app/`, `scripts/`, or `patches/` |
| **12** | `electron-builder` → AppImage/deb, nsis, dmg; `asar: true`; ship only the 5 `getURL` images | installs and runs on all three OSes |
| **13** | Chrome Web Store + AMO submissions | both live |
| **14** | Upstream-PR the patch set (P0a–P0c first, then P1/P3/P4/P5) | PRs open; conflict surface shrinks |

Phases 0–6 are the working app. 7–9 are performance, each gated on its own measurement.
Phase 10 is what makes the app safe to leave running. 11–13 are distribution and can run
parallel to 7–10. 14 is what keeps §1 honest over time.

**Ordering note:** Phase 10 should not be last. The watchdog is what makes a
*background* app trustworthy, and a tray-resident app without it is the worst possible
failure mode (§9.4) — it looks like protection while providing none. Ship it with the
first tray build, not after the performance work.

### 11.1 Open questions — answers needed before the phase they gate

1. **"Light" means what?** Process/UX weight (assumed) or install size? If install
   size, stop — Electron cannot deliver it and the alternative is already rejected.
   *Gates: everything.*
2. Auto-update, or manual download only?
3. Extension published under the existing `waincognito@wa-incognito.com` id, or a new
   Chrome Web Store publisher account?
4. Hide-to-tray on close, or minimise to tray?
5. Who runs the §10 side-by-side parity pass? It needs a second logged-in account and
   a human, so it cannot be automated away.

### 11.2 CI packaging breaks on any new top-level dir — fix required

Both workflows move *everything except `.github`* into a staging dir:

- `.github/workflows/create-release.yml:33` — `mv !(release|.github) release/`
- `.github/workflows/convert-to-safari.yml:26` — `mv !(extension-source|.github) extension-source/`

Adding `app/`, `scripts/`, and `patches/` therefore leaks the Electron source **and the
patch records** into the published Chrome/Firefox zip and the Safari Xcode project. Fix
with an explicit allowlist derived from the manifest, not a glob:

```bash
# only what manifest.json actually references
mv $EXT_FILES release/
```

The Safari job also depends on consuming the **repo-root** extension files — which is
the concrete payoff of never moving them.

---

## 12. Risks

| Risk | Severity | Mitigation |
|---|---|---|
| **P2 regresses the UI** (missed message, no device badge, menu fails to open) | **High** | parity matrix is a release gate; P2 is the only behavioural patch |
| Lazy injection (§8.1) misses a trigger → hook installed too late | High | smoke 1 + 5 + 9; flag first, then default |
| WhatsApp ships a layout change → menu/interception dead | **High** (upstream history is full of these) | failure banner; smoke; upstream releases keep `core/` fixed |
| Bundles collapsed into one → interception silently dead | High, silent | A1 + smoke 3; **P1 removes the root cause** |
| A lexical name dup appears in a bundle → `SyntaxError`, whole bundle dead | High, silent | A2 |
| Local `core/` patches conflict on the next `git merge upstream/master` | **High** | §1 patch-set record; Phase 13 upstreams them instead of carrying them forever |
| Electron fingerprinting → WhatsApp blocks or degrades the embedded browser | Medium | **test in week 1**, before any feature work |
| CI leaks app source into the published extension | Medium | Phase 10, before any publish |
| Blocking the service worker breaks notifications | Low–Med | §8.5 measured in Phase 9; keep a config flag |
| **Backgrounded app silently stops protecting** — WhatsApp hard-reload kills the hook and nothing notices | **High, silent** | §9.4 watchdog; smoke 11 forces a reload and asserts detection; tray must show NOT PROTECTED, never a reassuring static icon |
| `backgroundThrottling` left at the default `true` → throttled keepalive, socket churn, receipt-leak windows | **High** | §9.2 — must be `false`; smoke 12 asserts the socket survives 5 min hidden |
| Users expect a tray app to be free, and it is not (§9.7) | Medium | say so up front; ship the §9.5 number rather than a claim |
| `sandbox: true` limits preload `require` | Low | only `ipcRenderer`, `contextBridge`, `webFrame` needed — all confirmed available |
