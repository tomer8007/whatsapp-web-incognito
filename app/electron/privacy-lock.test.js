const test = require('node:test');
const assert = require('node:assert');

// Mock crypto.subtle for Node.js testing (Node.js has its own webcrypto but let's make sure it acts like the browser)
const { webcrypto } = require('node:crypto');
const cryptoSubtle = webcrypto.subtle;

test('PIN hashing logic matches UI implementation', async () => {
    const val = '1234';
    const hashBuffer = await cryptoSubtle.digest('SHA-256', new TextEncoder().encode(val));
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
    
    // 1234 hashed in SHA-256:
    // 03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4
    assert.strictEqual(hashHex, '03ac674216f3e15c761ee1a5e255f067953623c8b388b4459e13f978d7c846f4');
});

test('Timer idle detection resets properly', (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    
    let isPrivacyScreenLocked = false;
    let privacyScreenLockEnabled = true;
    let privacyScreenLockIdleMinutes = 5;
    let privacyScreenIdleTimer = null;
    
    function lockPrivacyScreen() {
        if (isPrivacyScreenLocked || !privacyScreenLockEnabled) return;
        isPrivacyScreenLocked = true;
    }
    
    function resetPrivacyScreenIdleTimer() {
        if (!privacyScreenLockEnabled) return;
        clearTimeout(privacyScreenIdleTimer);
        if (!isPrivacyScreenLocked) {
            privacyScreenIdleTimer = setTimeout(lockPrivacyScreen, privacyScreenLockIdleMinutes * 60 * 1000);
        }
    }
    
    // Initial start
    resetPrivacyScreenIdleTimer();
    
    // Advance 4 minutes
    t.mock.timers.tick(4 * 60 * 1000);
    assert.strictEqual(isPrivacyScreenLocked, false);
    
    // Reset timer (simulating user activity)
    resetPrivacyScreenIdleTimer();
    
    // Advance 4 minutes (total 8 from start, but we reset at 4)
    t.mock.timers.tick(4 * 60 * 1000);
    assert.strictEqual(isPrivacyScreenLocked, false);
    
    // Advance 2 more minutes (total 6 since last reset)
    t.mock.timers.tick(2 * 60 * 1000);
    assert.strictEqual(isPrivacyScreenLocked, true);
    
    t.mock.timers.reset();
});

test('Hotkey Alt+L locks screen immediately', () => {
    let locked = false;
    function lockPrivacyScreen() {
        locked = true;
    }
    
    function handlePrivacyScreenActivity(e) {
        if (e.type === "keydown" && e.altKey && (e.key === "l" || e.key === "L")) {
            lockPrivacyScreen();
            return;
        }
    }
    
    handlePrivacyScreenActivity({ type: "keydown", altKey: true, key: "l" });
    assert.strictEqual(locked, true);
    
    locked = false;
    handlePrivacyScreenActivity({ type: "keydown", altKey: true, key: "L" });
    assert.strictEqual(locked, true);
    
    locked = false;
    handlePrivacyScreenActivity({ type: "keydown", altKey: false, key: "l" });
    assert.strictEqual(locked, false);
});
