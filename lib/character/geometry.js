// lib/character/geometry.js
//
// Where the character stands. Pure arithmetic (no imports), shared by the controller and the tests.
//
// The floor is the BOTTOM EDGE OF THE WORK AREA (the visible desktop: monitor minus panels/docks that reserve space).
// Her feet must touch it, so the bottom inset is 0. The art is cropped to the sole (0-1 px of padding under the shoes, and
// the walk frames are baselined to the same row), so placing the sprite box flush with the floor puts the soles on the floor.
//
// 0.3.0 and earlier applied the 24 px SIDE margin to the bottom as well, which lifted her 24 px (10% of her height at 240 px)
// above the floor; that was the main reason she looked like she was floating.

export const SIDE_MARGIN = 24;     // gap to the left and right edges of the work area
export const FLOOR_INSET = 0;      // gap between the soles and the bottom edge: she stands ON the floor

/**
 * @param {{areaWidth: number, areaHeight: number, charWidth: number, charHeight: number,
 *          sideMargin?: number, floorInset?: number}} p
 * @returns {{minX: number, maxX: number, baseY: number}} baseY = top of the sprite box inside the work area
 */
export function layoutBounds({areaWidth, areaHeight, charWidth, charHeight, sideMargin = SIDE_MARGIN, floorInset = FLOOR_INSET}) {
    return {
        minX: sideMargin,
        maxX: Math.max(sideMargin, areaWidth - charWidth - sideMargin),
        baseY: Math.max(0, areaHeight - charHeight - floorInset),
    };
}
