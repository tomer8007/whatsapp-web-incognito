# WAIncognito architecture

Short by design. This file records what is **not obvious from reading the code** and defines the shared invariants across all five shipped targets. Implementation rationale lives in code comments, upstream divergences live in `patches/manifest.json`, and automated guarantees live in `scripts/verify-bundles.mjs` + `app/electron/*.test.js`.

---

## 1. Shape of the thing

One canonical codebase produces five targets from shared definitions under `shared/` and `manifest.json`:

| Target | Output | Built by |
|---|---|---|
| Chrome MV3 extension | `dist/extension/chrome` | `scripts/build.mjs --target=chrome` |
| Firefox MV3 extension | `dist/extension/firefox` | `scripts/build.mjs --target=firefox` |
| Android GeckoView extension | `app/android/app/src/main/assets/waincognito` | `scripts/build.mjs --target=geckoview` |
| Safari / iOS extension | `./extension-source` → Xcode project | `.github/workflows/convert-to-safari.yml` (`build:firefox`) |
| Electron desktop app | `app/.build/` → `release/` | `scripts/build.mjs --target=electron` |

Shared UMD modules under `shared/` are the single source of truth across Electron (Node main/preload + Chromium page bundles), extensions (service worker / background + popup + content scripts), Android GeckoView, and build/verification scripts:

- `shared/settings_schema.js` (`WAISettingsSchema`): canonical groups (`privacy`, `messages`, `timing`, `app`), defaults, integer ranges/choices, SHA-256 secret-hash PIN spec, `scope` (`'shared'` vs `'shell'`), `coerceSetting`, `validatePatch`.
- `shared/settings_renderer.js` (`WAISettingsRenderer`): schema-driven DOM renderer shared verbatim by `popup.html` + `popup.js` and the in-page modal `#wai-settings-modal` in `core/ui.js`.
- `shared/bundle_manifest.js` (`WAIBundleManifest`): single canonical script ordering (`MAIN_CRITICAL`, `MAIN_REST`, `DEFERRED`, `UI`, `CSS`, `IMAGE_ASSETS`) and `DESKTOP_UA`. Consumed at runtime by `core_injection.js` and at build/test time by `scripts/bundle-defs.mjs` / `scripts/build.mjs` / `scripts/verify-bundles.mjs`.
- `shared/jid_utils.js` (`WAIJidUtils`): shared JID normalization (`@s.whatsapp.net` → `@c.us`, device suffix stripping, `@lid` / `@g.us` preservation).
- `shared/ephemeral_utils.js` (`WAIEphemeralUtils`): PII-redacted Markdown chat exporter shared by `app/electron/ephemeral_notes.js` and extension/Android Blob export in `core/ui.js`.
- `shared/wai_page_bus.js` (`WAIPageBus`): typed cross-world JSON `CustomEvent` bridge (`wai:bridge:to-page` / `wai:bridge:to-host`) and one merged `DOMObserver` (`MutationObserver` on `document.body` shared by `core/ui.js` and `core/status_download.js`).

Root `manifest.json` stays Firefox/Gecko-compatible (`background.scripts`); `scripts/build.mjs` derives Chrome MV3 (`background.service_worker`, stripping `browser_specific_settings`), collects `action.default_popup` (`popup.html`) and its referenced scripts (`popup.js`, `shared/settings_renderer.js`, etc.), and stamps `version` from `package.json`.

---

## 2. Load-bearing constraints

### C1 — Inject `MAIN_CRITICAL` (`ws_hook.js` + `comms_worker_fix.js`) before socket/worker startup

- In Electron, `app/electron/preload.js` injects `page-hooks/native-ws.js` and `app/.build/critical.js` via `webFrame.executeJavaScript` at `document_start` directly into the main world. `webContents.executeJavaScript` awaits `did-stop-loading`, which is too late.
- In extensions / GeckoView, `core_injection.js` reads `WAIBundleManifest` and sequentially awaits `MAIN_CRITICAL` (`core/ws_hook.js` followed by `core/comms_worker_fix.js`) before queueing `MAIN_REST` with `async = false`. Asserted by `A-critical` and `A-injection`.

### C2 — `contextIsolation: true`, and `sandbox: false` deliberately

`contextIsolation` is mandatory (`nodeIntegration: false`). `sandbox: false` allows the preload to read `app/.build/*` without a synchronous `ipcRenderer.sendSync` round-trip blocking `document_start` WebSocket hooking.

On Linux, Chromium aborts before JS runs if the unprivileged SUID `chrome-sandbox` helper is misconfigured unless `--no-sandbox` is passed at process spawn (`pnpm start`), fixed in packaged `.deb` installs via `app/packaging/linux/postinst` (`4755`), or gated via `app/electron/sandbox.js`.

### C3 — `MAIN_REST` and `UI` remain separate bundles

`MAIN_REST` (`core/interception.js` `initialize`) and `UI` (`core/ui.js` `initializeUI`) are emitted as separate bundles and checked by `A11` / `A2` against column-0 lexical or name collisions. Cross-world communication between `MAIN_REST` (page world in extensions) and `UI` (isolated world in extensions) flows through `WAIPageBus` (`shared/wai_page_bus.js`). Both `core/ui.js` and `core/status_download.js` share `WAIPageBus.DOMObserver` rather than allocating duplicate body-level `MutationObserver` instances.

### C4 — CSP forbids shell-owned schemes; bootstrap state is synchronous

In Electron, WhatsApp CSP forbids `file:` / shell URLs for assets and stylesheets. `styles.js` injects CSS inline, `assets.json` inlines `data:` URIs (`A6`), and `preload.js` injects `window.__WAI_BOOTSTRAP__` (containing `prefs`, `whitelist`, and `notes`) before `shim.js` so `getInitialState` and `getOptions` answer synchronously with zero startup flicker or race.

### C5 — `partition: 'persist:wai'`

Declared once (`PARTITION`) for both `session.fromPartition(PARTITION)` and `webPreferences.partition`.

### C6 — Engine floor check

`assessEngine()` verifies `process.versions.chrome` meets WhatsApp Web's minimum supported Chromium major version before proceeding. `DESKTOP_UA` stays synchronized across `shared/bundle_manifest.js`, `rules.json`, and `MainActivity.kt` (`A-ua`).

---

## 3. Single-world UMD & Electron page hooks

Extensions isolate content scripts from WhatsApp's webpack globals; Electron runs everything in the page's single world where webpack defines global AMD `define`. Every UMD file (`lib/pako.js`, `lib/pbf.3.0.5.min.js`, `lib/sweetalert.min.js`, and all `shared/*.js` modules) must place its UMD/CJS header within the first 600 chars so `scripts/build.mjs` wraps it in a `var define=void 0, exports=void 0, module=void 0;` global-branch guard (`A-umd`, `A-umd2`), never call bare `require()` inside browser factories, and declare zero column-0 `var`/`let`/`const`/`function`/`class` bindings (`A2`, `A11`).

Electron preload hooks live as modular browser scripts under `app/electron/page-hooks/`:
- `native-ws.js`: captures native `WebSocket` before `ws_hook.js`.
- `diagnostics.js`: captures CSP violations and main-world runtime errors.
- `notifications.js`: forwards renderer `Notification` calls cleanly.
- `watchdog-probe.js`: listens on `onReadConfirmationBlocked` and `onInterceptionWorking` and reports hook health to `app/electron/watchdog.js`.

---

## 4. Settings & feature wiring across surfaces

Every setting's key, type, range, group, and default comes from `shared/settings_schema.js`:

1. **Extension toolbar popup (`popup.html` + `popup.js`)**: MV3 CSP-clean (`A-panelkeys`), displays live WhatsApp tab status + open/switch action, and mounts `WAISettingsRenderer` (`scope: 'shared'`).
2. **In-page modal (`#wai-settings-modal`)**: Mounted by `core/ui.js` using the same `WAISettingsRenderer` on navbar icon click, `Alt+Shift+I`, `#wai-fallback-trigger` (when WhatsApp renames navbar classes), or Electron fallback (`__WAI__.openOptions({ focus })`, e.g. for setting the 4-digit SHA-256 Privacy Screen Lock PIN). Drop/Tether (`lib/drop.js`) has been retired.
3. **Electron native tray/settings menu (`app/electron/settings-menu.js`)**: Dynamically built from `WAISettingsSchema.specsFor('all')` + `GROUPS`, rendering `safetyDelay` (`0..30`) and `privacyScreenLockIdleMinutes` (`1..60`) radio submenus and `"Set / Change Privacy PIN…"` / `"Clear Privacy PIN"` actions for `privacyScreenLockPIN`.

Preference changes from the Electron menu/tray push via `preload` → `shim.js` (`onOptionsUpdate`) → `core/interception.js` (enforcing globals), `core/status_download.js` (`allowStatusDownload`), `core/injected_ui.js` (blocked-receipt banners & unread counter colors), and `core/ui.js` (Privacy Screen Lock + open modal sync). Tested live by `A-liveprefs`. Extension background/tab sync uses `getInitialState` and `wai:optionsUpdated`; scheduled messages only advance to `sent` after an explicit live-tab ack. Chat headers remain free of extra pills, Private Note, and Export buttons.

---

## 5. Commands & Verification

| Command | Purpose |
|---|---|
| `pnpm run build` | Build Firefox, Chrome, Electron, and Android GeckoView outputs |
| `pnpm run check` | Build + package extension zips + run all assertions (`verify-bundles.mjs`) + unit tests |
| `pnpm run verify` | Run `scripts/verify-bundles.mjs` only |
| `pnpm test` | Run `app/electron/*.test.js` via `node --test` |
| `pnpm run doctor:android` | Verify Android GeckoView staged assets and Kotlin wiring |
| `pnpm dev` | Watch (`core`, `lib`, `shared`, `images`, `popup*`, `app/electron/page-hooks`, etc.), rebuild, verify, hot-inject `'bundles'` or relaunch `'app'` |
| `pnpm run kill` | Stop stale Electron / watcher instances (`--dry`, `--all`) |
