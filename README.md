# Invisible mode for WhatsApp Web
This is the source code of a chrome extension that disables read receipts and presence updates on WhatsApp Web.
You can find the original extension in [Chrome Web Store](https://chrome.google.com/webstore/detail/waincognito/alhmbbnlcggfcjjfihglopfopcbigmil).


![image](https://user-images.githubusercontent.com/11458759/226142143-70a7bbbd-2f20-4b0d-9a19-ce2342edbae5.png)

## Notable Features
- Block "read" receipts sending, and decide when to send them later (works for statuses as well)
- Block "typing"/"seen" updates (Will prevent you from seeing others')
- Always restore deleted messages of all kinds
- See whether every message was sent from a phone or a computer
- Download statuses

## Settings

| Setting | Default | Extension | Desktop app |
|---|---|---|---|
| Block read receipts | on | options panel | tray + native menu |
| Block online / last seen | off | options panel | tray + native menu |
| Block typing indicators | off | options panel | tray + native menu |
| Restore deleted messages | off | options panel | native menu |
| Show message device type | on | options panel | native menu |
| Auto-send receipts on reply | on | options panel | native menu |
| Allow status downloading | on | options panel | native menu |
| Warn before sending a receipt | on | via the confirmation dialog | native menu |
| Safety delay | off | — | native menu |
| Start automatically on login | off | — | tray + native menu |

In the desktop app every setting lives in one **native** menu — no HTML injected into the
page — reachable from the tray, from `Ctrl`/`Cmd` + `,`, or from the Settings menu on macOS.
The desktop app is the only build where the safety delay and the login item exist; the
extension has no such concepts.

## Installing from GitHub directly
To install the extension off-store, download the latest release as a zip file from the [Releases](https://github.com/tomer8007/whats-incognito/releases) page, or better, just clone the source code
**to a directory** and add it to Chrome using the 'Load unpacked extension' option when developer mode is turned on.

## How it works
This extension works by intercepting the WebSocket frames between chrome and WhatsApp's servers using a modified `WebSocket` constructor (see [wsHook](https://github.com/skepticfx/wshook)).

Those frames are then decrypted if needed using local encryption keys, and decoded from their binary XMPP form using a javascript code from WhatsApp's original implementation.

The resulting "stanzas" are then simply checked to see if WhatsApp tries to send out a `read` or `presence` action, and if so, the extension blocks it and fakes a failure response from the server.
## Organization & Internals
The main code of the extension is located in `core/interception.js` and in `core/ui.js`. 

Other files inside the `core` folder deal with the infrastructure that makes the interception and the decoding works. There is also an additional `parsing/` code for parsing messages (such as `message_types.js`) that is rarely used in the extension.
`background.js` mainly keeps track of the saved preferences using `localStorage`.

If you want to see what kind of messages WhatsApp is sending and receiving over WebSocket in real-time, you can type `WAdebugMode = true` in the javascript console. Incoming and outgoing payloads (after decryption) will be printed out.

## Other browsers support
This is more experimental, but should work.
If you want to use this extension in Firefox, you can load it using the developer page as explained in issue [#38](https://github.com/tomer8007/whatsapp-web-incognito/issues/38)

For Safari (macOS & iOS), you can use the automatically converted Xcode project. Simply download the latest artifact from the [GitHub Actions tab](../../actions), open it in Xcode, and run the extension on your device.

## Privacy
No data is ever transmitted to anywhere. Privacy policy [here](https://github.com/tomer8007/whatsapp-web-incognito/wiki/Chrome-Extension-Privacy-Policy).

---

---
---

# Building and releasing

## Build

`scripts/build.mjs` derives each target's file list from `manifest.json`, so nothing
can silently drift out of sync. `manifest.json` itself is never rewritten, which is
what keeps `git merge upstream/master` clean.

```bash
pnpm install

pnpm build           # all three targets
pnpm build:chrome    # dist/extension/chrome   -> Chrome, "Load unpacked"
pnpm build:firefox   # dist/extension/firefox  -> Firefox
pnpm build:electron  # app/.build/             -> desktop app

pnpm package:ext       # release/extensions/*.zip + firefox .xpi
pnpm package:chrome    # just the chrome zip
pnpm package:firefox   # just the firefox zip + .xpi

pnpm verify          # 27 build-time assertions
pnpm test            # unit tests
pnpm check           # build + package + verify + test, no GUI  <- what CI runs
pnpm one             # the above, then launch the app and print a verdict
pnpm dev             # the whole dev loop: build, verify, watch, and launch the app
pnpm start           # run the desktop app

pnpm doctor          # bare-window probe: is WhatsApp reachable, which engine
pnpm kill            # stop stale instances left holding the single-instance lock
```

Packaging the desktop app is `pnpm exec electron-builder` — the same command the release
workflow runs. Two flags that are not scripts, because both files document them already:
`node scripts/build.mjs --clean` and `node scripts/dev.mjs --once`.

> **On Linux the app runs without the Chromium zygote sandbox.** Chromium wants
> `chrome-sandbox` to be root-owned with mode `4755`, which an `npm`/`pnpm` install never
> produces, and where the unprivileged-namespace fallback is also unavailable — a container,
> a restricted VM, a seccomp/AppArmor profile blocking `unshare(CLONE_NEWUSER)` — Chromium
> aborts before a window exists. `app/electron/main.js` therefore passes `--no-sandbox`
> itself on Linux, unconditionally, so there is nothing to set and nothing to remember. The
> per-renderer `sandbox: false` and the navigation lock to `web.whatsapp.com` are unchanged
> and are what actually bound what this app loads. See
> [ARCHITECTURE.md](docs/ARCHITECTURE.md) §2.

`build` only ever wrote *unpacked* directories, so `package:ext` is what turns them into
the zips you actually install or submit. It packages what is already in `dist/extension/`
— it does not build, so run `build:chrome` / `build:firefox` first (or just `build`).

If CI is red, `pnpm check` reproduces it locally.

## CI

[`ci.yml`](.github/workflows/ci.yml) runs on every push and PR: version consistency,
all three build targets, the bundle assertions, the tests, and an
`electron-builder` packaging check. It also packages on Linux, Windows and macOS so
a platform-specific failure shows up in the PR checks instead of at release time.

## Releasing

[`release.yml`](.github/workflows/release.yml) re-runs the same checks, builds the
artefacts, and creates a GitHub release. Two ways in:

**Push a tag** — the tag is the version, and it must match `manifest.json`:

```bash
git tag v2.5.6 && git push origin v2.5.6
```

**Or run it by hand** — Actions → Release → Run workflow:

| Input | Default | Effect |
| --- | --- | --- |
| `version` | `manifest.json` | Version to release. |
| `tag` | `v<version>` | Release tag. |
| `targets` | `all` | `all`, `extension`, or `electron`. |
| `bump_manifest` | `false` | Update `manifest.json` + `package.json`, commit and push to master. |
| `create_tag` | `true` | Create the tag if missing. |
| `draft` | `false` | Publish as a draft. |
| `prerelease` | `false` | Mark as a prerelease. |
| `dry_run` | `false` | Build and check everything, publish nothing. |
| `force` | `false` | Skip the tag/version match check. |
| `notes` | auto | Release notes. |

To cut a new version in one go, run it by hand with `version: 2.6.0`,
`bump_manifest: true`. That commits the new version, tags it, and publishes.

The run fails rather than guessing if the version is not semver, if it disagrees
with `manifest.json`, or if `manifest.json` and `package.json` disagree with each
other. `bump_manifest` only works from `master`.

### What you get

- `WAIncognito-<version>-chrome.zip` and `-firefox.zip` — the loadable extensions
- AppImage + deb (Linux), NSIS installer (Windows), `.dmg` x64 and arm64 (macOS)

The zips are reproducible: the same commit always produces the same bytes, so you can
tell a real change from noise by comparing checksums. `scripts/package-ext.mjs` reproduces
the workflow's exact zip — same mtime normalisation, same byte-order sort, same flags — and
A20 in `scripts/verify-bundles.mjs` packs twice from deliberately different mtimes to prove
the property still holds rather than assuming it.

## Signing

Unsigned by default. macOS users have to right-click → Open, and Windows shows a
SmartScreen warning. To turn signing on, add these repository secrets and nothing
else — the workflow signs automatically when they are present:

| Secret | Value |
| --- | --- |
| `MAC_CSC_LINK` | `base64 -w0 cert.p12` (Apple Developer) |
| `MAC_CSC_PASSWORD` | that file's password |
| `WIN_CSC_LINK` | `base64 -w0 cert.pfx` (Windows) |
| `WIN_CSC_PASSWORD` | its password |
| `APPLE_ID` | Apple account, for notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that account |
| `APPLE_TEAM_ID` | 10-character team id |

Notarisation needs all three `APPLE_*` values. Each installer job reports whether it
was signed, so a missing secret is obvious in the run summary rather than in a
support ticket.

## If you change the release workflow

The decision logic is bash, and a few of its rules are easy to break by accident:

- Pass values into shell steps through `env:`, never as `${{ }}` inside a `run:`
  block. That keeps every step testable outside a runner.
- Do not re-serialise `manifest.json` or `package.json` with
  `JSON.stringify(x, null, 2)`. Neither file uses that formatting, so it turns a
  one-line version change into a full reformat. Edit the `"version"` value in place.
- Use bash `[[ =~ ]]`, not `grep`, to validate a value. `grep` is line-oriented and
  will only check the first line of something containing a newline.
- Avoid `awk` for arithmetic. `mawk`, which is what Ubuntu runners ship, mis-parses
  `(x || 0) ":" y`.
- Multi-line values need the `key<<DELIM` form in `$GITHUB_OUTPUT`; a bare
  `key=$value` loses everything after the first line.
- On macOS runners, use `base64 -D` (not GNU `-d`/`-o`) if you shell out to
  `base64`. Decoding with node avoids the whole question.

Each of those was a real bug that reached a draft of this workflow before being
caught by running the steps locally.

## Also in `.github/workflows`

- `convert-to-safari.yml` converts the extension to a Safari/Xcode project. Untouched.
- Store submission (Chrome Web Store, AMO) is not automated; the zips are attached to
  the GitHub release only.
- There is no `CHANGELOG.md`. Release notes are GitHub's generated ones.
