# agnest.md — CI and release automation

How WAIncognito is built, verified, and shipped on GitHub Actions.

Two workflows, deliberately:

| Workflow | Trigger | Purpose |
| --- | --- | --- |
| [`ci.yml`](.github/workflows/ci.yml) | push, pull request, manual | The gate. Decides whether a commit is shippable. |
| [`release.yml`](.github/workflows/release.yml) | **tag push** or **manual dispatch** | The gate again, then builds artefacts and publishes a release. |

Both entry points into `release.yml` converge on one `resolve` job, so a release
started from a tag and a release started by hand produce byte-identical pipelines.
The only difference is which knobs are reachable.

---

## Quick reference

```bash
# 1. Ship the version already in manifest.json
git tag v2.5.6 && git push origin v2.5.6

# 2. Bump to a new version and ship it (commit + tag + release, all automatic)
#    Actions -> Release -> Run workflow -> version: 2.6.0, bump_manifest: true,
#    dry_run: false

# 3. See what a release WOULD look like, publish nothing
#    Actions -> Release -> Run workflow, leave everything default
```

---

## `ci.yml`

Runs on every push to any branch, every pull request, and on demand.

### `check` — the gate

Matrixed over **Node 22 and 24** (Node 22 is the floor; the unit tests use
`node --test` with glob patterns, which needs 21+). Pin one with
`workflow_dispatch` → `node_version`.

| Step | What it protects against |
| --- | --- |
| Version consistency | `manifest.json` and `package.json` disagreeing. The extension would report one version and the AppImage filename another. |
| `pnpm run build` | Any of the three targets (firefox, chrome, electron) stopping to build. Building all three means a broken Firefox build cannot hide behind a working Chrome build. |
| `pnpm run verify` | The silent failure modes: a dead interception hook that looks healthy, a `let` redeclaration that kills an entire bundle with a `SyntaxError`, an unsubstituted build placeholder, a UTF-8 BOM at a bundle seam. 22 assertions. |
| `pnpm test` | 46 unit tests over the Electron shell. |
| `electron-builder --linux` | A packaging regression, caught on a PR instead of at release time. |

`pnpm run build` and `pnpm run verify` are the same commands you run locally
(`docs/ELECTRON_APP_PLAN.md` §7). If CI is red, reproduce it before you push a fix.

### `package` — the cross-platform installer check

`check` passes, then packages on Linux, Windows, and macOS. Kept as a separate job
so a platform-specific packaging failure is visible in the PR checks list.

Skip it on a manual run with `package_runners: false`.

### Concurrency

Superseded runs on the same ref are cancelled. A newer push is strictly better than
the run it replaces, so there is no reason to keep the old one going.

---

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

Every knob is on the dispatch form.

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
explicitly ask it to publish. The very first thing to do when a release goes wrong
is re-run it with `dry_run: true` and read the step summary.

### `resolve` — the only place a version is decided

`resolve` reads `manifest.json`, applies your overrides, and emits the version, tag,
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
is a git object that already exists and the release has to reference it verbatim.

### Bumping the manifest

With `bump_manifest: true`, the job rewrites the `version` field in `manifest.json`
and `package.json`, commits as `github-actions[bot]` with `[skip ci]`, and pushes to
**master**.

Two guards:

- **Master only.** Running from a feature branch fails immediately. Pushing a version
  bump to a side branch would ship a version that master does not have.
- **Exactly one changed line per file.** A whole-file reformat would bury the real
  change in an unreviewable diff, so the job diffs the result and fails if it is
  anything other than a clean one-line version swap in each of the two files.

Order matters: the bump commits **first**, and the tag is created on the bump commit.
So `v2.6.0` points at the tree that actually contains `2.6.0`.

`create_tag` refuses to move an existing tag. If `v2.6.0` already points at a
different commit, the run fails rather than silently releasing the wrong tree.

### `verify` — the gate, repeated

Identical to `ci.yml`'s gate: build, verify, test. A tag is not a licence to skip
verification. Roughly 30 seconds; it is the cheapest insurance in the pipeline.

### `build-extension` — the two zips

Zips the **build output** (`dist/extension/chrome`, `dist/extension/firefox`), which
`scripts/build.mjs` already derived from `manifest.json` — not the repository root.

The previous `create-release.yml` used `mv !(release|.github) release/`, which shipped
`app/`, `scripts/`, `docs/`, and `.gitignore` to users. Zipping a build target cannot
leak anything and cannot drift from what `verify-bundles.mjs` just checked.

The zips are also **reproducible**: file mtimes are normalised to the commit date and
the timezone is pinned, so the same commit always produces the same bytes. The step
prints a `sha256`, so you can answer "is this artefact actually different?" by
comparing checksums rather than trusting a timestamp.

Output: `WAIncognito-<version>-chrome.zip`, `WAIncognito-<version>-firefox.zip`.

### `build-electron` — the desktop installers

One runner per platform and architecture, in parallel:

| Runner | Artefacts |
| --- | --- |
| `ubuntu-latest` | AppImage, deb |
| `windows-latest` | NSIS `.exe` |
| `macos-13` | `.dmg` (x64) |
| `macos-14` | `.dmg` (arm64) |

`CSC_IDENTITY_AUTO_DISCOVERY=false` on every platform: no signing identity exists on a
runner, and without it `electron-builder` probes for one and reports a failed probe as
a build failure. **These artefacts are unsigned.** See signing below.

`--publish never` on every invocation. The build jobs upload artefacts; the `publish`
job owns the release. A build job must never be able to reach a release provider.

`ELECTRON_CACHE` and `ELECTRON_BUILDER_CACHE` point inside the workspace so one
cross-platform cache key works, instead of three OS-specific path sets.

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

---

## Conventions

**pnpm is pinned to major 12.** `pnpm-workspace.yaml` uses the `allowBuilds` key,
which is pnpm 12 syntax. `--frozen-lockfile` on a runner with a different pnpm would
reject the lockfile, or skip electron's postinstall and fail confusingly later.

**Node 24 in every non-matrix job.** It matches the local toolchain; the `check`
matrix is what proves older versions still work.

**Nothing runs on a tag in `ci.yml`.** `tags-ignore: v*` — `release.yml` already runs
the full gate. Running both would double the release time for no extra signal.

**One release per tag.** `concurrency` with `cancel-in-progress: false` queues a second
run against the same tag instead of racing the first. A second run on one tag is a
mistake, not a parallel job.

**Least privilege.** `ci.yml` gets `contents: read`. Only `release.yml` gets
`contents: write`, and only because it creates tags, pushes the bump commit, and
publishes.

---

## Rehearsing the resolve logic locally

The `resolve` step is plain bash, so its decision table can be tested without a
runner. Given a workflow, it exercises every trigger shape and asserts the exit code
and outputs.

The one thing to preserve if you edit that step: the test derives each case's
environment from the workflow's own `env:` block. A step that references an `IN_*`
variable it forgot to declare fails locally, rather than on a tag push.

---

## Not covered

- **Safari extension.** `convert-to-safari.yml` is untouched: it runs on push to
  master, needs a macOS runner with Xcode, and has no relationship to the release
  artefacts.
- **Code signing / notarisation.** The installers are unsigned. macOS Gatekeeper will
  warn on first launch; users need right-click → Open, or a `spctl` allowance. Signing
  needs an Apple Developer identity and notarisation credentials in repository
  secrets, wired into electron-builder's `mac.identity` and `notarize` config.
- **Store submission.** The extension zips are attached to the GitHub release only.
  Chrome Web Store and AMO submission are manual, and the API tokens are not
  configured here.
- **Auto-generated changelog.** Release notes are GitHub's generated notes, not a
  curated `CHANGELOG.md`. There is no `CHANGELOG.md` in the repository.

## Also present, superseded

`create-release.yml` is **replaced by `release.yml`**. It only has a `version` input,
builds the zip with `mv !(release|.github)` (the leak described above), and has no
verification step. Delete it when you are ready — see the note in the workflow list.

Keeping both is actively confusing: both create releases, both can be triggered by
hand, and they will disagree about the version. Remove it before the first real
release.
