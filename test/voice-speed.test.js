const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

function setup(rate) {
    const sandbox = loadScripts(createSandbox(), ["core/voice_speed.js"]);
    const played = [];
    const proto = { play() { played.push(this); return "promise"; } };
    const state = { rate };
    sandbox.installVoiceSpeed(proto, () => state.rate);
    const makeElement = (tagName) => {
        const listeners = {};
        const element = Object.create(proto);
        Object.assign(element, {
            tagName, playbackRate: 1,
            addEventListener(name, fn) { listeners[name] = fn; },
            // like the browser: assigning playbackRate fires ratechange later (here: when asked)
            fire(name) { if (listeners[name]) listeners[name](); },
            listenerCount: () => Object.keys(listeners).length,
        });
        return element;
    };
    return { sandbox, proto, played, state, makeElement };
}

test("play on an audio element gets the configured rate, and the original play still runs", () => {
    const t = setup(2);
    const audio = t.makeElement("AUDIO");
    assert.strictEqual(audio.play(), "promise", "the original return value is kept");
    assert.strictEqual(audio.playbackRate, 2);
    assert.strictEqual(t.played.length, 1);
});

test("video elements are not touched", () => {
    const t = setup(2);
    const video = t.makeElement("VIDEO");
    video.play();
    assert.strictEqual(video.playbackRate, 1);
    assert.strictEqual(t.played.length, 1);
});

test("rate 1 leaves the element alone", () => {
    const t = setup(1);
    const audio = t.makeElement("AUDIO");
    audio.playbackRate = 1.5; // WhatsApp's own choice
    audio.play();
    assert.strictEqual(audio.playbackRate, 1.5);
});

test("a rate change that is not ours stops the overriding for that element", () => {
    const t = setup(2);
    const audio = t.makeElement("AUDIO");
    audio.play();
    assert.strictEqual(audio.playbackRate, 2);
    audio.fire("ratechange"); // our own change: ignored
    audio.play();
    assert.strictEqual(audio.playbackRate, 2);

    audio.playbackRate = 1.5; // the user presses WhatsApp's speed button
    audio.fire("ratechange");
    audio.play();
    assert.strictEqual(audio.playbackRate, 1.5, "the user's choice is respected");
    t.state.rate = 3;
    audio.play();
    assert.strictEqual(audio.playbackRate, 1.5, "still not overridden");
});

test("the ratechange listener is installed once per element; other elements are unaffected", () => {
    const t = setup(2);
    const a = t.makeElement("AUDIO");
    const b = t.makeElement("AUDIO");
    a.play(); a.play(); b.play();
    assert.strictEqual(a.listenerCount(), 1);
    a.playbackRate = 1; a.fire("ratechange");
    assert.strictEqual(b.playbackRate, 2);
});

test("the play counter counts audio plays only", () => {
    const t = setup(1);
    t.makeElement("AUDIO").play();
    t.makeElement("AUDIO").play();
    t.makeElement("VIDEO").play();
    assert.strictEqual(t.sandbox.voiceSpeedPlayCount, 2);
});

test("an error while setting the rate never prevents playback", () => {
    const t = setup(2);
    const audio = t.makeElement("AUDIO");
    Object.defineProperty(audio, "playbackRate", { get() { return 1; }, set() { throw new Error("nope"); } });
    assert.strictEqual(audio.play(), "promise");
});
