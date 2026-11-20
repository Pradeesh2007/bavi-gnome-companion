# Planned hybrid animation architecture (design only)

> **Status: plan, not implementation.** Nothing in this document is in the current code except where a row says "exists today". It records the direction
> confirmed by the project owner so future work stays consistent. No dates or guarantees.

## 1. Confirmed decisions
| Topic | Decision |
|---|---|
| Idle movement | **Subtle**: gentle breathing, natural blinking, very small head movements. No exaggerated bouncing, nothing distracting. |
| Hair | **Separate sections**: the long layered navy hair is eventually split into independently animated sections with subtle secondary motion and small timing differences. Existing hairstyle, silhouette and proportions are preserved. |
| Skeletal animation | **Later.** First stabilise PNG animation and procedural effects; prepare layered artwork; introduce reusable skeletal movement only when the foundation is reliable. |
| Engine | Native GNOME/GJS (St, Clutter) unless a later technical evaluation justifies something else. |

## 2. The four techniques and who does what
1. **PNG frame-by-frame** remains responsible for complex hand-drawn actions (walking today; later sitting, stretching, waving, sneezing, ...).
2. **Separate character parts**: head, eyes, mouth, hair sections, body, backpack, arms and legs as independent layers composed by the renderer.
3. **Procedural effects**: small, cheap, code-driven motion layered on top (breathing, blinking, tiny head motion, hair sway).
4. **Skeletal animation (later)**: reusable arm, hand and leg movements driven by a rig, for motions that should not need a new drawn sequence each time.

## 3. Responsibilities
| Component | Responsibility | State today |
|---|---|---|
| **Character State Controller** | The character's state machine: idle, walking, reacting, sleeping, and future states. Decides *what* she is doing. | exists today, mixed into `lib/character/controller.js` (phases `idle/turning/walking/reacting/halted`) |
| **Animation Coordinator** | The single owner of animation priorities, transitions, timing and cancellation. Grants and revokes animation "channels" (below). | **missing**: logic is spread over the controller, `WalkAnimator` and timers |
| **Movement Controller** | Owns the desktop position: horizontal movement, root motion, ground contact, work-area clamping. | partly exists: root motion and planning in `controller.js` + `walk.js`, floor in `geometry.js` |
| **Character Renderer** | Composes the layers on screen and applies transforms; knows nothing about behaviour. | exists today as `lib/character/actor.js` (poses, walk clip + atlas, glow, bubble) |
| **PNG Animation Layer** | Plays hand-drawn sequences (atlas + manifest, per-frame baseline and foot-travel data). | exists today (`assets/walk`, `walk.js`, `walkassets.js`) |
| **Procedural Effects** | Breathing, blinking, head motion, hair motion as small parametric animations. | breathing exists today as a scale about the feet; the rest planned |
| **Separate Hair Sections** | Independently animated hair parts with secondary motion and slightly different timing. | planned; needs layered art |
| **Expression Layer** | Eyes, mouth and facial reactions (blink, angry, thinking, ...). | planned; needs layered art |
| **Future Skeletal Animation** | Reusable arm, hand and leg movement. | planned, last |

## 4. Architectural rules
1. **One Animation Coordinator controls priorities.** No component starts an animation on its own authority. Suggested priority, highest first: reaction/interaction, PNG action sequence, procedural expression, procedural idle.
2. **Movement owns Bavi's desktop position.** Nothing else writes the root x/y. Procedural effects only change *local* transforms of parts (or scale about the feet), never the root.
3. **Breathing and hair never interfere with movement.** They run on separate transform channels from the root translation and from the PNG frame channel; the renderer composes them. Hair motion may *read* movement velocity as an input, never write position.
4. **PNG animation stays authoritative for complex hand-drawn actions.** Procedural effects are suspended or faded while a PNG sequence that draws the same part is playing.
5. **Every animation supports clean cancellation and teardown** (`start`, `cancel`, `dispose`; no timer, signal or actor outlives its animation; cancellation leaves the character in a valid, grounded pose). The existing `Disposer` pattern is the model.
6. **Reduced motion is respected everywhere** (`enable-animations` off): no frame sequences, no procedural motion; static pose.
7. **Memory is budgeted.** Today the walk atlas is about 22.7 MB decoded and St caches textures for the whole Shell session. Layered art must fit a stated budget before it is added; prefer a few shared atlases over many files and few actors over many.
8. **One time source.** A single frame/timer source drives all animations while any is active and stops when none is (no per-animation timers, no polling while idle).
9. **Feet stay on the floor.** Any vertical effect is anchored at the soles (as the idle breathing already is).
10. **Native first.** St/Clutter/GJS only unless a written technical evaluation justifies an engine.

## 5. Channel model (how rules 2-4 are enforced)
| Channel | Owner of the value | Examples |
|---|---|---|
| root position | Movement Controller | x, floor y |
| frame | PNG Animation Layer | atlas frame, per-frame baseline offset, mirror |
| part transforms | Procedural Effects / Skeleton | head tilt, hair rotation, breathing scale about the feet |
| expression | Expression Layer | eye and mouth variants |

The Coordinator hands a channel to at most one writer at a time; the Renderer reads all channels each frame.

## 6. Phased roadmap (no dates, no promises)
| Phase | Goal | Notes |
|---|---|---|
| **0. Stabilise** | Verify 0.3.x on a real Shell; tune the walk (`footLock`, `frameMs`); re-space the uneven frames in the art; measure memory. | prerequisite for everything below |
| **1. Coordinator** | Extract the Animation Coordinator and Movement Controller from the controller, **without changing behaviour**; add priority/cancellation tests. | pure logic first, like `walk.js` |
| **2. Procedural idle (single layer)** | Subtle breathing (exists), blinking and tiny head motion with the current single-image art where possible (for blinking an eyelid/closed-eye overlay is needed). | respects reduced motion |
| **3. Layered artwork** | Produce the layered character from the approved design (hair sections, head, eyes, mouth, body, backpack, limbs); define atlas layout, pivots and the memory budget. | art task; the approved design is never redrawn by code |
| **4. Renderer for parts + hair sections** | Compose parts; independently animated hair sections with small timing differences; expression layer. | subtle amplitudes, bounded |
| **5. More PNG actions** | Sitting, stretching, waving, sneezing, thinking, turning (hand-drawn sequences through the existing atlas/manifest path). | roadmap items from the README |
| **6. Skeletal (later)** | Reusable arm/hand/leg rig once layered parts are stable. | only after an evaluation of cost and value |

## 7. Open questions
* Frame source: `Clutter.Timeline`, per-frame callbacks or a repeating timer, and how each interacts with Shell animation settings.
* Layer count versus actor and texture budget on small GPUs.
* How blinking is drawn with a single-image character before layering exists.
* How hair reacts to the existing root motion without feeding back into it.
