'use strict';
// Dev-only hot reload. Loaded by main.js only when started with --dev.
//
// The interesting problem here is that "hot" means two very different things:
//
//   scope 'bundles' -> the page can be re-injected IN PLACE. app/.build/*.js changed
//                      (upstream core/ or lib/ edited), so re-run the preload injection
//                      sequence. No window, no socket, no login touched. Fast, and it is
//                      the case you hit constantly while editing interception code.
//
//   scope 'app'     -> main/preload/watchdog/tray changed. Node has already loaded
//                      those modules and a preload cannot be swapped in a live renderer,
//                      so the only correct action is a full relaunch.
//
// Getting this wrong in the 'app' direction is subtle and worth stating: trying to
// hot-swap the preload would leave a renderer running the OLD preload against NEW
// bundles, which is exactly the torn-context state the watchdog exists to detect. It
// would look like it worked, right up until it did not.
//
// This module is deliberately free of Electron imports and of timers/fs, so the
// decision logic is unit-testable (dev-bridge.test.js). main.js supplies the real
// fetch/timer/relaunch.

const POLL_PATH = '/ping';

class DevBridge {
  /**
   * @param {object} opts
   * @param {string} opts.url            dev server base, e.g. http://127.0.0.1:7311
   * @param {number} [opts.intervalMs]   poll cadence
   * @param {Function} opts.onReload      ({scope, reason}) => void
   * @param {Function} [opts.fetchImpl]   injectable for tests
   * @param {Function} [opts.setTimeoutImpl]
   * @param {Function} [opts.clearTimeoutImpl]
   * @param {Function} [opts.log]
   */
  constructor(opts) {
    this.url = String(opts.url).replace(/\/+$/, '');
    this.intervalMs = opts.intervalMs || 700;
    this.onReload = opts.onReload;
    this.fetchImpl = opts.fetchImpl || ((...a) => fetch(...a));
    this.setTimeoutImpl = opts.setTimeoutImpl || setTimeout;
    this.clearTimeoutImpl = opts.clearTimeoutImpl || clearTimeout;
    this.log = opts.log || (() => {});
    this.timer = null;
    this.stopped = false;
    this.failures = 0;
    this.lastSig = null;   // signature of the last change acted on, for dedup
  }

  start() {
    this.stopped = false;
    this.#schedule();
    return this;
  }

  stop() {
    this.stopped = true;
    if (this.timer) { this.clearTimeoutImpl(this.timer); this.timer = null; }
  }

  #schedule() {
    if (this.stopped) return;
    this.timer = this.setTimeoutImpl(() => { this.tick(); }, this.intervalMs);
  }

  /** One poll. Exposed so tests can drive it without timers. */
  async tick() {
    if (this.stopped) return null;
    let change = null;
    try {
      const res = await this.fetchImpl(`${this.url}${POLL_PATH}`, {
        headers: { accept: 'application/json' },
      });
      if (res && res.ok) {
        const body = await res.json();
        change = normalizeChange(body);
        this.failures = 0;
      }
    } catch (e) {
      // The dev server restarting is normal and must not spam or crash the app. Count
      // consecutive failures and only surface it once things look genuinely wrong.
      this.failures++;
      if (this.failures === 10) this.log(`[dev] no dev server at ${this.url} after 10 tries; is \`npm run dev\` still running?`);
    } finally {
      this.#schedule();
    }
    if (change) {
      // Dedup on the signature. The dev server is meant to report only real edits, but
      // if it ever repeats itself, re-injecting on every poll would put the page in a
      // reload loop — which looks exactly like the app being broken.
      const sig = `${change.scope}|${change.reason}`;
      if (sig === this.lastSig) return null;
      this.lastSig = sig;
      this.log(`[dev] change: ${change.scope} (${change.reason}) -> ${change.scope === 'app' ? 'relaunch' : 're-inject'}`);
      try { this.onReload(change); } catch (e) { this.log(`[dev] reload handler threw: ${e && e.message}`); }
    }
    return change;
  }
}

/**
 * Decide what a change means. Kept pure and exported so the rules are testable without
 * a dev server, a browser, or Electron.
 *
 * @param {string[]} changed  repo-relative paths
 * @returns {{scope:'bundles'|'app'|'none', reason:string}}
 */
function classifyChange(changed) {
  if (!Array.isArray(changed) || !changed.length) return { scope: 'none', reason: 'no files' };

  // Checked first and exclusively: editing the shell must always win, because a
  // half-applied shell change is worse than a redundant relaunch. Test files are
  // excluded — editing a test must never restart a running app.
  const appHits = changed.filter((f) =>
    /^app\/electron\/(?!shim\.js$)(?!.*\.test\.js$)[^/]+\.js$/.test(f) || f === 'package.json');
  if (appHits.length) return { scope: 'app', reason: `shell: ${appHits.join(', ')}` };

  // shim.js is page-world code, not shell code: it is bundled, so it is hot.
  const bundleHits = changed.filter((f) =>
    /^(core|lib)\//.test(f) ||
    /^app\/electron\/shim\.js$/.test(f) ||
    /^(styles\.css|manifest\.json|background\.js|core_injection\.js)$/.test(f) ||
    /^patches\//.test(f));
  if (bundleHits.length) return { scope: 'bundles', reason: `bundles: ${bundleHits.join(', ')}` };

  return { scope: 'none', reason: `ignored: ${changed.join(', ')}` };
}

/** Tolerant parse of whatever the dev server sent. */
function normalizeChange(body) {
  if (!body || typeof body !== 'object') return null;
  if (body.scope === 'app' || body.scope === 'bundles') {
    return { scope: body.scope, reason: String(body.reason || 'unspecified') };
  }
  if (Array.isArray(body.changed)) return classifyChange(body.changed);
  return null;
}

module.exports = { DevBridge, classifyChange, normalizeChange, POLL_PATH };
