'use strict';

const test = require('node:test');
const assert = require('node:assert');

const WAIPageBus = require('../../shared/wai_page_bus.js');

function installMockDom() {
  const origDocument = global.document;
  const origCustomEvent = global.CustomEvent;
  const origMutationObserver = global.MutationObserver;

  const docListeners = new Map();
  const observerInstances = [];

  class MockCustomEvent {
    constructor(type, init) {
      this.type = type;
      this.detail = init && Object.prototype.hasOwnProperty.call(init, 'detail') ? init.detail : undefined;
    }
  }

  class MockMutationObserver {
    constructor(cb) {
      this.callback = cb;
      this.observed = [];
      this.disconnected = false;
      observerInstances.push(this);
    }
    observe(target, options) {
      this.observed.push({ target, options });
      this.disconnected = false;
    }
    disconnect() {
      this.disconnected = true;
    }
    trigger(mutations) {
      this.callback(mutations, this);
    }
  }

  const mockDoc = {
    body: { nodeName: 'BODY' },
    readyState: 'complete',
    addEventListener(type, fn) {
      if (!docListeners.has(type)) docListeners.set(type, new Set());
      docListeners.get(type).add(fn);
    },
    removeEventListener(type, fn) {
      const set = docListeners.get(type);
      if (set) {
        set.delete(fn);
        if (set.size === 0) docListeners.delete(type);
      }
    },
    dispatchEvent(ev) {
      const set = docListeners.get(ev.type);
      if (!set) return true;
      for (const fn of [...set]) fn(ev);
      return true;
    },
  };

  global.document = mockDoc;
  global.CustomEvent = MockCustomEvent;
  global.MutationObserver = MockMutationObserver;

  return {
    doc: mockDoc,
    docListeners,
    observerInstances,
    restore() {
      WAIPageBus.DOMObserver.disconnect();
      global.document = origDocument;
      global.CustomEvent = origCustomEvent;
      global.MutationObserver = origMutationObserver;
    },
  };
}

test('WAIPageBus routes sendToPage / onPageMessage with JSON isolation and unsubscribe cleanup', () => {
  const env = installMockDom();
  try {
    const received = [];
    const other = [];
    const unsub1 = WAIPageBus.onPageMessage('receipt:send', (payload) => received.push(payload));
    const unsub2 = WAIPageBus.onPageMessage('ui:paneChatOpened', (payload) => other.push(payload));

    assert.strictEqual(WAIPageBus.sendToPage('receipt:send', { jid: '123@c.us', unreadCount: 2 }), true);
    assert.deepStrictEqual(received, [{ jid: '123@c.us', unreadCount: 2 }]);
    assert.deepStrictEqual(other, []);

    // Malformed bridge payloads are silently ignored
    env.doc.dispatchEvent(new global.CustomEvent(WAIPageBus.TO_PAGE_EVENT, { detail: '{not-json' }));
    assert.strictEqual(received.length, 1);

    unsub1();
    WAIPageBus.sendToPage('receipt:send', { jid: '456@c.us' });
    assert.strictEqual(received.length, 1);

    // Bridge listener detaches when all subscribers unsubscribe
    unsub2();
    assert.strictEqual(env.docListeners.has(WAIPageBus.TO_PAGE_EVENT), false);
  } finally {
    env.restore();
  }
});

test('WAIPageBus routes sendToHost / onHostMessage and emit / onJson compat helpers', () => {
  const env = installMockDom();
  try {
    const hostMsgs = [];
    const optUpdates = [];
    const blocked = [];

    const unsubHost = WAIPageBus.onHostMessage('ephemeral:export', (payload) => hostMsgs.push(payload));
    const unsubOpt = WAIPageBus.onJson('onOptionsUpdate', (opts) => optUpdates.push(opts));
    const blockListener = (e) => blocked.push(e.detail);
    env.doc.addEventListener('onReadConfirmationBlocked', blockListener);

    WAIPageBus.sendToHost('ephemeral:export', { contactJid: '123@c.us', messages: [{ text: 'hi' }] });
    WAIPageBus.emit('onOptionsUpdate', { readConfirmationsHook: false });
    WAIPageBus.emit('onReadConfirmationBlocked', '123@c.us');

    assert.deepStrictEqual(hostMsgs, [{ contactJid: '123@c.us', messages: [{ text: 'hi' }] }]);
    assert.deepStrictEqual(optUpdates, [{ readConfirmationsHook: false }]);
    assert.deepStrictEqual(blocked, ['123@c.us']);

    unsubHost();
    unsubOpt();
    env.doc.removeEventListener('onReadConfirmationBlocked', blockListener);
  } finally {
    env.restore();
  }
});

test('WAIPageBus.DOMObserver merges multiple subscribers into one MutationObserver and disconnects on zero', () => {
  const env = installMockDom();
  try {
    const seenA = [];
    const seenB = [];

    const unsubA = WAIPageBus.DOMObserver.subscribe((m) => seenA.push(m));
    const unsubB = WAIPageBus.DOMObserver.subscribe((m) => seenB.push(m));

    assert.strictEqual(WAIPageBus.DOMObserver.subscriberCount(), 2);
    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), true);
    assert.strictEqual(env.observerInstances.length, 1, 'multiple subscribers must share one MutationObserver');
    assert.strictEqual(env.observerInstances[0].observed[0].target, env.doc.body);
    assert.deepStrictEqual(env.observerInstances[0].observed[0].options, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['src'],
      attributeOldValue: true,
    });

    const batch = [{ type: 'childList', addedNodes: [] }];
    env.observerInstances[0].trigger(batch);
    assert.strictEqual(seenA.length, 1);
    assert.strictEqual(seenB.length, 1);

    unsubA();
    assert.strictEqual(WAIPageBus.DOMObserver.subscriberCount(), 1);
    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), true);

    unsubB();
    assert.strictEqual(WAIPageBus.DOMObserver.subscriberCount(), 0);
    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), false);
    assert.strictEqual(env.observerInstances[0].disconnected, true);
  } finally {
    env.restore();
  }
});

test('WAIPageBus.DOMObserver defers observing until DOMContentLoaded when document.body is null', () => {
  const env = installMockDom();
  try {
    env.doc.body = null;
    env.doc.readyState = 'loading';
    const seen = [];

    const unsub = WAIPageBus.DOMObserver.subscribe((m) => seen.push(m));
    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), false);
    assert.strictEqual(env.observerInstances.length, 0);

    env.doc.body = { nodeName: 'BODY' };
    env.doc.readyState = 'interactive';
    env.doc.dispatchEvent(new global.CustomEvent('DOMContentLoaded'));

    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), true);
    assert.strictEqual(env.observerInstances.length, 1);

    unsub();
    assert.strictEqual(WAIPageBus.DOMObserver.isObserving(), false);
  } finally {
    env.restore();
  }
});
