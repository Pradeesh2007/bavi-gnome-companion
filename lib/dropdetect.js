// lib/dropdetect.js
//
// Decides whether an external drag ended as a DROP ON THE CHARACTER. Pure logic (no imports): the Shell-facing part is lib/dropzone.js.
//
// Why this exists: GNOME Shell 51.1 / mutter 51.1 never deliver a drop to a Shell actor (docs/drag-and-drop-investigation.md).
// What an extension can observe is: a drag began, the pointer is hovering an actor (the Shell calls `handleDragOver`), and the
// drag ended (`drag-end`). A release and an Escape end the drag in the same way, so a drop is INFERRED, and only when ALL hold:
//   * the pointer hovered the character shortly before the drag ended (hover events stop when it leaves; `staleMs` allows for the
//     gap between the last motion event and the release),
//   * at the end the pointer is still over the character,
//   * the primary button is no longer held. If it is still held the drag was cancelled with Escape.
//   * the button state is known (if it cannot be read the answer is "no": better a missed drop than a wrong one).
// One drag produces at most one decision, so a single drag can never be stored twice.

export const HOVER_STALE_MS = 250;

export class DropTracker {
    constructor({staleMs = HOVER_STALE_MS} = {}) {
        this._stale = staleMs;
        this._active = false;
        this._hovering = false;
        this._lastHover = -Infinity;
        this.dragId = 0;
    }

    get active() {
        return this._active;
    }

    get hovering() {
        return this._hovering;
    }

    /** A drag from another application started. Returns its id. */
    begin() {
        this.dragId += 1;
        this._active = true;
        this._hovering = false;
        this._lastHover = -Infinity;
        return this.dragId;
    }

    /** The Shell reported the pointer over the character. `first` is true when this starts a new hover. */
    hover(now) {
        if (!this._active)
            return {first: false};
        const first = !this._hovering;
        this._hovering = true;
        this._lastHover = now;
        return {first};
    }

    /** Call periodically during a drag: true when a hover has ended because the pointer left (no recent hover events). */
    expire(now) {
        if (this._active && this._hovering && now - this._lastHover > this._stale) {
            this._hovering = false;
            return true;
        }
        return false;
    }

    /**
     * The drag ended.
     * @param {{now: number, buttonDown: ?boolean, overTarget?: ?boolean}} state buttonDown: is the primary button still held
     *   (null = unknown); overTarget: is the pointer over the character right now (omit when unknown)
     * @returns {{drop: boolean, reason: string}}
     */
    end({now, buttonDown, overTarget}) {
        if (!this._active)
            return {drop: false, reason: 'no-drag'};
        this._active = false;
        const hovered = this._hovering && now - this._lastHover <= this._stale;
        this._hovering = false;
        if (!hovered || overTarget === false)
            return {drop: false, reason: 'not-over-target'};
        if (buttonDown === true)
            return {drop: false, reason: 'cancelled'};
        if (buttonDown !== false)
            return {drop: false, reason: 'unknown-button-state'};
        return {drop: true, reason: 'released-over-target'};
    }
}
