const test = require("node:test");
const assert = require("node:assert");
const { createSandbox, loadScripts } = require("./helpers/sandbox");

const load = () => loadScripts(createSandbox(), ["core/placement.js"]);
const rect = (left, top, width, height) => ({ left, top, width, height, right: left + width, bottom: top + height });
const view = { width: 1600, height: 900 };
const plain = (o) => ({ ...o });

test("popover to the right of a menu item, centered on it, nub at the item's center", () => {
    const { placePopover } = load();
    const p = placePopover(rect(500, 600, 200, 40), { width: 240, height: 120 }, view, "right", { gap: 10 });
    assert.deepStrictEqual(plain(p), { left: 710, top: 560, side: "right", arrow: 60 });
});

test("it flips to the left when the right side has no room, and clamps inside the viewport", () => {
    const { placePopover } = load();
    const flipped = placePopover(rect(1500, 300, 80, 40), { width: 240, height: 120 }, view, "right");
    assert.strictEqual(flipped.side, "left");
    assert.strictEqual(flipped.left, 1500 - 10 - 240);
    const tight = placePopover(rect(100, 300, 1400, 40), { width: 240, height: 120 }, view, "right");
    assert.ok(tight.left >= 8 && tight.left + 240 <= 1600 - 8);
    const lowAnchor = placePopover(rect(500, 880, 100, 40), { width: 240, height: 120 }, view, "right");
    assert.ok(lowAnchor.top + 120 <= 900 - 8, "kept above the viewport bottom");
    assert.ok(lowAnchor.arrow >= 14 && lowAnchor.arrow <= 106, "the nub stays on the popover's edge");
});

test("above a button (composer): never below it when there is room, flips below at the top edge", () => {
    const { placePopover } = load();
    const above = placePopover(rect(1700 - 200, 1000 - 100, 40, 40), { width: 240, height: 100 }, { width: 1800, height: 1100 }, "above");
    assert.strictEqual(above.side, "above");
    assert.ok(above.top + 100 <= 900 - 10 + 1);
    const flipped = placePopover(rect(300, 20, 40, 40), { width: 240, height: 100 }, view, "above");
    assert.strictEqual(flipped.side, "below");
    assert.strictEqual(flipped.top, 70);
    const edge = placePopover(rect(1590, 700, 10, 40), { width: 240, height: 100 }, view, "above");
    assert.strictEqual(edge.left + 240, 1600 - 8, "clamped horizontally");
});

test("a menu with a third item grows by the missing height and is moved up when it would leave the screen", () => {
    const { menuFit } = load();
    assert.deepStrictEqual(plain(menuFit({ bottom: 630 }, 670, 961, 8)), { growBy: 40, shiftUp: 0 });
    assert.deepStrictEqual(plain(menuFit({ bottom: 630 }, 630, 961, 8)), { growBy: 0, shiftUp: 0 });
    assert.deepStrictEqual(plain(menuFit({ bottom: 930 }, 970, 961, 8)), { growBy: 40, shiftUp: 17 });
});
