// lib/character/actor.js
//
// View only: builds and owns the actors and exposes small drawing primitives. No behaviour
// decisions live here; lib/character/controller.js drives it.
//
// Actor structure:
//   root       St.Widget added to Shell chrome (its visibility belongs to the layout manager, which is
//              what trackFullscreen relies on). Covers the primary work area and is not reactive.
//   character  St.Widget child of root: reactive, carries the click gestures, moved with
//              translation_x / translation_y (translations do not trigger relayouts). The user-level
//              hide/show toggles this child, so it never fights the layout manager.
//   poses      four St.Widget children of the character (front, right, left, back), each drawing one
//              PNG through an inline background-image style. All four always exist and are painted;
//              only the current one has opacity 255, so every texture is loaded up front and switching
//              pose never flickers.
//   walk layer (release 0.2.1, only when assets/walk/ loaded) two more St.Widgets for ALL walking frames:
//              walkClip   clips to one frame (clip_to_allocation), mirrored with scale_x = -1 for left-facing walks
//              walkAtlas  child of walkClip drawing the single atlas PNG (assets/walk/walk.png) once; a frame is
//                         selected by moving the atlas with translation_x / translation_y (no restyle, no relayout)
//                         and the per-frame baseline offset `dy` from the manifest is added to translation_y.
//              The layer is transparent except while a walk plays, so the idle poses are untouched.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as debug from '../debug.js';

export const POSES = ['front', 'right', 'left', 'back'];

// All pose images are 480 px tall and 172 to 175 px wide; one aspect ratio is used for all of them.
const ASPECT = 173 / 480;

const MODES = {
    'in': Clutter.AnimationMode.EASE_IN_QUAD,
    'out': Clutter.AnimationMode.EASE_OUT_QUAD,
    'in-out': Clutter.AnimationMode.EASE_IN_OUT_QUAD,
    'linear': Clutter.AnimationMode.LINEAR,
};

let liveActors = 0;

/** Number of CharacterActor instances created and not yet destroyed (for leak checks). */
export function liveActorCount() {
    return liveActors;
}

export class CharacterActor {
    /**
     * @param {object} params
     * @param {import('../environment.js').Environment} params.environment
     * @param {import('../disposer.js').Disposer} params.disposer
     * @param {string} params.assetDir directory containing bavi_front/right/left/back.png
     * @param {?{manifest: object, atlasPath: string}} [params.walk] validated walking assets (see walkassets.js), or null
     * @param {number} params.height character height in logical pixels
     * @param {() => void} params.onClick primary-button click
     * @param {() => void} params.onSecondaryClick secondary-button click
     */
    constructor({environment, disposer, assetDir, height, walk = null, onClick, onSecondaryClick}) {
        this._environment = environment;
        this._destroyed = false;
        this._chromeAdded = false;
        this._gestures = [];
        this._debugId = 0;
        this._pose = null;
        this._width = 0;
        this._height = 0;
        this._walk = walk;
        this._walkClip = null;
        this._walkAtlas = null;
        this._walkUri = null;
        this._walkGeom = null;
        this._walkDirection = 'right';
        this._walkShown = false;

        this._root = new St.Widget({name: 'desktop-companion-root', reactive: false});
        this._root.set_no_layout(true);
        liveActors++;
        // Registered immediately so a failure later in this constructor still cleans up.
        disposer.add(() => this.destroy(), 'destroy character actor');

        this._character = new St.Widget({name: 'desktop-companion-character', reactive: true});
        this._character.set_no_layout(true);
        this._root.add_child(this._character);

        this._uris = {};
        this._poseWidgets = {};
        for (const name of POSES) {
            this._uris[name] = GLib.filename_to_uri(`${assetDir}/bavi_${name}.png`, null);
            const widget = new St.Widget({name: `desktop-companion-pose-${name}`, reactive: false, opacity: 0});
            this._character.add_child(widget);
            this._poseWidgets[name] = widget;
        }
        if (this._walk)
            this._buildWalkLayer(disposer);
        this.setHeight(height);
        this.setPose('right');

        const primary = new Clutter.ClickGesture({required_button: Clutter.BUTTON_PRIMARY});
        const secondary = new Clutter.ClickGesture({required_button: Clutter.BUTTON_SECONDARY});
        for (const gesture of [primary, secondary])
            this._character.add_action(gesture);
        this._gestures = [primary, secondary];
        disposer.connect(primary, 'recognize', () => onClick());
        disposer.connect(secondary, 'recognize', () => onSecondaryClick());

        environment.addChrome(this._root);
        this._chromeAdded = true;
        this._debugId = debug.rootCreated(this._root);
    }

    get width() {
        return this._width;
    }

    get height() {
        return this._height;
    }

    /** The widget a menu should attach to. */
    get sourceActor() {
        return this._character;
    }

    /** Resizes the character and all poses. */
    setHeight(px) {
        this._height = Math.round(px);
        this._width = Math.round(px * ASPECT);
        this._character.set_size(this._width, this._height);
        for (const name of POSES) {
            const widget = this._poseWidgets[name];
            widget.set_size(this._width, this._height);
            widget.set_position(0, 0);
            widget.set_style(`background-image: url("${this._uris[name]}"); ` +
                `background-size: ${this._width}px ${this._height}px;`);
        }
        this._layoutWalk();
    }

    // --- walk layer ----------------------------------------------------------------------------

    get walkReady() {
        return this._walkClip !== null;
    }

    _buildWalkLayer(disposer) {
        this._walkUri = GLib.filename_to_uri(this._walk.atlasPath, null);
        this._walkClip = new St.Widget({name: 'desktop-companion-walk', reactive: false, opacity: 0, clip_to_allocation: true});
        this._walkClip.set_no_layout(true);
        this._walkClip.set_pivot_point(0.5, 0.5);
        this._walkAtlas = new St.Widget({name: 'desktop-companion-walk-atlas', reactive: false});
        this._walkClip.add_child(this._walkAtlas);
        this._character.add_child(this._walkClip);
        // The atlas texture is decoded when the widget is first painted, and a fully transparent actor may not be
        // painted. Showing the layer at 1/255 opacity for half a second makes that happen at start-up instead of
        // as a hitch when the first walk begins (the texture then stays cached by St).
        this._walkClip.set_opacity(1);
        disposer.once(500, () => {
            if (this._walkClip && !this._walkShown)
                this._walkClip.set_opacity(0);
        });
    }

    /** Sizes the layer for the current height: one runtime frame (480 px tall in the art) maps to the character height. */
    _layoutWalk() {
        if (!this._walkClip)
            return;
        const m = this._walk.manifest;
        const s = this._height / m.frame.height;
        const fw = Math.round(m.frame.width * s);
        const aw = Math.round(m.atlas.width * s);
        const ah = Math.round(m.atlas.height * s);
        this._walkGeom = {sx: aw / m.atlas.width, sy: ah / m.atlas.height, fw};
        this._walkClip.set_size(fw, this._height);
        this._walkAtlas.set_size(aw, ah);
        this._walkAtlas.set_position(0, 0);
        this._walkAtlas.set_style(`background-image: url("${this._walkUri}"); background-size: ${aw}px ${ah}px;`);
        this._placeWalkClip();
        if (!this._walkShown)
            this._moveAtlas(m.sequences.start.frames[0]);
    }

    /**
     * Aligns the standing figure inside the frame with the character box (so the first walk frame lands exactly on
     * the idle sprite); mirrored walks use the mirrored figure box.
     */
    _placeWalkClip() {
        const m = this._walk.manifest;
        const g = this._walkGeom;
        const figureWidth = (m.figure.right - m.figure.left) * g.sx;
        const base = (this._width - figureWidth) / 2;
        const left = this._walkDirection === 'left';
        const x = left ? base - (g.fw - m.figure.right * g.sx) : base - m.figure.left * g.sx;
        this._walkClip.set_position(Math.round(x), 0);
        this._walkClip.scale_x = left ? -1 : 1;
    }

    _moveAtlas(frame) {
        const g = this._walkGeom;
        this._walkAtlas.translation_x = -frame.x * g.sx;
        this._walkAtlas.translation_y = (frame.dy - frame.y) * g.sy;
    }

    /** Prepares a walk facing `direction` ('left' mirrors the right-facing art). Nothing is shown until the first frame. */
    beginWalk(direction) {
        if (!this._walkClip)
            return;
        this._walkDirection = direction;
        this._placeWalkClip();
    }

    /** Shows frame `index` of sequence `name` ('start' | 'loop' | 'stop'); hides the idle poses while the walk plays. */
    showWalkFrame(name, index) {
        if (!this._walkClip || this._destroyed)
            return;
        this._moveAtlas(this._walk.manifest.sequences[name].frames[index]);
        if (!this._walkShown) {
            this._walkShown = true;
            for (const pose of POSES)
                this._poseWidgets[pose].set_opacity(0);
            this._walkClip.set_opacity(255);
        }
    }

    /** Hides the walk layer and shows the current idle pose again. Safe when no walk is playing. */
    endWalk() {
        if (!this._walkClip || this._destroyed || !this._walkShown)
            return;
        this._walkShown = false;
        this._walkClip.set_opacity(0);
        this._moveAtlas(this._walk.manifest.sequences.start.frames[0]);
        if (this._pose)
            this.setPose(this._pose);
    }

    /** Current (possibly animated) horizontal translation of the character. */
    getTranslationX() {
        return this._character.translation_x;
    }

    /** Positions the container over the given work area; character coordinates are relative to it. */
    setBounds({x, y, width, height}) {
        this._root.set_position(x, y);
        this._root.set_size(width, height);
    }

    /** Layout position of the character inside the container (translations are applied on top). */
    setPosition(x, y) {
        this._character.set_position(x, y);
    }

    /** Shows one pose and makes the others transparent. */
    setPose(name) {
        for (const pose of POSES)
            this._poseWidgets[pose].set_opacity(pose === name ? 255 : 0);
        this._pose = name;
    }

    easeTranslationX(value, durationMs, mode) {
        this._character.ease({translation_x: value, duration: durationMs, mode: MODES[mode]});
    }

    easeTranslationY(value, durationMs, mode) {
        this._character.ease({translation_y: value, duration: durationMs, mode: MODES[mode]});
    }

    /** Immediate; call after stopAnimations() when snapping to a known pose. */
    setTranslationX(value) {
        this._character.translation_x = value;
    }

    setTranslationY(value) {
        this._character.translation_y = value;
    }

    stopAnimations() {
        this._character.remove_all_transitions();
    }

    /** User-level hide/show of the character itself (the root's visibility belongs to the layout manager). */
    setCharacterVisible(visible) {
        if (visible)
            this._character.show();
        else
            this._character.hide();
    }

    /**
     * Order matters: stop transitions, drop the gestures, leave the Shell chrome, then destroy.
     * Safe to call more than once and safe on a partially constructed instance.
     */
    destroy() {
        if (this._destroyed)
            return;
        this._destroyed = true;

        if (this._character) {
            this._character.remove_all_transitions();
            for (const gesture of this._gestures)
                this._character.remove_action(gesture);
        }
        this._gestures = [];

        if (this._root) {
            this._root.remove_all_transitions();
            if (this._chromeAdded) {
                debug.rootBeforeRemove(this._debugId, this._root);
                this._environment.removeChrome(this._root);
                this._chromeAdded = false;
                debug.rootAfterRemove(this._debugId, this._root);
            }
            this._root.destroy();
            debug.rootDestroyed(this._debugId);
        }
        this._root = null;
        this._character = null;
        this._walkClip = null;
        this._walkAtlas = null;
        this._poseWidgets = {};
        liveActors--;
    }
}
