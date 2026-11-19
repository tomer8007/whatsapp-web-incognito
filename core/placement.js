//
// Placement helpers (isolated world, pure): where a small popover goes next to an element, and how much a clipped menu has to grow.
// Rects are {left, top, right, bottom, width, height} (DOMRect-like). Unit-tested.
//

function clampNumber(value, low, high)
{
    if (high < low) return low;
    return Math.max(low, Math.min(high, value));
}

// -> {left, top, side, arrow}. prefer: "right" | "left" | "above" | "below". The popover flips to the opposite side when it does not fit,
// is clamped inside the viewport, and `arrow` is the offset (along the popover edge) of the point that faces the anchor's center.
function placePopover(anchor, size, viewport, prefer, options)
{
    var gap = options && options.gap != null ? options.gap : 10;
    var margin = options && options.margin != null ? options.margin : 8;
    var nub = 14;
    var side = prefer || "right";
    var centerX = anchor.left + anchor.width / 2;
    var centerY = anchor.top + anchor.height / 2;

    if (side == "left" || side == "right")
    {
        var toRight = anchor.right + gap;
        var toLeft = anchor.left - gap - size.width;
        var fitsRight = toRight + size.width <= viewport.width - margin;
        var fitsLeft = toLeft >= margin;
        var left;
        if (side == "right") { if (fitsRight) left = toRight; else if (fitsLeft) { left = toLeft; side = "left"; } else left = toRight; }
        else { if (fitsLeft) left = toLeft; else if (fitsRight) { left = toRight; side = "right"; } else left = toLeft; }
        left = clampNumber(left, margin, viewport.width - size.width - margin);
        var top = clampNumber(centerY - size.height / 2, margin, viewport.height - size.height - margin);
        return { left: left, top: top, side: side, arrow: clampNumber(centerY - top, nub, size.height - nub) };
    }

    var above = anchor.top - gap - size.height;
    var below = anchor.bottom + gap;
    var fitsAbove = above >= margin;
    var fitsBelow = below + size.height <= viewport.height - margin;
    var topValue;
    if (side == "above") { if (fitsAbove) topValue = above; else if (fitsBelow) { topValue = below; side = "below"; } else topValue = above; }
    else { if (fitsBelow) topValue = below; else if (fitsAbove) { topValue = above; side = "above"; } else topValue = below; }
    topValue = clampNumber(topValue, margin, viewport.height - size.height - margin);
    var leftValue = clampNumber(centerX - size.width / 2, margin, viewport.width - size.width - margin);
    return { left: leftValue, top: topValue, side: side, arrow: clampNumber(centerX - leftValue, nub, size.width - nub) };
}

// A menu (rect) whose content now reaches `contentBottom`: how much to grow it, and how far to move it up so it stays on screen.
function menuFit(menuRect, contentBottom, viewportHeight, margin)
{
    var edge = margin != null ? margin : 8;
    var bottom = Math.max(menuRect.bottom, contentBottom);
    return {
        growBy: Math.max(0, contentBottom - menuRect.bottom),
        shiftUp: Math.max(0, bottom - (viewportHeight - edge)),
    };
}
