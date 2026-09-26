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

# Building and releasing

How this project is built, verified, and shipped. Everything here runs on GitHub
Actions, and everything here can be reproduced on your own machine first.

## Build targets

`scripts/build.mjs` derives every target's file list from `manifest.json` rather
than hardcoding it, so an upstream change that adds or removes a file propagates
everywhere automatically and nothing can silently drift. `manifest.json` itself is
never rewritten, which is what keeps `git merge upstream/master` clean.

```bash
pnpm install

pnpm build              # all three targets
pnpm build:chrome       # dist/extension/chrome   MV3, background.service_worker
pnpm build:firefox      # dist/extension/firefox  upstream manifest verbatim
pnpm build:electron     # app/.build/             bundles for the desktop shell

pnpm verify             # 22 build-time assertions
pnpm test               # 46 unit tests over the Electron shell
pnpm check              # build + verify + test, no GUI  (this is what CI runs)
pnpm one                # the above, then launch the app and print a verdict
pnpm dev                # rebuild and relaunch on change
```

`pnpm verify` exists to turn silent failures into build failures. The ones that
matter most are A1/A11: a dead interception hook and a `let` redeclaration both look
perfectly healthy right up until WhatsApp fails to load.

To load the built extension, point Chrome at `dist/extension/chrome` with developer
mode on. `pnpm start` runs the Electron app (needs `pnpm build:electron` first).

## Two workflows

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | push, pull request, manual | The gate. Decides whether a commit is shippable. |
| [`release.yml`](.github/workflows/release.yml) | **tag push** or **manual dispatch** | The gate again, then builds artefacts and publishes a release. |

Both entry points into `release.yml` converge on one `resolve` job, so a release
started from a tag and a release started by hand run the same pipeline. The only
difference is which knobs are reachable.

### Quick reference

```bash
# 1. Ship the version already in manifest.json
git tag v2.5.6 && git push origin v2.5.6

# 2. Bump to a new version and ship it (commit + tag + release, all automatic)
#    Actions -> Release -> Run workflow -> version: 2.6.0, bump_manifest: true,
#    dry_run: false

# 3. See what a release WOULD look like, publish nothing
#    Actions -> Release -> Run workflow, leave everything default
```

## `ci.yml`

Runs on every push to any branch, every pull request, and on demand.

### `check` — the gate

Matrixed over **Node 22 and 24** (Node 22 is the floor; the unit tests use
`node --test` with glob patterns, which needs 21+). Pin one with
`workflow_dispatch` → `node_version`.

| Step | What it protects against |
| --- | --- |
| Version consistency | `manifest.json` and `package.json` disagreeing. The extension would report one version and the AppImage filename another. |
| `pnpm build` | Any of the three targets stopping to build. Building all three means a broken Firefox build cannot hide behind a working Chrome build. |
| `pnpm verify` | The silent failure modes: a dead interception hook that looks healthy, a `let` redeclaration that kills an entire bundle with a `SyntaxError`, an unsubstituted build placeholder, a UTF-8 BOM at a bundle seam. |
| `pnpm test` | The Electron shell unit tests. |
| `electron-builder --linux` | A packaging regression, caught on a PR instead of at release time. |

If CI is red, reproduce it locally with `pnpm check` before you push a fix.

### `package` — the cross-platform installer check

Runs after `check` passes, and packages on Linux, Windows and macOS. Kept as a
separate job so a platform-specific packaging failure shows up in the PR checks list
instead of only at release time. Skip it on a manual run with
`package_runners: false`.

### Concurrency

Superseded runs on the same ref are cancelled. A newer push is strictly better than
the run it replaces, so there is no reason to keep the old one going.

## `release.yml`

```
resolve ──> verify ──┬──> build-extension (chrome, firefox) ──┐
  │                  │                                        ├──> publish
  └──> bump + tag ───┴──> build-electron (4 platforms) ────────┘
```

### Trigger 1 — a tag

```bash
git tag v2.5.7
git push origin v2.5.7
```

The tag is the version. Nothing else is configurable on this path, deliberately: a
tag push is a statement of intent, not a place to ask questions.

| Situation | Result |
| --- | --- |
| `v2.5.7` and `manifest.json` says `2.5.7` | Release `v2.5.7` |
| `v2.5.7` and `manifest.json` says `2.5.6` | **Fails**, pointing at `bump_manifest` or `force` |
| `2.5.7` (no `v`) | Works; the release references the literal tag you pushed |
| `nightly` | **Fails** — not semver |
| A `version` input is also set | **Fails** — a tag already names a version; use a manual run |

A tag push never dry-runs and never bumps. It cannot rewrite your history, and it
cannot silently publish nothing.

### Trigger 2 — manual dispatch

| Input | Default | Effect |
| --- | --- | --- |
| `version` | `manifest.json` | Manual override. Accepts `2.6.0`, `v2.6.0`, or ` 2.6.0 `. |
| `tag` | `v<version>` | Release tag. Set it for a non-semver tag like `release-2.6.0`. |
| `targets` | `all` | `all`, `extension`, or `electron`. |
| `bump_manifest` | `false` | Rewrite `manifest.json` + `package.json` to `version`, commit, push to master. |
| `create_tag` | `true` | Create and push the tag if it does not exist. |
| `draft` | `false` | Publish as a draft release. |
| `prerelease` | `false` | Mark as a prerelease. |
| `dry_run` | **`true`** | Build and verify everything, publish nothing. |
| `force` | `false` | Skip the tag/version consistency check. |
| `notes` | auto-generated | Custom release notes instead of GitHub's generated ones. |

`dry_run` defaults to **`true`**: a manual run should be a rehearsal unless you
explicitly ask it to publish. The first thing to do when a release goes wrong is
re-run it with `dry_run: true` and read the step summary.

### `resolve` — the only place a version is decided

`resolve` reads `manifest.json`, applies your overrides, and emits the version, tag
and flags as job outputs. **Nothing downstream re-derives a version from a second
source.** That discipline is what prevents the classic failure where the zip says
2.5.7 and the AppImage says 2.5.6.

It rejects, with an actionable message, a version that:

- is not semver (`2.5.7`, `2.5.7-rc.1` — not `2.5`, not `nightly`)
- differs from `manifest.json`, unless `bump_manifest` or `force` is set
- disagrees with `package.json` on the current version (a skew that should be fixed
  in a commit, not papered over by a release)

A version is normalised *before* the tag is derived, so `v2.6.0` yields `v2.6.0` and
not `vv2.6.0`. A **tag** is never rewritten, only a version — on a tag push the tag
is a git object that already exists and the release must reference it verbatim.

The tag is validated against git's ref rules, because it is not just a display
string: it is passed to `git tag`, and it reaches the run summary. `release 2.5.6`,
`v*`, `v$(id)` and a tag containing a newline are all rejected. Leading and trailing
whitespace *is* absorbed, because a pasted tag with a stray trailing space is a typo
worth forgiving; whitespace inside one is not, because silently turning
`release 2.5.6` into `release2.5.6` publishes a tag nobody asked for.

### Bumping the manifest

With `bump_manifest: true`, the job rewrites the `version` field in `manifest.json`
and `package.json`, commits as `github-actions[bot]` with `[skip ci]`, and pushes to
**master**.

Two guards:

- **Master only.** Running from a feature branch fails immediately. Pushing a version
  bump to a side branch would ship a version that master does not have.
- **Exactly one changed line per file.** The replacement is surgical — it rewrites the
  `"version"` value in place rather than re-serialising the file, because neither JSON
  file here is `JSON.stringify`-normalised and a re-serialisation would turn a
  one-line change into an 81-line reformat.

Order matters: the bump commits **first**, and the tag is created on the bump commit,
so `v2.6.0` points at the tree that actually contains `2.6.0`. `create_tag` refuses
to move an existing tag; if `v2.6.0` already points at a different commit, the run
fails rather than releasing the wrong tree.

### `verify` — the gate, repeated

Identical to `ci.yml`'s gate: build, verify, test. A tag is not a licence to skip
verification. It costs about 30 seconds and is the cheapest insurance in the pipeline.

### `build-extension` — the two zips

Zips the **build output** (`dist/extension/chrome`, `dist/extension/firefox`), which
`build.mjs` already derived from `manifest.json` — not the repository root. The
retired `create-release.yml` used `mv !(release|.github)`, which shipped `app/`,
`scripts/`, `docs/` and `.gitignore` to users; zipping a build target cannot leak
anything and cannot drift from what `pnpm verify` just checked.

The zips are also **reproducible**: file mtimes are normalised to the commit date and
the timezone pinned, so the same commit always produces the same bytes. The step
prints a `sha256`, so "did this artefact actually change?" is a checksum comparison
rather than a guess based on a timestamp.

Output: `WAIncognito-<version>-chrome.zip`, `WAIncognito-<version>-firefox.zip`.

### `build-electron` — the desktop installers

One runner per platform and architecture, in parallel:

| Runner | Artefacts | Signing |
| --- | --- | --- |
| `ubuntu-latest` | AppImage, deb | n/a |
| `windows-latest` | NSIS `.exe` | `WIN_CSC_LINK` / `WIN_CSC_PASSWORD` |
| `macos-13` | `.dmg` (x64) | `MAC_CSC_LINK` / `MAC_CSC_PASSWORD` + notarisation |
| `macos-14` | `.dmg` (arm64) | same |

`--publish never` on every invocation. The build jobs upload artefacts; the `publish`
job owns the release. A build job must never be able to reach a release provider.

#### Signing

Signing is **inert until you add secrets.** With no credentials configured the build
produces exactly the unsigned artefacts it produces today, plus a notice and a
warning in the run summary. Nothing to switch on, nothing that can break a release.

| Secret | Purpose |
| --- | --- |
| `MAC_CSC_LINK` | base64 of the Apple Developer `.p12` |
| `MAC_CSC_PASSWORD` | that `.p12`'s password |
| `WIN_CSC_LINK` | base64 of the Windows code-signing `.pfx`/`.p12` |
| `WIN_CSC_PASSWORD` | its password |
| `APPLE_ID` | Apple account used for notarisation |
| `APPLE_APP_SPECIFIC_PASSWORD` | app-specific password for that account |
| `APPLE_TEAM_ID` | 10-character team id |

To create the secret, on a machine holding the certificate:

```bash
base64 -w0 cert.p12        # macOS: add `| pbcopy`
```

`MAC_CSC_LINK` and `WIN_CSC_LINK` are separate on purpose. `CSC_LINK` is a single
variable, so pointing both at one file would sign the Windows `.exe` with the Apple
identity.

The workflow decodes the secret with node rather than `base64`, because the GNU and
BSD flags disagree (`-d` / `-D` / `-o`) and the same step runs on all four runners.
Notarisation needs all three `APPLE_*` secrets; each is checked separately, so a
half-configured set reports exactly which one is missing instead of quietly skipping.

**Until signing is configured, expect the Gatekeeper prompt on macOS** (right-click →
Open) and the SmartScreen warning on Windows. Every installer job writes its
signed/notarised state to the run summary and emits a `::warning::` when a build that
should have been signed was not, so a missing secret is visible at a glance instead
of in a support report.

### `publish`

Downloads every artefact, refuses to publish an empty release, and creates the
release.

The job guard spells out each dependency's result:

```yaml
if: >-
  always()
  && needs.resolve.result == 'success'
  && needs.verify.result == 'success'
  && (needs.build-extension.result == 'success' || needs.build-extension.result == 'skipped')
  && (needs.build-electron.result == 'success' || needs.build-electron.result == 'skipped')
```

This is not redundant. With `targets: electron`, `build-extension` is skipped — and
a plain `needs:` would skip `publish` with it, so `targets=extension` and
`targets=electron` would both silently publish nothing.

Both dry-run and real runs write a summary table to the Actions run page.

## Conventions

**pnpm is pinned to major 12.** `pnpm-workspace.yaml` uses the `allowBuilds` key,
which is pnpm 12 syntax. `--frozen-lockfile` on a runner with a different pnpm would
reject the lockfile, or skip electron's postinstall and fail confusingly later.

**Node 24 in every non-matrix job.** It matches the local toolchain; the `check`
matrix is what proves older versions still work.

**Nothing runs on a tag in `ci.yml`.** `tags-ignore: v*` — `release.yml` already runs
the full gate. Running both would double the release time for no extra signal.

**One release per tag.** `concurrency` with `cancel-in-progress: false` queues a
second run against the same tag instead of racing the first. A second run on one tag
is a mistake, not a parallel job.

**Least privilege.** `ci.yml` gets `contents: read`. Only `release.yml` gets
`contents: write`, and only because it creates tags, pushes the bump commit and
publishes.

**No `${{ }}` inside a `run:` block.** Every value a shell step needs arrives through
`env:`. Interpolating an expression into a script is a shell-injection surface, and
it also makes the step impossible to exercise outside a runner.

## Rehearsing the decision logic locally

The steps in `release.yml` that make decisions are plain bash, and each one has been
exercised outside a runner. They are the parts most likely to fail, and a failure in
any of them is either a wrong release or a release that never happens.

| Step | Cases | Needs |
| --- | --- | --- |
| Resolve version/tag/flags | 37 | nothing but the repo |
| Bump `manifest.json` + `package.json` | 11 | a scratch git repo and a bare `origin` |
| Ensure the tag exists | 7 | a scratch clone and a bare `origin` |
| Signing certificate + notarisation | 23 | a temp dir and a fake `GITHUB_ENV` |

Run the bump and tag rehearsals in a throwaway repo, never in the working tree: both
steps run `git commit` and `git push`, and the working tree is rarely clean.

**Two rules to preserve when editing these steps**

Derive each rehearsal's environment from the workflow's own `env:` block rather than
hand-listing variables. A step that references a variable it forgot to declare then
fails locally instead of on a tag push — which is exactly how an undeclared
`IN_CREATE_TAG` shipped broken in the first draft.

Parse `$GITHUB_OUTPUT` the way the runner does, including the `key<<DELIM` heredoc
form, and assert every line was consumed. A malformed output file does not degrade
gracefully; it fails the step.

**Bugs these rehearsals caught**, all of which would otherwise have shipped:

- An undeclared `IN_CREATE_TAG` made every manual release fail on an unbound
  variable.
- The version was normalised *after* the tag was derived, so `v2.6.0` produced a tag
  of `vv2.6.0`.
- `JSON.stringify(obj, null, 2)` rewrote all 81 lines of `manifest.json` instead of
  one, which would have made the "exactly one changed line" guard reject every bump.
- `awk '{...} END {print (n || 0) ":" ...}'` is mis-parsed by **mawk**, which is what
  Ubuntu runners ship: it reported one changed file where there were two, and the
  guard would have failed every release.
- `$1` inside a `String.replace` *function* replacer is a literal dollar-one, not a
  backreference, so the version line was written as `$1"version": "2.6.0"`.
- A multi-line `notes` value written as `notes=$value` spilled into `$GITHUB_OUTPUT`
  as invalid entries, losing the release notes entirely.
- `tr -d '[:space:]'` silently turned a tag of `release 2.5.6` into `release2.5.6`.
  Replaced with trim-the-edges plus validation, so a malformed tag is rejected rather
  than quietly renamed.
- `grep` is line-oriented, so the tag validation only checked the first line of a
  value containing a newline. Replaced with bash's `=~`, which matches the whole
  string.
- `base64 --decode -o` is GNU-specific; the same step runs on macOS runners, where
  the flags differ. Replaced with a node one-liner.

## Not covered

- **Safari extension.** `convert-to-safari.yml` is untouched: it runs on push to
  master, needs a macOS runner with Xcode, and has no relationship to the release
  artefacts.
- **Store submission.** The extension zips are attached to the GitHub release only.
  Chrome Web Store and AMO submission are manual, and the API tokens are not
  configured here. This is the obvious next thing to automate; it needs
  `CWS_CLIENT_ID` / `CWS_CLIENT_SECRET` / `CWS_REFRESH_TOKEN` and an AMO
  `AMO_JWT_ISSUER` / `AMO_JWT_SECRET`.
- **Auto-generated changelog.** Release notes are GitHub's generated notes, not a
  curated `CHANGELOG.md`. There is no `CHANGELOG.md` in the repository.

## Retired

`create-release.yml` has been **deleted**. It had a single `version` input, built its
zip with `mv !(release|.github)` (which shipped `app/`, `scripts/` and `docs/` to
users), and ran no verification before publishing. `release.yml` replaces it.

Worth knowing if you go looking for it: both files could be triggered by hand and
both created releases, so they would have disagreed about the version. Two release
workflows is one too many.

