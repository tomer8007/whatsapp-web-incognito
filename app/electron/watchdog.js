'use strict';
// Liveness watchdog (docs/ELECTRON_APP_PLAN.md §9.4) — the highest-value piece of the
// background-mode story.
//
// WHY THIS EXISTS
// ---------------
// A dead hook is indistinguishable from a working one. `core/` has no self-check, the §2.3
// name collision produced an app that "looked installed and blocked nothing", and
// WhatsApp Web hard-reloads on updates and route changes, which destroys the injected
// hook. Left alone the app can sit in a tray for days looking healthy while quietly
// leaking every read receipt. So the status is derived, never assumed, and it is allowed
// to say NOT PROTECTED.
//
// WHY IT IS DRIVEN FROM HERE
// --------------------------
// Never from a page-side setInterval: a throttled or suspended page timer is exactly the
// failure mode we are defending against. The timer is a main-process timer and the page
// state is read on demand.
//
// THE "GENERATION UNCHANGED" RULE, CORRECTED
// ------------------------------------------
// §9.4 says "injectionGeneration unchanged since the last poll → injection was lost".
// Taken literally that is wrong, and taken literally it reports NOT PROTECTED on a
// perfectly healthy app forever: the shim bumps `generation` once per arm(), and arm()
// runs once per document, so the counter is CONSTANT while the app is working. What
// actually identifies a lost injection is:
//
//   - window.__WAI__ absent        → the document was replaced and not re-injected
//   - hookAlive === false          → arm() ran but wsHook was not there (§2.3)
//   - generation === 0             → arm() never ran
//   - generation DECREASED         → a new document started its own counter, so the hook
//                                    that was previously observed is provably gone
//   - a navigation was seen and no injection followed it within the grace window
//
// Those five are what is implemented, plus the reconnect rule for a closed socket.

const DEFAULT_POLL_MS = 20000;          // §9.4 asks for 15–30 s
const DEFAULT_SOCKET_CLOSED_MS = 45000;
const DEFAULT_REPOLL_MS = 3000;         // how fast to look again after an intervention
const DEFAULT_RECOVER_GRACE_MS = 25000;
const DEFAULT_NAV_GRACE_MS = 8000;      // a navigation that produces no injection
const DEFAULT_SETTLE_MS = 5000;         // a still-parsing document is not judged yet
const DEFAULT_KICK_PROBE_MS = 1500;     // after did-start-navigation: let the preload land
const MAX_RECOVERY_BACKOFF_MS = 300000;

const STATUS = Object.freeze({
  PROTECTED: 'PROTECTED',
  RECONNECTING: 'RECONNECTING',
  NOT_PROTECTED: 'NOT_PROTECTED',
  UNKNOWN: 'UNKNOWN',
});

/**
 * Read the page's liveness snapshot.
 *
 * webContents.executeJavaScript is correct HERE and only here: the C1 load gate matters
 * for the initial injection, and by poll time the frame has long finished loading. The
 * probe is guarded and returns a shape rather than throwing, so "the page is gone" and
 * "the page answered" stay distinguishable.
 *
 * The probe also installs a one-shot counter for the blocked-receipt signal. `core/` has
 * no blocked counter, but it dispatches a DOM CustomEvent per blocked read receipt
 * (core/node_handler.js) and already keeps the replay queue in `exceptionsList` — §9.6
 * asks the tray to surface the existing queue, not to build a second one.
 */
const PROBE = `(function () {
  try {
    if (!window.__WAI_WD__) {
      window.__WAI_WD__ = { blocked: 0, interceptionWorking: false, held: 0, since: Date.now() };
      document.addEventListener('onReadConfirmationBlocked', function () { window.__WAI_WD__.blocked++; });
      document.addEventListener('onInterceptionWorking', function () { window.__WAI_WD__.interceptionWorking = true; });
    }
    var wd = window.__WAI_WD__;
    // A bare identifier on purpose: if core/ ever renames it the read must not throw.
    try { wd.held = (typeof exceptionsList !== 'undefined' && exceptionsList && exceptionsList.length) || 0; } catch (e) {}
    var st = (window.__WAI__ && window.__WAI__.state) ? window.__WAI__.state() : null;
    return {
      ok: true, state: st, wd: wd,
      hasWai: !!(window.__WAI__ && window.__WAI__.state),
      url: location.href, readyState: document.readyState
    };
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) };
  }
})()`;

/**
 * @param {object} opts
 * @param {object} opts.webContents         Electron WebContents (only `.executeJavaScript`
 *                                          and `.reload()` are used)
 * @param {number} [opts.pollMs]
 * @param {number} [opts.socketClosedMs]     closed-socket threshold before RECONNECTING
 * @param {number} [opts.navGraceMs]         how long a navigation may go uninjected
 * @param {number} [opts.settleMs]           how long a still-parsing document is given
 * @param {(s: object) => void} [opts.onStatus]   every poll; `changed` flags transitions
 * @param {(i: object) => void} [opts.onRecover]
 * @param {(reason: string) => string} [opts.rearm]  cheap fix; returns what it did
 * @param {() => boolean} [opts.reload]            escalation
 * @param {(msg: string) => void} [opts.debug]
 * @param {() => number} [opts.now]                injectable clock, for tests
 */
function createWatchdog(opts) {
  if (!opts || !opts.webContents) throw new Error('createWatchdog: webContents is required');
  const webContents = opts.webContents;

  const pollMs = opts.pollMs || DEFAULT_POLL_MS;
  const socketClosedMs = opts.socketClosedMs || DEFAULT_SOCKET_CLOSED_MS;
  const repollMs = opts.repollMs || DEFAULT_REPOLL_MS;
  const recoverGraceMs = opts.recoverGraceMs || DEFAULT_RECOVER_GRACE_MS;
  const navGraceMs = opts.navGraceMs || DEFAULT_NAV_GRACE_MS;
  const settleMs = opts.settleMs || DEFAULT_SETTLE_MS;
  const kickProbeMs = opts.kickProbeMs || DEFAULT_KICK_PROBE_MS;
  const onStatus = opts.onStatus || (() => {});
  const onRecover = opts.onRecover || (() => {});
  const rearm = opts.rearm || (() => 'preload-sequence');
  const doReload = opts.reload || (() => { webContents.reload(); return true; });
  const now = opts.now || (() => Date.now());
  const debug = opts.debug || (() => {});

  const s = {
    timer: null,
    started: false,
    destroyed: false,
    polling: false,

    status: STATUS.UNKNOWN,
    reason: 'not polled yet',

    /** Last page generation observed. null until the first successful probe. */
    generation: null,
    /** Set by a main-frame did-start-navigation; cleared by the next injection report. */
    expectingInjection: false,
    lastNavAt: 0,
    firstSeenAt: 0,

    socketClosedSince: 0,

    recovering: false,
    recoverSince: 0,
    escalateAt: 0,
    escalated: true,
    recoveries: 0,
    consecutiveFailures: 0,
    nextRecoveryAt: 0,

    lastFrameAt: 0,
    sinceLastFrame: null,
    injectedAt: 0,
    lastFailure: null,

    /** Cumulative in MAIN, so a page reload (which resets the page's own counters) does
     *  not reset what the tray shows. The number that matters is a session total. */
    totals: { framesIn: 0, framesOut: 0, blocked: 0 },
    /** Previous poll's raw page counters, for delta folding. */
    prev: null,
    lastSnapshot: null,
    pollCount: 0,
  };

  // ---------------------------------------------------------------- probing

  function probe() {
    return webContents.executeJavaScript(PROBE).then(
      (r) => (r && typeof r === 'object' ? r : { ok: false, error: 'probe returned nothing' }),
      (e) => ({ ok: false, error: (e && e.message) || String(e) }),
    );
  }

  /**
   * A document that is still parsing was injected microseconds ago. Judging it now would
   * report NOT PROTECTED for a perfectly healthy reload and then "recover" by reloading
   * again — a reload storm, which is the worst outcome for the user. So a fresh document
   * gets a grace window and a fast re-poll instead of a verdict.
   */
  function isSettling(answer) {
    if (!answer || !answer.ok || !s.lastNavAt) return false;
    if (answer.readyState !== 'loading') return false;
    return now() - s.lastNavAt < settleMs;
  }

  // ---------------------------------------------------------------- classification

  /** @returns {{status: string, reason: string}} */
  function classify(answer) {
    // (a) Nothing came back at all: the page did not answer.
    if (!answer || !answer.ok) {
      return { status: STATUS.NOT_PROTECTED, reason: `no-page-state: ${(answer && answer.error) || 'no answer'}` };
    }

    // (b) No window.__WAI__. This is the WhatsApp hard-reload case: the document was
    //     replaced and the injected context went with it.
    if (!answer.hasWai || !answer.state) {
      return { status: STATUS.NOT_PROTECTED, reason: 'shim missing (document replaced, or injection lost)' };
    }

    const st = answer.state;
    if (st.error) return { status: STATUS.NOT_PROTECTED, reason: `page error: ${st.error}` };

    // (c) arm() never ran.
    if (!st.generation) return { status: STATUS.NOT_PROTECTED, reason: 'hook never armed' };

    // (d) arm() ran but wsHook.before/after are missing or unwrapped. Precisely the §2.3
    //     silent no-op, and the case nothing else can catch.
    if (!st.hookAlive) return { status: STATUS.NOT_PROTECTED, reason: 'wsHook is not wrapped' };

    // (e) The page's generation went backwards: a new document with its own counter, so
    //     the hook previously observed is provably gone even though this one looks armed.
    if (s.generation !== null && st.generation < s.generation) {
      return { status: STATUS.NOT_PROTECTED, reason: `page reloaded (generation ${s.generation} → ${st.generation})` };
    }

    // (f) A main-frame navigation happened and no injection followed it. Only after the
    //     grace window: the preload injects at document_start, so anything longer than
    //     this is a real miss rather than a race with our own poll.
    if (s.expectingInjection && st.generation === s.generation && now() - s.lastNavAt > navGraceMs) {
      return { status: STATUS.NOT_PROTECTED, reason: 'navigation produced no injection' };
    }

    // (g) A socket closed for too long. WhatsApp's own reconnect is native and intact
    //     (ws_hook returns the real socket), so this is RECONNECTING rather than
    //     NOT_PROTECTED — but receipts are NOT being blocked while it lasts, and the
    //     status has to say so rather than look reassuring.
    if (st.socketState === 3) {
      if (!s.socketClosedSince) s.socketClosedSince = s.lastFrameAt || now();
      if (now() - s.socketClosedSince > socketClosedMs) {
        return { status: STATUS.RECONNECTING, reason: 'socket closed' };
      }
    } else {
      s.socketClosedSince = 0;
    }

    // No socket has ever been observed: fine for the first minute of a session, then it
    // means the hook is not seeing WhatsApp's socket at all.
    if (st.socketState === -1) {
      if (!s.firstSeenAt) s.firstSeenAt = now();
      if (now() - s.firstSeenAt > 90000) return { status: STATUS.RECONNECTING, reason: 'no socket observed' };
    }

    return { status: STATUS.PROTECTED, reason: 'hook armed' };
  }

  // ---------------------------------------------------------------- snapshot

  function buildSnapshot(answer, verdict) {
    const st = (answer && answer.state) || {};
    const wd = (answer && answer.wd) || {};

    // Fold the page's counters into the session totals. A page reload resets the page's
    // numbers; the tray's numbers must not jump backwards when it does. The first sample
    // after a document is replaced is a baseline, not a delta, so it is adopted whole.
    if (typeof st.framesIn === 'number') {
      const d = s.prev && typeof s.prev.framesIn === 'number' ? st.framesIn - s.prev.framesIn : st.framesIn;
      if (d > 0) s.totals.framesIn += d;
    }
    if (typeof st.framesOut === 'number') {
      const d = s.prev && typeof s.prev.framesOut === 'number' ? st.framesOut - s.prev.framesOut : st.framesOut;
      if (d > 0) s.totals.framesOut += d;
    }
    if (typeof wd.blocked === 'number') {
      const d = s.prev && typeof s.prev.blocked === 'number' ? wd.blocked - s.prev.blocked : wd.blocked;
      if (d > 0) s.totals.blocked += d;
    }
    if (st.lastFrameAt) {
      s.lastFrameAt = st.lastFrameAt;
      s.sinceLastFrame = Math.max(0, now() - st.lastFrameAt);
    }

    const changed = verdict.status !== s.status;
    s.status = verdict.status;
    s.reason = verdict.reason;
    if (verdict.status === STATUS.PROTECTED) s.consecutiveFailures = 0;

    const snapshot = {
      status: s.status,
      reason: verdict.reason,
      changed,
      generation: typeof st.generation === 'number' ? st.generation : 0,
      hookAlive: !!st.hookAlive,
      socketState: typeof st.socketState === 'number' ? st.socketState : -1,
      framesIn: s.totals.framesIn,
      framesOut: s.totals.framesOut,
      blocked: s.totals.blocked,
      heldChats: wd.held || 0,
      interceptionWorking: !!wd.interceptionWorking,
      lastFrameAt: s.lastFrameAt,
      sinceLastFrame: s.sinceLastFrame,
      prefsEcho: typeof st.prefsEcho === 'number' ? st.prefsEcho : 0,
      injectedAt: s.injectedAt || null,
      recovering: s.recovering,
      recoveries: s.recoveries,
      lastFailure: s.lastFailure,
      error: answer && answer.ok ? null : ((answer && answer.error) || 'no answer'),
      at: now(),
    };
    s.lastSnapshot = snapshot;
    return snapshot;
  }

  // ---------------------------------------------------------------- recovery

  /**
   * Never fail silently, and never reload in a loop. The first recovery is immediate so
   * §10 smoke step 11 sees a re-arm inside one poll interval; after that the delay
   * doubles to a five-minute ceiling, because a reload storm against WhatsApp is worse
   * than an honest NOT PROTECTED label sitting in the tray.
   */
  function recover(verdict) {
    const t = now();
    if (s.recovering && t - s.recoverSince < recoverGraceMs) return 'grace';
    if (t < s.nextRecoveryAt) return 'backoff';

    s.consecutiveFailures += 1;
    s.recoveries += 1;
    s.recovering = true;
    s.recoverSince = t;
    const backoff = s.consecutiveFailures <= 1
      ? 0
      : Math.min(recoverGraceMs * Math.pow(2, s.consecutiveFailures - 2), MAX_RECOVERY_BACKOFF_MS);
    s.nextRecoveryAt = t + backoff;

    let method;
    try { method = String(rearm(verdict.reason) || 'preload-sequence'); } catch (e) { method = `rearm-threw: ${(e && e.message) || e}`; }

    try { onRecover({ reason: verdict.reason, method, attempt: s.consecutiveFailures }); } catch (e) { /* a handler must not break recovery */ }

    // The cheap fix is to re-run the preload sequence. A document whose ws_hook has
    // already run cannot be repaired that way (re-evaluating it would wrap the patched
    // WebSocket twice), and a replaced document may simply not have finished injecting —
    // so give it a grace period and escalate only if it is still bad.
    s.escalateAt = method === 'gone' ? 0 : t + repollMs;
    s.escalated = false;
    return method;
  }

  function maybeEscalate() {
    if (s.escalated || !s.recovering || now() < s.escalateAt) return;
    s.escalated = true;
    let ok = false;
    try { ok = !!doReload(); } catch (e) { debug(`reload failed: ${(e && e.message) || e}`); }
    debug(`escalated to reload (${ok ? 'ok' : 'failed'})`);
    // The reload will set expectingInjection again from did-start-navigation.
    s.expectingInjection = false;
    s.lastNavAt = 0;
  }

  // ---------------------------------------------------------------- poll loop

  function schedule(delay) {
    if (s.destroyed || !s.started) return;
    clearTimeout(s.timer);
    s.timer = setTimeout(run, Math.max(200, delay));
    // Never hold the process open on the watchdog's account.
    if (s.timer && typeof s.timer.unref === 'function') s.timer.unref();
  }

  function run(force) {
    if (s.destroyed || s.polling) return Promise.resolve(null);
    if (!s.started && !force) return Promise.resolve(null);
    s.polling = true;
    s.pollCount += 1;

    return probe().then((answer) => {
      if (s.destroyed) return null;

      if (isSettling(answer)) {
        debug('document still parsing; re-polling in 1s');
        schedule(1000);
        return null;
      }

      // A document with no shim in it is a document whose counters are gone. Drop the
      // baseline so the next good sample is read as a fresh baseline rather than as a
      // delta against numbers that belonged to a page which no longer exists.
      if (!answer || !answer.ok || !answer.hasWai) s.prev = null;

      const verdict = classify(answer);
      const snapshot = buildSnapshot(answer, verdict);

      s.prev = {
        framesIn: (answer && answer.state && answer.state.framesIn) || 0,
        framesOut: (answer && answer.state && answer.state.framesOut) || 0,
        blocked: (answer && answer.wd && answer.wd.blocked) || 0,
      };
      if (answer && answer.state && typeof answer.state.generation === 'number') {
        s.generation = answer.state.generation;
      }
      if (answer && answer.state && answer.state.hookAlive) s.expectingInjection = false;

      if (verdict.status === STATUS.NOT_PROTECTED) {
        recover(verdict);
        maybeEscalate();
      } else {
        s.recovering = false;
        s.escalated = true;
      }

      try { onStatus(snapshot); } catch (e) { debug(`onStatus threw: ${(e && e.message) || e}`); }

      // Re-poll fast while anything is wrong, so a recovery is noticed quickly.
      schedule(verdict.status === STATUS.PROTECTED ? pollMs : repollMs);
      return snapshot;
    }, (e) => {
      debug(`poll failed: ${(e && e.message) || e}`);
      schedule(repollMs);
      return null;
    }).then(
      (r) => { s.polling = false; return r; },
      (e) => { s.polling = false; throw e; },
    );
  }

  return {
    STATUS,

    start() {
      if (s.started || s.destroyed) return this;
      s.started = true;
      debug(`watchdog: polling every ${pollMs}ms`);
      run();
      return this;
    },

    stop() {
      s.started = false;
      clearTimeout(s.timer);
      s.timer = null;
      return this;
    },

    /**
     * Poll immediately. Wired to the webContents navigation events: a WhatsApp hard
     * reload is exactly the event that destroys the hook, and waiting a full interval to
     * notice is a full interval of possible receipt leaks.
     *
     * @param {string} reason
     * @param {{expectInjection?: boolean}} [options] set for a NEW main-frame document
     *        only. did-navigate / dom-ready / in-page navigations must not set it: the
     *        preload has already reported `booted` and `hook-armed` by then, and
     *        re-arming the flag would make rule (f) fire against a healthy page.
     */
    kick(reason, options) {
      if (!s.started || s.destroyed) return;
      const expect = !!(options && options.expectInjection);
      if (expect) {
        s.expectingInjection = true;
        s.lastNavAt = now();
        s.socketClosedSince = 0;
        s.firstSeenAt = 0;
      }
      debug(`kick: ${reason}${expect ? ' (expect injection)' : ''}`);
      schedule(expect ? kickProbeMs : 250);
    },

    /** A snapshot from the preload (wai:page-state). Liveness evidence without a poll. */
    ingest(snapshot) {
      if (!snapshot || typeof snapshot !== 'object') return;
      if (snapshot.injectedAt) s.injectedAt = snapshot.injectedAt;
      if (snapshot.event === 'booted' || snapshot.event === 'hook-armed' || snapshot.event === 'ui-loaded') {
        // The injection the navigation was waiting for has arrived.
        s.expectingInjection = false;
        if (snapshot.event === 'hook-armed' && typeof snapshot.generation === 'number') {
          s.generation = snapshot.generation;
        }
        s.lastFailure = null;
        return;
      }
      if (snapshot.state) {
        const st = snapshot.state;
        if (typeof st.generation === 'number') s.generation = st.generation;
        if (st.hookAlive) s.expectingInjection = false;
        if (st.lastFrameAt) s.lastFrameAt = st.lastFrameAt;
      }
    },

    /** The page raised its own failure banner; show it until a poll proves otherwise. */
    noteFailure(reason, detail) {
      s.consecutiveFailures += 1;
      s.lastFailure = { reason, detail, at: now() };
      if (s.status === STATUS.NOT_PROTECTED) return;
      s.status = STATUS.NOT_PROTECTED;
      s.reason = `page reported: ${reason}`;
      try { onStatus(this.snapshot()); } catch (e) { /* ignore */ }
    },

    /** Everything the tray and `wai:get-state` need. */
    snapshot() {
      // The live fields are overlaid on the last poll so a state change that happened
      // between polls (a page-reported failure, a recovery) is visible immediately
      // rather than at the next poll.
      if (s.lastSnapshot) {
        return {
          ...s.lastSnapshot,
          changed: false,
          status: s.status,
          reason: s.reason,
          recovering: s.recovering,
          recoveries: s.recoveries,
          lastFailure: s.lastFailure,
          at: now(),
        };
      }
      return {
        status: s.status,
        reason: s.reason,
        changed: false,
        generation: s.generation == null ? 0 : s.generation,
        hookAlive: false,
        socketState: -1,
        framesIn: s.totals.framesIn,
        framesOut: s.totals.framesOut,
        blocked: s.totals.blocked,
        heldChats: 0,
        lastFrameAt: 0,
        sinceLastFrame: null,
        prefsEcho: 0,
        injectedAt: s.injectedAt || null,
        recovering: s.recovering,
        recoveries: s.recoveries,
        polls: s.pollCount,
        lastFailure: s.lastFailure,
        at: now(),
      };
    },

    /** For tests and for the smoke test: force one poll, even before start(). */
    pollNow() { return run(true); },

    destroy() {
      s.destroyed = true;
      this.stop();
    },

    // Exposed for assertions without reaching through the public surface.
    _internals: s,
  };
}

module.exports = {
  createWatchdog,
  STATUS,
  PROBE,
  DEFAULT_POLL_MS,
  DEFAULT_SOCKET_CLOSED_MS,
  DEFAULT_NAV_GRACE_MS,
};
