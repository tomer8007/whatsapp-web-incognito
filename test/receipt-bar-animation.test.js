const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function load(extra = {}) {
    const sandbox = createSandbox();
    Object.assign(sandbox, { setTimeout: (fn) => { sandbox.__timers.push(fn); return 1; }, __timers: [] }, extra);
    return loadScripts(sandbox, ["core/utils.js"]);
}
const bar = () => ({ animated: [], removed: false, style: {}, clientHeight: 20, animate(frames) { this.animated.push(frames); }, remove() { this.removed = true; } });

test("with Velocity: the original animations run (in, out) and the bar is removed after the animation", () => {
    const calls = [];
    const s = load({ Velocity: (el, props) => calls.push(props) });
    const el = bar();
    assert.strictEqual(s.animateBarIn(el), "velocity");
    assert.strictEqual(s.animateBarOutAndRemove(el, 300), "velocity");
    assert.deepStrictEqual(JSON.parse(JSON.stringify(calls[0])), { scaleY: [1, 0], opacity: [1, 0] });
    assert.strictEqual(el.removed, false);
    s.__timers.forEach((fn) => fn());
    assert.strictEqual(el.removed, true);
});

test("without Velocity (or when it throws): the Web Animations fallback runs and the bar is still removed", () => {
    for (const extra of [{}, { Velocity: () => { throw new Error("boom"); } }]) {
        const s = load(extra);
        const el = bar();
        assert.strictEqual(s.animateBarIn(el), "waapi");
        assert.strictEqual(s.animateBarOutAndRemove(el, 300), "waapi");
        assert.strictEqual(el.animated.length, 2);
        s.__timers.forEach((fn) => fn());
        assert.strictEqual(el.removed, true);
    }
});

test("the bar is removed even when no animation can run at all", () => {
    const s = load();
    const el = { remove() { this.removed = true; }, style: {}, clientHeight: 0 };
    assert.strictEqual(s.animateBarOutAndRemove(el, 300), null);
    s.__timers.forEach((fn) => fn());
    assert.strictEqual(el.removed, true);
});
