// lib/character/controller.js
//
// Behaviour of Bavi for release 0.1. No Shell or Clutter imports: it talks to the actor and the
// environment through their small interfaces, and every timer goes through the Disposer.
//
// Poses available (static PNGs): front, right, left, back. There are no walk frames yet, so walking is a
// glide with small hops and a short turn through the front pose.
//
// Behaviour:
//   idle      gentle bob; looks toward the pointer when it is near (front / left / right)
//   roaming   after a dwell at home she turns (via front), glides along the bottom of the work area, dwells,
//             then returns home. Interruptible by a click or a mode change.
//   click     turns to the front and jumps (colour-free: pose change plus hop), then settles
//   summon    walks to the pointer, greets with the same jump, returns home after a while
//   modes     hidden (nothing runs), paused (frozen), quiet (no roaming or bobbing), focus (back to you, still)
//   overview  the character hides while the Overview is visible and everything pauses

const log = (...args) => console.log('[desktop-companion]', ...args);

const MARGIN = 24;
const TICK_MS = 200;
const TICK_SUPPRESSED_MS = 500;
const TURN_MS = 220;
const SPEED_PER_HEIGHT = 0.6;       // px per second per pixel of character height
const MIN_WALK_MS = 900;
const HOP_MS = 300;
const HOP_PX = 6;
const BOB_MS = 1800;
const BOB_PX = 3;
const JUMP_PX = 28;
const JUMP_UP_MS = 160;
const JUMP_DOWN_MS = 240;
const REACTION_HOLD_MS = 450;
const REACTION_STATIC_MS = 700;
const FIRST_ROAM_MS = 6000;
const HOME_DWELL_MS = [20000, 45000];
const AWAY_DWELL_MS = [6000, 14000];
const INTERACTION_DWELL_MS = 12000;
const SETTLE_HOME_MS = 3000;
const ROAM_MAX_FRACTION = 0.55;
const ROAM_MIN_FRACTION = 0.15;
const LOOK_CONFIRM_TICKS = 2;
const LOOK_FRONT_FRACTION = 0.35;
const LOOK_MIN_RADIUS = 600;

export const DEFAULT_CONFIG = {
    hidden: false,
    paused: false,
    quiet: false,
    focus: false,
    roaming: true,
    pointerLook: true,
    height: 240,
    corner: 'bottom-left',
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const randomIn = ([lo, hi]) => lo + Math.random() * (hi - lo);

export class CharacterController {
    /**
     * @param {object} params
     * @param {import('./actor.js').CharacterActor} params.actor
     * @param {import('../environment.js').Environment} params.environment
     * @param {import('../disposer.js').Disposer} params.disposer
     */
    constructor({actor, environment, disposer}) {
        this._actor = actor;
        this._env = environment;
        this._disposer = disposer;

        this._cfg = {...DEFAULT_CONFIG};
        this._started = false;
        this._disposed = false;
        this._suppressed = false;      // Overview visible
        this._phase = 'stopped';       // stopped | halted | paused | idle | turning | walking | reacting
        this._x = 0;                   // current horizontal offset inside the container (translation_x)
        this._facing = 'right';
        this._pose = 'right';
        this._walk = null;             // {from, to, start, durationMs} while gliding
        this._walkAfter = null;        // 'greet' after a summon walk
        this._bobUp = false;
        this._hopUp = false;
        this._firstRoam = true;
        this._lookCandidate = null;
        this._lookCount = 0;

        this._hbTimer = 0;
        this._hbMs = 0;
        this._animTimer = 0;
        this._decideTimer = 0;
        this._turnTimer = 0;
        this._walkTimer = 0;
        this._reactTimer = 0;

        this._area = null;
        this._minX = MARGIN;
        this._maxX = MARGIN;
        this._baseY = 0;

        disposer.add(() => this._dispose(), 'stop character controller');
    }

    // --- public API ----------------------------------------------------------------------------

    start(config) {
        if (this._started || this._disposed)
            return;
        this._started = true;
        this._cfg = {...DEFAULT_CONFIG, ...config};
        this._actor.setHeight(this._cfg.height);
        this._refreshGeometry();
        this._x = this._homeX();
        this._facing = this._homeFacing();
        this._actor.setTranslationX(this._x);
        this._env.watchWorkArea(() => this._onWorkAreaChanged());
        this._suppressed = this._env.overviewVisible();
        this._applyVisibility();
        this._syncHeartbeat();
        this._resume();
        log(`started: height=${this._actor.height} home=${this._cfg.corner} ` +
            `work area ${this._area.width}x${this._area.height} animations=${this._env.animationsEnabled()}`);
    }

    /** Applies a new configuration (from GSettings). */
    configure(config) {
        if (!this._started || this._disposed)
            return;
        const old = this._cfg;
        const next = {...DEFAULT_CONFIG, ...config};
        const changedKeys = Object.keys(next).filter(k => next[k] !== old[k]);
        if (changedKeys.length === 0)
            return;
        log(`config changed: ${changedKeys.map(k => `${k}=${next[k]}`).join(' ')}`);
        this._halt();
        this._cfg = next;
        if (next.height !== old.height) {
            this._actor.setHeight(next.height);
            this._refreshGeometry();
            this._x = clamp(this._x, this._minX, this._maxX);
        }
        if (next.corner !== old.corner) {
            this._refreshGeometry();
            this._x = this._homeX();
            this._facing = this._homeFacing();
        }
        if (changedKeys.includes('hidden') && !next.hidden)
            this._suppressed = this._env.overviewVisible();
        this._actor.setTranslationX(this._x);
        this._applyVisibility();
        this._syncHeartbeat();
        this._resume();
    }

    handleClick() {
        if (!this._active())
            return;
        log('click');
        this._interrupt();
        this._phase = 'reacting';
        this._setPose('front');
        this._react(() => this._afterInteraction());
    }

    /** Walks to the pointer and greets. The caller has already shown and unpaused her. */
    summon() {
        if (!this._active() || this._cfg.paused)
            return;
        const [px] = this._env.getPointer();
        const width = this._actor.width;
        let target = px - this._area.x - width - 24;
        if (target < this._minX)
            target = px - this._area.x + 24;
        target = clamp(target, this._minX, this._maxX);
        log(`summon: walking to ${Math.round(target)}`);
        this._interrupt();
        this._walkTo(target, 'greet');
    }

    returnHome() {
        if (!this._active() || this._cfg.paused)
            return;
        log('returning home');
        this._interrupt();
        this._walkTo(this._homeX(), null);
    }

    // --- state helpers -------------------------------------------------------------------------

    _active() {
        return this._started && !this._disposed && !this._cfg.hidden && !this._suppressed;
    }

    _homeX() {
        return this._cfg.corner === 'bottom-right' ? this._maxX : this._minX;
    }

    _homeFacing() {
        return this._cfg.corner === 'bottom-right' ? 'left' : 'right';
    }

    _atHome() {
        return Math.abs(this._x - this._homeX()) < 3;
    }

    _setPose(name) {
        if (name === this._pose)
            return;
        this._pose = name;
        this._actor.setPose(name);
    }

    _applyVisibility() {
        this._actor.setCharacterVisible(!this._cfg.hidden && !this._suppressed);
    }

    _refreshGeometry() {
        this._area = this._env.getWorkArea();
        const w = this._actor.width;
        const h = this._actor.height;
        this._minX = MARGIN;
        this._maxX = Math.max(MARGIN, this._area.width - w - MARGIN);
        this._baseY = Math.max(0, this._area.height - h - MARGIN);
        this._actor.setBounds(this._area);
        this._actor.setPosition(0, this._baseY);
        this._x = clamp(this._x, this._minX, this._maxX);
    }

    // --- heartbeat (pointer look and Overview watch) ---------------------------------------------

    _syncHeartbeat() {
        const want = this._cfg.hidden ? 0 : (this._suppressed ? TICK_SUPPRESSED_MS : TICK_MS);
        if (want === this._hbMs)
            return;
        if (this._hbTimer) {
            this._disposer.cancel(this._hbTimer);
            this._hbTimer = 0;
        }
        this._hbMs = want;
        if (want)
            this._hbTimer = this._disposer.repeat(want, () => this._tick());
    }

    _tick() {
        if (this._disposed)
            return;
        const overview = this._env.overviewVisible();
        if (overview !== this._suppressed) {
            this._suppressed = overview;
            log(overview ? 'overview shown: hiding' : 'overview hidden: showing');
            this._applyVisibility();
            this._syncHeartbeat();
            this._resume();
            return;
        }
        if (this._phase === 'idle')
            this._updateLook();
    }

    _updateLook() {
        const pose = this._idlePose();
        if (pose === this._pose) {
            this._lookCandidate = null;
            return;
        }
        if (pose !== this._lookCandidate) {
            this._lookCandidate = pose;
            this._lookCount = 1;
            return;
        }
        if (++this._lookCount >= LOOK_CONFIRM_TICKS)
            this._setPose(pose);
    }

    /** The pose she should hold while idle: back in focus mode, otherwise toward the pointer if near, else facing. */
    _idlePose() {
        if (this._cfg.focus)
            return 'back';
        if (!this._cfg.pointerLook)
            return this._facing;
        const [px, py] = this._env.getPointer();
        const w = this._actor.width;
        const h = this._actor.height;
        const cx = this._area.x + this._x + w / 2;
        const cy = this._area.y + this._baseY + h * 0.2;
        const dx = px - cx;
        const dy = py - cy;
        if (Math.hypot(dx, dy) > Math.max(LOOK_MIN_RADIUS, this._area.width * 0.5))
            return this._facing;
        if (Math.abs(dx) < w * LOOK_FRONT_FRACTION)
            return 'front';
        return dx > 0 ? 'right' : 'left';
    }

    // --- activity management -------------------------------------------------------------------

    _cancel(field) {
        if (this[field]) {
            this._disposer.cancel(this[field]);
            this[field] = 0;
        }
    }

    _clearActivity() {
        this._cancel('_animTimer');
        this._cancel('_decideTimer');
        this._cancel('_turnTimer');
        this._cancel('_walkTimer');
        this._cancel('_reactTimer');
    }

    _estimateX() {
        if (!this._walk)
            return this._x;
        const {from, to, start, durationMs} = this._walk;
        const t = clamp((Date.now() - start) / durationMs, 0, 1);
        return from + (to - from) * t;
    }

    /** Stops activity and animation and snaps to the current (estimated) position. */
    _halt() {
        this._clearActivity();
        if (this._walk) {
            this._x = this._estimateX();
            this._walk = null;
        }
        this._walkAfter = null;
        this._actor.stopAnimations();
        this._actor.setTranslationX(this._x);
        this._actor.setTranslationY(0);
        this._phase = 'halted';
    }

    _interrupt() {
        this._halt();
    }

    /** Re-enters the right state after a halt. */
    _resume() {
        this._halt();
        if (!this._active())
            return;
        if (this._cfg.paused) {
            this._setPose(this._idlePose());
            this._phase = 'paused';
            return;
        }
        this._enterIdle(0);
    }

    _afterInteraction() {
        if (this._cfg.paused) {
            this._phase = 'paused';
            this._setPose(this._idlePose());
            return;
        }
        this._enterIdle(INTERACTION_DWELL_MS);
    }

    // --- idle ----------------------------------------------------------------------------------

    _enterIdle(dwellMs) {
        this._clearActivity();
        this._phase = 'idle';
        this._lookCandidate = null;
        this._setPose(this._idlePose());
        if (this._env.animationsEnabled() && !this._cfg.quiet && !this._cfg.focus) {
            this._animTimer = this._disposer.repeat(BOB_MS, () => this._bobTick());
            this._bobTick();
        }
        this._scheduleDecision(dwellMs);
    }

    _bobTick() {
        if (this._phase !== 'idle')
            return;
        this._bobUp = !this._bobUp;
        this._actor.easeTranslationY(this._bobUp ? -BOB_PX : 0, BOB_MS, 'in-out');
    }

    _scheduleDecision(dwellMs) {
        const cfg = this._cfg;
        const away = !this._atHome();
        let wait;
        let kind;
        if (!cfg.roaming || cfg.quiet || cfg.focus) {
            if (!away)
                return;
            wait = SETTLE_HOME_MS;
            kind = 'home';
        } else if (away) {
            wait = dwellMs || randomIn(AWAY_DWELL_MS);
            kind = 'home';
        } else {
            wait = dwellMs || (this._firstRoam ? FIRST_ROAM_MS : randomIn(HOME_DWELL_MS));
            kind = 'roam';
        }
        this._decideTimer = this._disposer.once(wait, () => {
            this._decideTimer = 0;
            this._decide(kind);
        });
    }

    _decide(kind) {
        if (this._phase !== 'idle')
            return;
        if (kind === 'roam') {
            this._firstRoam = false;
            const target = this._pickRoamTarget();
            if (target === null) {
                this._scheduleDecision(0);
                return;
            }
            this._walkTo(target, null);
        } else {
            this._walkTo(this._homeX(), null);
        }
    }

    _pickRoamTarget() {
        const range = this._maxX - this._minX;
        if (range < 100)
            return null;
        const minDistance = range * ROAM_MIN_FRACTION;
        const maxDistance = range * ROAM_MAX_FRACTION;
        const distance = minDistance + Math.random() * (maxDistance - minDistance);
        const home = this._homeX();
        const target = this._cfg.corner === 'bottom-right' ? home - distance : home + distance;
        return clamp(target, this._minX, this._maxX);
    }

    // --- walking -------------------------------------------------------------------------------

    _walkTo(rawTarget, after) {
        if (!this._active() || this._cfg.paused)
            return;
        this._clearActivity();
        const target = clamp(rawTarget, this._minX, this._maxX);
        this._walkAfter = after;
        if (Math.abs(target - this._x) < 4) {
            this._finishWalk();
            return;
        }
        const direction = target > this._x ? 'right' : 'left';
        this._phase = 'turning';
        if (this._pose !== direction) {
            this._facing = direction;
            this._setPose('front');
            this._turnTimer = this._disposer.once(TURN_MS, () => {
                this._turnTimer = 0;
                this._beginWalk(target, direction);
            });
        } else {
            this._facing = direction;
            this._beginWalk(target, direction);
        }
    }

    _beginWalk(target, direction) {
        if (!this._active() || this._cfg.paused || this._phase !== 'turning')
            return;
        this._phase = 'walking';
        this._setPose(direction);
        const distance = Math.abs(target - this._x);
        const durationMs = Math.max(MIN_WALK_MS, (distance / (SPEED_PER_HEIGHT * this._actor.height)) * 1000);
        log(`walking ${Math.round(this._x)} -> ${Math.round(target)} (${Math.round(durationMs)} ms)`);
        if (!this._env.animationsEnabled()) {
            this._x = target;
            this._actor.setTranslationX(target);
            this._finishWalk();
            return;
        }
        this._walk = {from: this._x, to: target, start: Date.now(), durationMs};
        this._actor.easeTranslationX(target, durationMs, 'linear');
        this._animTimer = this._disposer.repeat(HOP_MS, () => this._hopTick());
        this._hopTick();
        this._walkTimer = this._disposer.once(durationMs, () => {
            this._walkTimer = 0;
            this._arrive();
        });
    }

    _hopTick() {
        if (this._phase !== 'walking')
            return;
        this._hopUp = !this._hopUp;
        this._actor.easeTranslationY(this._hopUp ? -HOP_PX : 0, HOP_MS / 2, 'out');
    }

    _arrive() {
        if (this._walk)
            this._x = this._walk.to;
        this._walk = null;
        this._clearActivity();
        this._actor.stopAnimations();
        this._actor.setTranslationX(this._x);
        this._actor.setTranslationY(0);
        log(`arrived at ${Math.round(this._x)}`);
        this._finishWalk();
    }

    _finishWalk() {
        const after = this._walkAfter;
        this._walkAfter = null;
        if (after === 'greet') {
            this._phase = 'reacting';
            this._setPose('front');
            this._react(() => this._afterInteraction());
        } else {
            this._enterIdle(0);
        }
    }

    // --- reaction ------------------------------------------------------------------------------

    _react(done) {
        if (this._env.animationsEnabled()) {
            this._actor.easeTranslationY(-JUMP_PX, JUMP_UP_MS, 'out');
            this._reactTimer = this._disposer.once(JUMP_UP_MS, () => {
                this._actor.easeTranslationY(0, JUMP_DOWN_MS, 'in');
                this._reactTimer = this._disposer.once(JUMP_DOWN_MS + REACTION_HOLD_MS, () => {
                    this._reactTimer = 0;
                    done();
                });
            });
        } else {
            this._reactTimer = this._disposer.once(REACTION_STATIC_MS, () => {
                this._reactTimer = 0;
                done();
            });
        }
    }

    // --- layout changes ------------------------------------------------------------------------

    _onWorkAreaChanged() {
        if (!this._started || this._disposed)
            return;
        const wasHome = this._atHome();
        this._halt();
        this._refreshGeometry();
        if (wasHome)
            this._x = this._homeX();
        this._actor.setTranslationX(this._x);
        log(`work area changed to ${this._area.width}x${this._area.height}`);
        this._resume();
    }

    _dispose() {
        this._disposed = true;
        this._cancel('_hbTimer');
        this._clearActivity();
        this._actor.stopAnimations();
        this._phase = 'stopped';
    }
}
