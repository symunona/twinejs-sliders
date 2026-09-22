/**
 * Sliders shared type contract.
 *
 * THIS FILE IS THE SEAM. scene-schema, scene-core, scene-index, render-dom and the
 * twinejs fork all compile against it. Change it deliberately.
 *
 * Coordinate system (spec 02):
 *   origin = screen centre. x: -1 = left edge, +1 = right edge. y is UP.
 *   A character's origin is its FEET, so `at: 0` means "standing centre".
 */

/**
 * Legacy layer vocabulary. NOT a stage concept any more — entities live in one z space and
 * `layer:` is parse-time sugar that desugars to a `z` seed (see `LAYER_Z`).
 *
 * Kept exported because the parser still accepts the key, the help dialog still documents
 * it, and old scenes in the wild still write it. Order is back -> mid -> front.
 */
export const LAYERS = ['back', 'mid', 'front'] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * The z seed behind everything derived. `layer: back` and `fit:` share it, so a backdrop
 * plane and a legacy back-layer sprite sort against each other by author order rather than
 * by two numbers that drifted apart.
 */
const BACK_Z = -1;

/**
 * What `layer:` desugars to. `mid` keeps the y-derived z, so it has no seed.
 *
 * The numbers match the space `resolveZ` documents: a derived z lands in 0..1, so -1 is
 * behind everything derived and 2 is in front of it.
 */
export const LAYER_Z: Record<Layer, number | undefined> = {
	back: BACK_Z,
	mid: undefined,
	front: 2
};

/**
 * How a `fit:` entity fills the stage. CSS `object-fit` values, and deliberately only these
 * two: `fill` stretches the art and `none`/`scale-down` are a sprite with extra steps.
 */
export const ENTITY_FITS = ['cover', 'contain'] as const;

export type EntityFit = (typeof ENTITY_FITS)[number];

/**
 * What a `fit:` entity's z defaults to — the same seed `layer: back` uses.
 *
 * A plane has no `at.y` to derive a z from, so without a seed it would land wherever the
 * default baseline happens to put it, which is IN FRONT of half the cast. Behind the whole
 * derived 0..1 range is the only answer that makes `props: {wall: {fit: cover}}` draw what
 * the author meant. An explicit `z:` still wins, and two planes tied at this z break by
 * author order like everything else.
 */
export const FIT_Z = BACK_Z;

/**
 * Scene y of the stage baseline — the floor an entity stands on when the author writes
 * `at: -0.4` (x only) and never mentions y.
 *
 * NOT zero. Zero is the vertical CENTRE of the stage, so a character placed there stands
 * in mid-air with its head cropped off the top. A character is scaled to ~0.9 of stage
 * height (1.8 scene units) and its origin is its feet, so a baseline of -0.85 puts the
 * head just inside the top edge.
 */
export const LAYER_BASELINE = -0.85;

export type AssetId = string;
export type EntityId = string;
export type SceneId = string;

/** Normalized stage position. */
export interface Vec2 {
	x: number;
	y: number;
}

/** Fraction of a sprite frame (0..1). Used for origins and anchors. */
export interface Frac2 {
	x: number;
	y: number;
}

// ---------------------------------------------------------------------------
// Stage — the declarative snapshot the renderer draws.
// ---------------------------------------------------------------------------

/**
 * `auto` is what a `entities:` entry parses as. The parser has no asset store, so it cannot
 * tell a character id from an asset name; the renderer and the editor resolve it — character
 * first, asset second — and only complain when BOTH miss.
 */
export type EntityKind = 'cast' | 'prop' | 'auto';

/** How a `frames` cycle ends. */
export const FRAME_LOOPS = ['all', 'once'] as const;

export type FrameLoop = (typeof FRAME_LOOPS)[number];

/** Seconds a step holds when it names no `dur:` of its own. */
export const DEFAULT_FRAME_STEP_SECONDS = 0.1;

/**
 * One step of a frame cycle: a pose, how long it is held, and optionally where the sprite
 * is while it is held.
 *
 * The placement keys are the entity's own (`at`, `scale`, `flip`, `opacity`), and they mean
 * exactly what they mean on the entity — a step that sets none of them leaves the entity's
 * placement alone, so a plain blink cycle stays four names and four numbers. They exist
 * because a walk is a pose cycle AND a translation, and splitting the two across a beat's
 * `dur:` and a frame list would make the author keep them in sync by hand.
 */
export interface FrameStep {
	/** The character frame to draw. Required — a step with no pose is not a step. */
	name: string;
	/** Seconds held. Defaults to `DEFAULT_FRAME_STEP_SECONDS`. */
	dur?: number;
	/** Placement while this step is on screen. Absolute, like the entity's own `at`. */
	at?: Vec2;
	scale?: number;
	rot?: number;
	flip?: boolean;
	opacity?: number;
	/**
	 * How this step's glide moves, narrower than anything the beat says.
	 *
	 * One token, never a per-kind map: a step is one change to one sprite over one hold,
	 * and the renderer writes it as one timing function on one element. Only meaningful on
	 * a step that carries an `at` — a step that moves nowhere has nothing to ease.
	 */
	ease?: string;
}

export interface StageEntity {
	id: EntityId;
	kind: EntityKind;
	/** Character id (cast) or asset id (prop). */
	ref: string;
	/**
	 * Position. ABSOLUTE stage coordinates — unless `of` is set, and then it is an offset
	 * from that entity's resolved position.
	 */
	at: Vec2;
	/**
	 * Parent entity id. `at` becomes relative to it, so moving the parent moves this too.
	 *
	 * Translation ONLY, deliberately (D17): the parent's `scale`, `flip` and `frame` do not
	 * reach the child. That is what keeps resolution a vector add with no sprite metrics in
	 * it, and therefore keeps it in `scene-core` — where the differ can see it, so a child
	 * glides when its parent moves instead of snapping.
	 *
	 * A `Stage` carries this UNRESOLVED: `at` is what the author wrote. `resolveStage()`
	 * turns a stage into absolute coordinates and strips this key. Resolve at the draw and
	 * diff boundary, never before `from:` inheritance or a beat patch — those merge the
	 * author's local numbers, and merging one onto a resolved absolute is how a child ends
	 * up double-offset.
	 */
	of?: EntityId;
	/**
	 * Named frame for cast; ignored for simple props.
	 *
	 * When the author wrote a LIST (`frame: [{name: walk_1, dur: 0.1}, …]`) this holds the
	 * first step's name and `frames` holds the whole cycle. Two keys for one YAML key so
	 * that everything which only ever wanted "which pose is this" — the differ, the
	 * editor's frame picker, the asset collectors, the rig's anchor lookup — keeps reading
	 * one string and never has to know about animation.
	 */
	frame?: string;
	/**
	 * A frame CYCLE, played by the renderer on its own clock. Absent for a still pose.
	 *
	 * Timing lives here rather than in the beat's `dur:` because the two answer different
	 * questions: `dur:` is how long the reader looks at the beat, this is how fast the
	 * sprite's own legs move, and a walk cycle outlives the line that started it.
	 */
	frames?: FrameStep[];
	/** How `frames` ends. Default `all` — loop forever. `once` holds the last step. */
	frameLoop?: FrameLoop;
	flip: boolean;
	/**
	 * Draw this entity as a full-bleed PLANE instead of as a positioned sprite: it fills the
	 * stage box and its picture is `object-fit: cover` or `contain`.
	 *
	 * The point is stacking. `bg` is one backdrop outside the entity stack, so a wall in
	 * FRONT of the cast and a sky behind them cannot both be backdrops; a plane lives in the
	 * one z space every sprite lives in, so a transparent-PNG room front at `z: 1` and an
	 * animated sky at `z: -2` sandwich the cast with no new concept.
	 *
	 * It is a DRAWING MODE, not a kind: a plane is still an ordinary entity that a beat can
	 * patch, fade and re-order. What it has no use for is sprite geometry — `at`, `of`,
	 * `scale` and `rot` are ignored (the parser warns), because there is no sprite box to
	 * place, hang off, size or turn. `z`, `opacity` and `flip` all still mean what they say.
	 */
	fit?: EntityFit;
	/**
	 * Explicit draw order. When undefined, z derives from y — lower on screen is nearer, so
	 * it paints later. ONE space for the whole stage: there are no layers to cross.
	 *
	 * A `fit:` entity has no y to derive from, so the parser seeds it with `FIT_Z`.
	 */
	z?: number;
	opacity: number;
	/**
	 * Uniform size multiplier, about the entity's own origin — so scaling a character does
	 * not lift it off the floor. 1 is the natural size (a character's manifest `size`, a
	 * prop's pixels).
	 *
	 * Required rather than optional, like `opacity` and unlike `z`: every renderer has to
	 * multiply by something, and an optional key would put a `?? 1` in each of them.
	 */
	scale: number;
	/**
	 * Clockwise rotation in DEGREES, about the entity's own origin — the same pivot `scale`
	 * grows about, so a tilted character still has its feet on the floor and a lamp post
	 * leans from its base.
	 *
	 * Optional, unlike `scale`: 0 is a true identity, so a renderer that never saw the key
	 * emits no rotation at all rather than a `rotate(0deg)` it has to multiply in. Degrees
	 * rather than turns or radians because an author writing a scene by hand thinks in
	 * them, and because CSS does.
	 *
	 * Composition is the RENDERER's, not the author's — that is the whole reason this is
	 * its own key instead of a CSS `transform:` string. `flip` applies first and rotation
	 * second, so a positive `rot` leans the same way on screen whichever way the sprite
	 * faces.
	 */
	rot?: number;
	/**
	 * Where clicking this entity takes the reader. Absent means it is scenery.
	 *
	 * STATE, like `frame` and unlike a beat's `sfx`: every later beat inherits it, so the
	 * door that opened onto the hall at beat 2 still does at beat 9 unless a beat repoints
	 * it — which is what makes "same object, different destination per beat" a patch rather
	 * than a construct of its own. `link: ~` on a beat is how it stops being a way out.
	 *
	 * A struct rather than a bare passage name because a link may instead NAME an entry in
	 * the scene's `links:` block, and then it inherits that entry's `if:`. The player is the
	 * only thing that may evaluate that condition; the editor draws the object as clickable
	 * either way, because an editor showing a conditional door as scenery is worse than one
	 * showing a door the reader may not get to use.
	 */
	link?: EntityLink;
	/**
	 * How a clickable entity lights up under the pointer. Absent = the renderer's default
	 * glow whenever `link` is set.
	 *
	 * A CSS colour is used as the glow colour. Any other token reaches the DOM as
	 * `data-highlight` and is the story stylesheet's to paint, exactly like `bubble: {as:}`
	 * and `bg: {fx:}` — the extension point that costs no format change.
	 */
	highlight?: string;
}

/**
 * What an entity's `link:` resolved to.
 *
 * Two spellings, one key: `link: Cellar` is a passage, `link: escape` is an entry in the
 * scene's own `links:` block. The PARSER decides which — it is the only thing holding both
 * the entity and the links block — so nothing downstream has to guess, and a scene that
 * spells a link both ways behaves the same both times.
 */
export interface EntityLink {
	/**
	 * The `links:` entry this named, when it named one. The player resolves it through the
	 * already-`if:`-filtered link map, so a gated link that failed its condition simply is
	 * not there.
	 */
	name?: string;
	/** The passage to go to. Set for a direct passage name, and for a resolved named link. */
	to?: string;
	/**
	 * Copied from the named `links:` entry, for a host that wants to know why a link is
	 * inert. Evaluated by the player alone — the editor holds no story state.
	 */
	if?: string;
}

export interface StageFx {
	id: string;
	amount: number;
}

/**
 * A sound, named the way art is named: by asset name, never by path or id.
 *
 * `amount` is volume, and it is the same `name@amount` token `fx:` already uses — one
 * grammar the author learns once. A sound is not an entity: it has no position, no z and
 * no anchor, so it never reaches the stage's entity map.
 */
export interface StageSound {
	id: string;
	amount: number;
}

export interface Camera {
	at: Vec2;
	zoom: number;
}

/**
 * Motions a backdrop can be given, as `bg: {id: …, fx: parallax_left}`.
 *
 * A list of PRESETS, not a closed set: the token is handed to the renderer as a data
 * attribute, so a story's own stylesheet can define `fx: lava_glow` the same way it can
 * define a `bubble: {as: …}` token. These are the ones the renderer paints itself, and the
 * ones the editor offers.
 */
export const BG_MOTIONS = [
	'parallax_left',
	'parallax_right',
	'parallax_up',
	'parallax_down',
	'scroll_infinite_left',
	'scroll_infinite_right',
	'scroll_infinite_up',
	'scroll_infinite_down',
	'earthquake',
	'circling'
] as const;

/**
 * Motions that LOOP the picture rather than move it about inside the frame.
 *
 * They are the one kind the renderer cannot draw with a single element: an <img> does not
 * tile, so a second copy trails the first by a whole frame and the pair slides together.
 * Everything else is one element and a transform.
 */
export const BG_MOTION_TILED = 'scroll_infinite';

/** True when `id` is a motion that needs the trailing copy. */
export function bgMotionTiles(id: string | undefined): boolean {
	return id !== undefined && id.startsWith(BG_MOTION_TILED);
}

export type BgMotion = (typeof BG_MOTIONS)[number];

/**
 * A backdrop that moves on its own: a slow parallax drift, a shudder, a lazy circle.
 *
 * Kept OUT of `Stage.bg` — which stays the plain asset name every collector, differ and
 * placeholder already reads — for the same reason `StageEntity.frames` is kept out of
 * `frame`: one YAML key, two fields, and nothing downstream has to learn about the new one
 * to keep working.
 *
 * `speed` is the seconds one cycle of the motion takes. Absent means the preset's own
 * pace, which is not one number: a parallax drifts for twenty seconds and an earthquake
 * shudders in half of one, so the default lives in each preset's CSS rather than here.
 */
export interface StageBgFx {
	id: string;
	speed?: number;
}

/** A complete, renderable snapshot of the stage. No history, no beats. */
export interface Stage {
	bg?: AssetId;
	/**
	 * True when `bg` came from the scene's `id:` rather than a `bg:` line. A backdrop the
	 * author never asked for is a soft reference: it draws if the art exists and stays
	 * silent if it does not, so no lint, bundle report or `? bg` placeholder fires for it.
	 */
	bgImplicit?: boolean;
	/** The backdrop's own motion, if it has one. State, like `bg` itself. */
	bgFx?: StageBgFx;
	camera: Camera;
	/** Keyed by entity id. Insertion order is not significant; z decides drawing. */
	entities: Record<EntityId, StageEntity>;
	fx: StageFx[];
	/**
	 * The bed: one looping sound the scene sits in, or nothing.
	 *
	 * State rather than an event, exactly like `bg`. Walking into a scene that declares the
	 * same music as the one before must not restart it, and stepping the editor's scrubber
	 * backwards must not stack a second copy — both fall out of asking "what should be
	 * playing now" instead of "what just happened". One-shot sounds are the opposite thing
	 * and live on a beat (`BeatBase.sfx`).
	 */
	music?: StageSound;
}

export function emptyStage(): Stage {
	return {bg: undefined, camera: {at: {x: 0, y: 0}, zoom: 1}, entities: {}, fx: []};
}

// ---------------------------------------------------------------------------
// Beats — the timeline laid over the stage.
// ---------------------------------------------------------------------------

export type BeatKind =
	| 'say'
	| 'box'
	| 'wait'
	| 'fx'
	| 'sfx'
	| 'mark'
	| 'set'
	| 'bg';

export interface BeatBase {
	kind: BeatKind;
	/** Index in the scene's beat list. */
	index: number;
	/**
	 * How long this beat holds the screen, in seconds — and, because a beat IS the
	 * animation, how long its stage changes take to play.
	 *
	 * Absent is today's behaviour: a `say` or `box` waits for the reader (or for the
	 * reader's own `sliders.autoAdvance`), and a stage-only beat falls straight through in
	 * the same tick. Present, it beats the reader's setting — the author timed this line,
	 * and a preference must not stretch or shorten it.
	 *
	 * On `BeatBase` rather than on the three interfaces that can actually carry it, so
	 * nothing has to remember to copy it. The PARSER is the gate: `wait`, `fx` and `mark`
	 * are written as scalars with no body map to put a `dur:` in, so they never get one.
	 * (`wait` *is* a duration; a second spelling of it would be two ways to say one thing.)
	 */
	dur?: number;
	/**
	 * A one-shot sound fired as this beat arrives. On `BeatBase` for the same reason `dur`
	 * is: a door slams under a line, under a move, or on its own, and three copies of the
	 * key would disagree the moment one of them grew an option.
	 *
	 * Deliberately NOT stage state. Firing is an event — it happens once, at a moment, and
	 * a stage snapshot has no way to say "again". `- sfx: door` is the beat whose only job
	 * is this, and it is `kind: 'sfx'`.
	 */
	sfx?: StageSound;
	/**
	 * A new backdrop, from this beat on. `null` is `bg: ~` — the backdrop is taken away.
	 *
	 * On `BeatBase` beside `sfx` and `dur`, so the cut can ride on the line that motivates
	 * it (`- mira: {say: "…", bg: cellar}`) instead of costing a beat of its own; `- bg:
	 * cellar` is the beat whose only job is this, and it is `kind: 'bg'`.
	 *
	 * Unlike `sfx` this IS stage state: every later beat keeps the new backdrop, and the
	 * scrubber stepping back to an earlier beat shows the old one, because both fall out of
	 * `runBeats` replaying the change rather than remembering that it fired.
	 */
	bg?: AssetId | null;
	/** The motion for that backdrop. Absent CLEARS an inherited one — see `applyBeat`. */
	bgFx?: StageBgFx;
	/**
	 * How this beat's stage changes move — the companion to `dur:`, which says how long.
	 *
	 * One token for the whole beat, or one per transition kind
	 * (`{move: ease_out, scale: linear}`), because a sprite that slides in while its size
	 * snaps is a perfectly ordinary thing to want and the two are one element's
	 * `transition-duration` away from being impossible to ask for.
	 *
	 * On `BeatBase` for the same reason `dur` is, and gated by the parser the same way:
	 * `wait`, `fx` and `mark` are scalars with no body map to write one in.
	 */
	ease?: BeatEase;
}

/**
 * The stage keys an entity entry or a beat may set. Derived from StageEntity rather than
 * listed by hand, so adding an entity key (`scale`, and whatever follows it) does not mean
 * hunting down three separate Pick lists that then quietly disagree.
 */
export type EntityPatchBody = Partial<
	Omit<StageEntity, 'id' | 'kind' | 'ref' | 'of' | 'link' | 'highlight'>
> & {
	/**
	 * `of` is the one key a patch can also CLEAR. Everything else is set-or-inherit, but a
	 * patch scene that wants a child back in world space has no other way to say so — an
	 * absent key means "inherited" under `from:`, so omitting it keeps the parent. `null` is
	 * `of: ~` in the YAML, and detaches.
	 */
	of?: EntityId | null;
	/**
	 * Clearable for the same reason `of` is, and needed far more often: a link is STATE that
	 * every later beat inherits, so the beat where the door stops being a way out has to be
	 * able to say `link: ~`. Without a null there is no spelling for "no longer clickable".
	 */
	link?: EntityLink | null;
	/** Clearable beside `link`, so a beat can drop a hint's glow without dropping the link. */
	highlight?: string | null;
};

// ---------------------------------------------------------------------------
// Bubble styling (spec 02, "Speech styles")
// ---------------------------------------------------------------------------

/**
 * The styles the renderer ships CSS for. A story may use any other token as well — it
 * reaches the DOM as `data-style` and the story's own stylesheet paints it — so this list
 * is what autocomplete offers and what the editor stops warning about, not a closed set.
 */
export const BUBBLE_PRESETS = [
	'normal',
	'bold',
	'italic',
	'bold-italic',
	'yell',
	'whisper',
	'narrator'
] as const;

export type BubblePreset = (typeof BUBBLE_PRESETS)[number];

/**
 * Styles the renderer DRAWS, rather than paints with CSS.
 *
 * A shape is a pure function of the bubble's size, its tail direction and two colours, and
 * it returns SVG (`packages/render-dom/src/bubble-shapes.ts`). That is the whole reason
 * these are a separate list from `BUBBLE_PRESETS`: a CSS preset is a look laid over the
 * ordinary rounded box and composes with any other CSS, a shape REPLACES the box — no
 * background, no border, no CSS tail — so the two can never be layered and an author has
 * to pick one.
 *
 * Open like the presets are: a token naming neither is still handed to the DOM as
 * `data-style` for a story's own stylesheet to paint.
 */
export const BUBBLE_SHAPES = ['comic', 'shard', 'impact', 'thought'] as const;

export type BubbleShapeName = (typeof BUBBLE_SHAPES)[number];

/**
 * How a bubble decides its size.
 *
 * `auto` is the default and the historical behaviour: the box snaps to its content, `w`
 * caps how wide it may get before the text wraps, and the height is whatever the words
 * need. The text size does not change, so a long line makes a tall bubble.
 *
 * `absolute` is the opposite trade: the box is EXACTLY `w` x `h` of the stage box, which
 * is what a fixed comic panel wants, and the TEXT is scaled to fit inside it. Two lines
 * and ten lines then occupy the same rectangle, at different type sizes.
 *
 * The word is `absolute` rather than `fixed` because it says what the size is measured
 * against — the slide — not that it never changes: an absolute bubble still grows with the
 * stage, which is the point of it being a fraction.
 *
 * `manual` is the third corner of that triangle and the one the editor writes when a
 * bubble is resized by its top or bottom edge: the box is EXACTLY `w` x `h`, like
 * `absolute`, and the type stays the size it would be anywhere else in the scene. So it is
 * a hand-composed panel whose words are set like every other line, where `absolute` is a
 * hand-composed panel whose words are set to fill it. A `manual` box whose text does not
 * fit clips rather than shrinking — the author stated the rectangle, so the rectangle is
 * what they get, and the editor draws its edges while they drag them.
 */
export const BUBBLE_SIZINGS = ['auto', 'absolute', 'manual'] as const;

export type BubbleSizing = (typeof BUBBLE_SIZINGS)[number];

/**
 * What a bubble hangs off.
 *
 * `speaker` is the default: the bubble follows the character's `bubble` anchor, and a
 * pinned one (`at:`/`place:`) still grows a tail back towards them.
 *
 * `scene` DETACHES it. The bubble belongs to the stage, not to whoever is speaking: no
 * tail, no anchor to follow, `at:` alone says where it goes. It is what a caption, a
 * voice-over or an off-screen shout wants, and unlike `place: …` it says so out loud
 * instead of leaving a tail pointing at a character who happens to be standing there.
 */
export const BUBBLE_ANCHORS = ['speaker', 'scene'] as const;

export type BubbleAnchor = (typeof BUBBLE_ANCHORS)[number];

/**
 * Where a bubble sits when it is not hanging off its speaker.
 *
 * `auto` is the default and the only one that follows a character: the bubble hangs off
 * their `bubble` anchor and leans the way the anchor lies from their mouth. Every other
 * value pins the bubble to a part of the stage box, which is what a narrator or a
 * disembodied voice wants — the speaker need not be on stage at all.
 */
export const BUBBLE_PLACES = [
	'auto',
	'top',
	'bottom',
	'left',
	'right',
	'top-left',
	'top-right',
	'bottom-left',
	'bottom-right',
	'centre'
] as const;

export type BubblePlace = (typeof BUBBLE_PLACES)[number];

/** Keys a `bubble:` map accepts. Exported so the editor can hint and document them. */
export const BUBBLE_KEYS = [
	'as',
	'place',
	'anchor',
	'sizing',
	'at',
	'tail',
	'w',
	'h',
	'bg',
	'accent',
	'color',
	'font',
	'size'
] as const;

/**
 * How one line is painted, and where.
 *
 * Three tiers, and a scene only ever writes the ones it wants: `as` names a look shared by
 * the whole story, `place` moves the bubble to a part of the stage, and `at`/`w` are what
 * dragging and resizing the bubble in the editor write down. The colour keys are the
 * escape hatch for a one-off — they become CSS custom properties on the bubble, so they
 * compose with a preset rather than replacing it.
 */
export interface BubbleStyle {
	/**
	 * Preset name, shape name, or any token the story's stylesheet defines.
	 *
	 * One token, three answers, resolved in that order: a `BUBBLE_SHAPES` name is DRAWN,
	 * a `BUBBLE_PRESETS` name is painted by the shipped CSS, anything else reaches the DOM
	 * as `data-style` for the story to paint.
	 */
	as?: string;
	place?: BubblePlace;
	/** `scene` detaches the bubble from its speaker. Default `speaker`. */
	anchor?: BubbleAnchor;
	/** `absolute` fixes the box to `w` x `h` of the stage and scales the text to fit. */
	sizing?: BubbleSizing;
	/**
	 * Explicit position: the bubble's CENTRE, in fractions of the stage box measured from
	 * its top left. Wins over `place`.
	 */
	at?: Frac2;
	/**
	 * Where the tail points, in fractions of the stage box — instead of at the speaker's
	 * own `bubble` anchor.
	 *
	 * Stage fractions rather than an offset from the speaker, because the point of naming
	 * it is usually something that is NOT the speaker: a door, a window, someone off the
	 * side of the frame. A sprite that walks away would drag an offset along with it.
	 *
	 * Ignored by `anchor: scene`, which is the author saying the bubble hangs off nothing
	 * and grows no tail at all. Dragging the anchor cross in the scene editor is what
	 * writes this.
	 */
	tail?: Frac2;
	/**
	 * Width as a fraction of the stage box's width.
	 *
	 * The maximum the text may wrap to under `sizing: auto`, the exact width under
	 * `sizing: absolute` and `sizing: manual`.
	 */
	w?: number;
	/**
	 * Height as a fraction of the stage box's height. Only `sizing: absolute` and
	 * `sizing: manual` read it — an auto bubble is as tall as its words, which is what
	 * auto means.
	 */
	h?: number;
	/** Background colour. Any CSS colour. A drawn shape fills itself with it. */
	bg?: string;
	/**
	 * The second colour: a drawn shape's outline, offset slab or highlight.
	 *
	 * Meaningless to the CSS presets, which have one surface. It is here rather than in a
	 * shape-only map because `bg`/`accent` are the pair every shape takes, and an author
	 * recolouring a bubble should not have to know which of the two keys the style they
	 * picked happens to read.
	 */
	accent?: string;
	/** Text colour. */
	color?: string;
	/** Font family, e.g. `Georgia, serif`. */
	font?: string;
	/** Text size multiplier. 1 is the stage's normal size. */
	size?: number;
}

export interface SayBeat extends BeatBase {
	kind: 'say';
	who: EntityId;
	text: string;
	/** Stage mutations applied when this beat runs. */
	patch?: EntityPatchBody;
	/** Merged over the speaking character's own `bubble:` defaults. */
	style?: BubbleStyle;
}

export interface BoxBeat extends BeatBase {
	kind: 'box';
	text: string;
	style?: BubbleStyle;
}

export interface WaitBeat extends BeatBase {
	kind: 'wait';
	seconds: number;
}

export interface FxBeat extends BeatBase {
	kind: 'fx';
	fx: StageFx;
}

/**
 * A beat whose whole content is a sound. The sound itself is `BeatBase.sfx`, so nothing has
 * to look in two places for it — this kind only says "that is all this beat does".
 */
export interface SfxBeat extends BeatBase {
	kind: 'sfx';
	sfx: StageSound;
}

/**
 * A beat whose whole content is a backdrop change. The backdrop itself is `BeatBase.bg`,
 * so nothing has to look in two places for it — this kind only says "that is all this beat
 * does", exactly as `SfxBeat` does for a sound.
 */
export interface BgBeat extends BeatBase {
	kind: 'bg';
	bg: AssetId | null;
}

export interface MarkBeat extends BeatBase {
	kind: 'mark';
	name: string;
}

/** Stage-only mutation with no dialogue, e.g. `- mira: {at: -0.2}`. */
export interface SetBeat extends BeatBase {
	kind: 'set';
	who: EntityId;
	patch: EntityPatchBody;
}

export type Beat =
	| SayBeat
	| BoxBeat
	| WaitBeat
	| FxBeat
	| SfxBeat
	| MarkBeat
	| SetBeat
	| BgBeat;

// ---------------------------------------------------------------------------
// Links (D3)
// ---------------------------------------------------------------------------

export interface SceneLink {
	name: string;
	to: string;
	if?: string;
	icon?: string;
	transition?: string;
}

// ---------------------------------------------------------------------------
// Scene — the parsed authoring unit, before from: resolution.
// ---------------------------------------------------------------------------

/**
 * A scene as written in one passage. `base` is the local stage declaration; if `from` is
 * set it is a PATCH over the inherited stage, otherwise it is a complete snapshot.
 *
 * Merge semantics flip on `from` (spec 02):
 *   no from  -> key absent means REMOVED
 *   from set -> key absent means INHERITED; explicit null means REMOVED
 */
/**
 * What a scene's `locked:` list can pin.
 *
 * A list rather than a second key per target, so the next thing worth locking costs a token
 * here instead of a new top-level key. `bg` is the camera and the backdrop together: they
 * are one gesture to the author, who grabbed the ground and expected nothing to move.
 */
export const SCENE_LOCKS = ['bg', 'entities'] as const;

export type SceneLock = (typeof SCENE_LOCKS)[number];

export interface Scene {
	id?: SceneId;
	/** `other-scene` | `other-scene@enter` | `other-scene@markName` */
	from?: string;
	bg?: AssetId | null;
	/**
	 * The backdrop's motion, from `bg: {id: …, fx: …, speed: …}`.
	 *
	 * Absent does NOT mean "inherit" on its own: the rule is read off `bg`, the way
	 * `mergePatch` reads a frame cycle off `frame`. A scene that names a backdrop at all
	 * states its motion completely, so `bg: cellar` after an inherited parallax stops it —
	 * a drift left over from art that is no longer on screen is never what was meant.
	 */
	bgFx?: StageBgFx;
	camera?: Partial<Camera>;
	/**
	 * Seconds a beat that did not time itself holds the screen, for this scene only.
	 *
	 * Sits between the reader's `sliders.autoAdvance` (which it overrides) and a beat's own
	 * `dur:` (which overrides it). `0` means "wait for a click", exactly as it does in the
	 * reader's setting — a scene key is scene PACING, so it reads the same way the thing it
	 * replaces did. A `dur: 0` is a different statement and still means "snap and go on".
	 */
	autoAdvance?: number;
	/**
	 * How this scene's stage changes move, for every beat that does not say otherwise.
	 *
	 * The middle of three layers, narrowest first: a frame step's own `ease`, the beat's
	 * `ease:`, this, then `DEFAULT_EASES`. Resolved per KIND, so a scene that says
	 * `ease: ease_in_out` and a beat that says `ease: {move: back_out}` give that beat an
	 * overshooting move and an eased-in-out everything-else.
	 *
	 * Unlike `autoAdvance:` there is no reader preference under this one — pacing is the
	 * reader's to argue with, the shape of a movement is the author's alone.
	 */
	ease?: BeatEase;
	/**
	 * How every line in this scene is painted, unless it says otherwise.
	 *
	 * The middle of four layers, widest first: the STORY's `sliders.bubble.*` variables,
	 * this, the speaking character's own `bubble:`, then the beat's `as:`/`bubble:`. Merged
	 * per key the whole way down, so a scene that names only a `font:` leaves a character's
	 * `as: whisper` alone.
	 *
	 * Under the character rather than over it on purpose: a character's bubble is part of
	 * who they are and holds for every scene they appear in, while this key is the look of
	 * one episode. A scene that really must override a specific speaker writes it on their
	 * beats, which is the narrower statement anyway.
	 */
	bubble?: BubbleStyle;
	/**
	 * What the visual editor must not let a gesture change in this scene.
	 *
	 * `true` is the whole stage; a list names what is pinned, so `[bg]` holds the camera and
	 * the backdrop still while sprites stay draggable. An EDITOR hint and nothing more — the
	 * player never reads it, the same way `Stage.bgImplicit` is invisible to it.
	 *
	 * In the scene rather than in a preference because a shot that is framed is framed for
	 * everyone who opens the passage, and because the pan that ruins it is the easiest
	 * gesture in the editor to make by accident: grabbing empty ground.
	 */
	locked?: true | SceneLock[];
	/** Entity patches keyed by id. `null` means "remove this entity" (only valid with from). */
	entities: Record<EntityId, EntityPatch | null>;
	fx?: StageFx[];
	/**
	 * The scene's bed. `null` is `music: ~` — silence, stated — which a patch scene needs to
	 * be able to say, since an absent key there means "inherit" (spec 02's merge flip). It
	 * reads exactly like `bg: ~`, which is the point.
	 */
	music?: StageSound | null;
	beats: Beat[];
	links: Record<string, SceneLink>;
	/** True when `cast: !only {...}` was used — replace rather than merge. */
	replaceCast?: boolean;
	replaceProps?: boolean;
	/** True when `entities: !only {...}` was used. */
	replaceEntities?: boolean;
}

export interface EntityPatch extends EntityPatchBody {
	kind: EntityKind;
	ref: string;
}

// ---------------------------------------------------------------------------
// Errors (spec 05)
// ---------------------------------------------------------------------------

export type SceneErrorCode =
	| 'yaml-syntax'
	| 'subset-violation'
	| 'unknown-key'
	| 'bad-coordinate'
	| 'bad-layer'
	| 'bad-value'
	| 'unknown-asset'
	| 'unknown-character'
	| 'unknown-frame'
	| 'unknown-link'
	| 'unknown-passage'
	| 'passage-case'
	| 'unknown-variable'
	| 'unknown-parent'
	| 'of-cycle'
	| 'dupe-scene-id'
	| 'unknown-from'
	| 'from-cycle'
	| 'vars-separator'
	/** A vars line whose VALUE is not a JavaScript expression. See `varsValueError`. */
	| 'vars-value'
	| 'missing-id';

export interface SceneError {
	code: SceneErrorCode;
	message: string;
	hint?: string;
	/** 1-indexed. */
	line: number;
	col: number;
	endLine?: number;
	endCol?: number;
	severity: 'error' | 'warning';
	/** Present only when the repair is mechanical. See `SceneFix`. */
	fix?: SceneFix;
}

/**
 * A mechanical repair for an error: replace one span with one string.
 *
 * Deliberately one splice and not a list of them. The passage editor's CodeMirror is
 * controlled, and react-codemirror2 keeps exactly one deferred change per tick, so a
 * two-splice fix could not be applied in a single click anyway (see `use-scene-writer.ts`).
 * It is also the honest limit on what an author should accept without looking: every
 * suggestion here is a guess from an edit distance, and a fix that fits on one line is one
 * they can check at a glance.
 */
export interface SceneFix extends SceneSpan {
	/** What the fix does, in the author's words: `Change 'bgg' to 'bg'`. */
	label: string;
	/**
	 * What the span must still contain for the fix to apply.
	 *
	 * Errors come from a debounced parse, so the document may have moved on since. Without
	 * this the fix would splice its replacement over whatever happens to be there now.
	 */
	replaces: string;
	/** Replaces the span. */
	text: string;
}

/**
 * Parse result. `scene` is ALWAYS present, even when errors exist — the preview must keep
 * rendering a best-effort stage instead of blanking (spec 05).
 */
export interface ParseResult {
	scene: Scene;
	errors: SceneError[];
	/**
	 * Where each link's target was written, keyed by link name. Block-relative, like an
	 * error's own line. The editor validates targets against the story's passage list —
	 * something the parser cannot see — and needs somewhere to point when one is wrong.
	 */
	linkSpans?: Record<string, SceneSpan>;
	/**
	 * Where each link's `if:` condition was written, keyed by link name. Same reason as
	 * `linkSpans`: the variables a condition names are set in vars sections elsewhere in
	 * the story, and only the editor can see those.
	 */
	linkIfSpans?: Record<string, SceneSpan>;
	/**
	 * Where each beat was written, index-aligned with `scene.beats`.
	 *
	 * The editor highlights the line the preview is standing on, the way a debugger
	 * highlights the statement it is stopped at — which needs the beat's own range, and a
	 * beat can be a nested block several lines long.
	 */
	beatSpans?: SceneSpan[];
	/**
	 * Every entity `link:` that resolved to a passage, with where it was written.
	 *
	 * A LIST, not a map keyed by target the way `linkSpans` is keyed by link name: two
	 * different props may lead to the same passage, and both of them deserve a squiggle
	 * when that passage does not exist.
	 */
	entityLinkSpans?: EntityLinkSpan[];
}

/** One entity `link:` and where the author wrote it. */
export interface EntityLinkSpan extends SceneSpan {
	/** The passage the link resolved to. */
	to: string;
}

/** A place in the scene text. 1-indexed, same as `SceneError`. */
export interface SceneSpan {
	line: number;
	col: number;
	endLine?: number;
	endCol?: number;
}

// ---------------------------------------------------------------------------
// Transitions — what the differ derives.
// ---------------------------------------------------------------------------

export type TransitionKind =
	| 'enter'
	| 'exit'
	| 'move'
	| 'scale'
	| 'rot'
	| 'frame'
	| 'flip'
	| 'bg'
	| 'camera'
	| 'fx'
	| 'music';

export interface Transition {
	kind: TransitionKind;
	entityId?: EntityId;
	from?: unknown;
	to?: unknown;
	/** Seconds. 0 means snap. */
	duration: number;
	/**
	 * HOW it moves, as the author's token — an `EASES` name, or a raw CSS timing function.
	 *
	 * Absent means "the kind's default", which is `DEFAULT_EASES`, which is what `cssEase`
	 * falls back to. Resolved here rather than stamped by the differ so that
	 * `easeTransitions(ts, undefined)` can hand back the same list it was given, exactly
	 * as `timeTransitions` does.
	 *
	 * Deliberately NOT on `StageEntity`. An ease is not part of a stage — two stages that
	 * differ only in ease describe the same picture, and `samePlacement()` would read the
	 * difference as a move and emit a phantom `move` transition on every beat that retimed
	 * one. It is born from the beat, and it lives on what the beat produced.
	 */
	ease?: string;
}

// ---------------------------------------------------------------------------
// Easing — HOW a change moves, as opposed to how long it takes.
// ---------------------------------------------------------------------------

/**
 * The presets, as CSS timing functions.
 *
 * Named in the scene's own dialect (`ease_out`, not `cubic-bezier(0, 0, 0.58, 1)`) for the
 * same reason `fx: rain` is: an author writing a scene is describing a feeling, and the
 * curve behind it is the renderer's business. The raw form is still accepted, so a story
 * that needs a curve nobody anticipated does not have to wait for one.
 *
 * `bounce_out` is a CSS `linear()` easing function rather than keyframes: a bounce is a
 * shape, and expressing it as a timing function means it composes with every duration and
 * every property the renderer already transitions, instead of needing an animation of its
 * own per kind.
 */
export const EASES = {
	linear: 'linear',
	ease_in: 'cubic-bezier(0.42, 0, 1, 1)',
	ease_out: 'cubic-bezier(0, 0, 0.58, 1)',
	ease_in_out: 'cubic-bezier(0.42, 0, 0.58, 1)',
	/** Overshoots the target and settles back. */
	back_out: 'cubic-bezier(0.34, 1.56, 0.64, 1)',
	/** Pulls back before going, like a wind-up. */
	anticipate: 'cubic-bezier(0.6, -0.28, 0.74, 0.05)',
	bounce_out: 'linear(0, 0.5, 0.9, 1, 0.92, 1)'
} as const;

export type EaseName = keyof typeof EASES;

/** The preset names, for the editor's completion list and for `keyFix()`. */
export const EASE_NAMES = Object.keys(EASES) as EaseName[];

/**
 * What an `ease:` key holds: one token for everything, or one per transition kind.
 *
 * `string` rather than `EaseName` because a raw `cubic-bezier(…)` is legal and because an
 * unknown word is a WARNING, not an error — the parser keeps what the author wrote so the
 * text and the model never disagree, and `cssEase` falls back at draw time.
 */
export type BeatEase = string | Partial<Record<TransitionKind, string>>;

/**
 * The curve each kind uses when nothing asks for another.
 *
 * Exhaustive over `TransitionKind` on purpose: a new kind is a new thing that moves, and
 * moving without a stated curve is a decision, not a default to inherit silently. Adding
 * one fails the build here until it is made.
 *
 * `enter`/`exit` are opposites (out of nothing, back into it) and `bg`/`frame`/`fx` are
 * linear because a cross-fade that eases is a cross-fade that looks mistimed.
 */
export const DEFAULT_EASES: Record<TransitionKind, EaseName> = {
	bg: 'linear',
	camera: 'ease_in_out',
	enter: 'ease_out',
	exit: 'ease_in',
	flip: 'ease_out',
	frame: 'linear',
	fx: 'linear',
	move: 'ease_out',
	music: 'linear',
	rot: 'ease_out',
	scale: 'ease_out'
};

/**
 * The kinds an `ease:` map may name — the same list, in the same order.
 *
 * Derived from `DEFAULT_EASES` rather than written again, so the completion list and the
 * parser's unknown-key check cannot drift from what actually has a default.
 */
export const EASE_KINDS = Object.keys(DEFAULT_EASES) as TransitionKind[];

/**
 * A timing function written out in full, rather than named.
 *
 * Deliberately narrow: the token is assigned to `style.transitionTimingFunction`, and while
 * the CSSOM drops a value it cannot parse rather than letting anything escape, a token that
 * is obviously not a timing function is far more likely to be a typo the author wants told
 * about than a curve nobody has thought of.
 */
const RAW_TIMING = /^(?:cubic-bezier|linear|steps)\(\s*[-\w.,%\s]*\)$/i;

/** The CSS keywords that are not already preset names. */
const CSS_TIMING_KEYWORDS = new Set([
	'ease',
	'ease-in',
	'ease-out',
	'ease-in-out',
	'step-start',
	'step-end'
]);

/**
 * The CSS the token means, or `undefined` when it means nothing — which is the editor's
 * cue to warn and the renderer's cue to fall back.
 */
export function easeValue(token: string | undefined): string | undefined {
	if (typeof token !== 'string') {
		return undefined;
	}

	const trimmed = token.trim();

	// hasOwnProperty, not `in`: `constructor` is `in` every object literal.
	if (Object.prototype.hasOwnProperty.call(EASES, trimmed)) {
		return EASES[trimmed as EaseName];
	}

	return CSS_TIMING_KEYWORDS.has(trimmed.toLowerCase()) ||
		RAW_TIMING.test(trimmed)
		? trimmed
		: undefined;
}

/** What to write into `transition-timing-function`. Never fails — a bad token snaps back
 * to the kind's own default, so a typo slows nothing down and breaks no animation. */
export function cssEase(
	token: string | undefined,
	kind: TransitionKind
): string {
	return easeValue(token) ?? EASES[DEFAULT_EASES[kind]];
}

// ---------------------------------------------------------------------------
// Cast + assets
// ---------------------------------------------------------------------------

/**
 * How one frame's art sits inside the character box — registration, not expression.
 * Sprite sheets rarely agree: a wave is drawn a little higher, an idle a little smaller.
 * This nudges each frame until they line up, which is what the editor's ghost frames are
 * for seeing.
 *
 * The rig does NOT move with it: `fit` nudges the ART, and a frame's `anchors` describe
 * where the rig points sit in the BOX. Registration and rigging are separate jobs, and a
 * frame that has been nudged into place must not drag its bubble along with it.
 *
 * Fractions of the character box, never pixels — `replace` re-derives an asset's `w`/`h`
 * from new bytes, so a pixel offset would silently shift every aligned frame the moment
 * its background was cut out.
 */
export interface FrameFit {
	/** {x: 0, y: 0} leaves the art where it is. */
	offset: Frac2;
	/** Uniform. 1 fills the box. */
	scale: number;
}

export const DEFAULT_FIT: FrameFit = {offset: {x: 0, y: 0}, scale: 1};

/**
 * What a brand-new frame's rig starts as: a bubble above the shoulder, a mouth below it.
 *
 * Only a starting point. The whole reason anchors are per frame is that these two move —
 * a character who turns to face away, sits down, or is drawn in profile has their mouth
 * somewhere else, and a bubble pinned to one pose points at nothing in the next.
 */
export const DEFAULT_FRAME_ANCHORS: Readonly<Record<string, Frac2>> = {
	bubble: {x: 0.5, y: 0.15},
	mouth: {x: 0.5, y: 0.25}
};

export interface CharacterFrame {
	asset: AssetId;
	loop?: boolean;
	/** Absent means identity — every frame drawn before this existed. */
	fit?: FrameFit;
	/**
	 * Fractions of the character box. `bubble` is required for speech (D2).
	 *
	 * Per FRAME, not per character: the pose is what decides where a speech bubble belongs,
	 * and one rig for every pose puts the bubble over the back of a character's head the
	 * moment they turn around. Absent means the renderer's own fallbacks stand in, so a
	 * frame added and never rigged still draws a bubble somewhere sane.
	 */
	anchors?: Record<string, Frac2>;
}

export interface Character {
	id: string;
	name: string;
	/**
	 * This character's default look and placement, so a narrator is written once here
	 * rather than on every line they speak. A beat's own `as:`/`bubble:` merges over it.
	 */
	bubble?: BubbleStyle;
	size: {w: number; h: number};
	/** Fraction of the frame. Default {x:0.5,y:1} = feet, bottom centre. */
	origin: Frac2;
	frames: Record<string, CharacterFrame>;
	tags: string[];
}

export type AssetKind = 'bg' | 'object' | 'frame' | 'fx' | 'sound';

/** The kinds that are pictures. A `sound` has no pixels, so `w`/`h` mean nothing for it. */
export function isVisualKind(kind: AssetKind): boolean {
	return kind !== 'sound';
}

/** A crop rectangle, in source image pixels. */
export interface CropRect {
	x: number;
	y: number;
	w: number;
	h: number;
}

/**
 * What the asset editor's adjustment controls were set to when an asset was last saved.
 *
 * Stored on the asset rather than baked-and-forgotten so that re-opening an edited asset
 * finds its sliders where they were left, and so a second pass re-renders from the
 * original pixels instead of stacking on top of an already-baked, already-re-encoded
 * picture.
 */
export interface ImageEdits {
	/** -100 to 100. 0 leaves the image alone. */
	brightness: number;
	/** -100 to 100. 0 leaves the image alone. */
	contrast: number;
	/** 0.1 to 3. 1 leaves the image alone; above 1 lifts the midtones. */
	gamma: number;
	crop: CropRect;
	/** Output size in pixels. Starts out as the crop size. */
	width: number;
	height: number;
}

/**
 * The two knobs the cutout editor exposes, applied to a cached alpha map rather than to
 * the model, so re-tuning costs a composite instead of another two passes.
 */
export interface CutoutTuning {
	/**
	 * Where the line between keep and drop sits, 0 to 1. Lower keeps more of a
	 * hesitant mask; higher cuts more aggressively.
	 */
	threshold: number;
	/**
	 * How wide the transition around that line is. Near zero is a hard, jagged
	 * edge; wide leaves the model's own soft alpha almost untouched.
	 */
	softness: number;
	/**
	 * Swap what the cutout keeps for what it cut: the background survives and the
	 * subject goes. Applied after `threshold` and `softness`, so the edge it leaves is
	 * the same edge those two describe, read from the other side.
	 *
	 * Optional and absent when off, because it rides `AssetMeta` into sync — and it
	 * describes the model's alpha ALONE. Hand-drawn shapes are not touched by it; a
	 * shape that cut a hole still cuts one, which is what keeps the two halves of the
	 * mask independent.
	 */
	invert?: boolean;
}

/** Whether a hand-drawn shape forces its area transparent or forces it opaque. */
export type MaskOp = 'cut' | 'keep';

/**
 * One hand-drawn region of an asset's alpha — a closed polygon, nothing else.
 *
 * Shapes rather than pixels because a mask has to survive the edits around it. A painted
 * sidecar is invalid the moment the asset is recropped or resized, never syncs, and cannot
 * be re-opened to move one corner; fractions of the source image survive all three.
 */
export interface MaskShape {
	id: string;
	op: MaskOp;
	/**
	 * How far the edge fades, as a fraction of the image's short edge. 0 is a hard cut.
	 * Relative for the same reason the points are: a pixel radius would change meaning
	 * the moment new bytes gave the asset a different size.
	 */
	feather: number;
	/**
	 * Which side of the ring the shape acts on: absent or false for the inside, true for
	 * everything else in the image.
	 *
	 * An inverted `cut` is how an author keeps one region and drops the whole rest of the
	 * picture — the common case a plain cut needs four shapes to spell out. It pairs with
	 * `op` rather than replacing it: `op` is add-or-subtract, this is which area.
	 *
	 * Stored, not derived from the winding of `points`, even though drawing anticlockwise
	 * is what sets it. Winding is a property the author can destroy by accident: dragging
	 * one vertex across the shape reverses the signed area, and a mask that silently
	 * turned itself inside out under a corner drag would be unusable. It also keeps every
	 * shape drawn before this existed meaning exactly what it did.
	 */
	invert?: boolean;
	/**
	 * Fractions of the SOURCE image, rounded to three decimals like an anchor. The
	 * polygon closes itself — the last point is not repeated.
	 */
	points: Frac2[];
}

/**
 * The hand-drawn half of an asset's transparency.
 *
 * Kept independent of `tuning`, which describes the model's alpha: the two are composited
 * as `clamp(tuned + keep − cut, 0, 1)` so that dragging a tuning slider can never reshape
 * an edge that was drawn by hand.
 */
export interface AssetMask {
	shapes: MaskShape[];
}

/**
 * The sidecars this app writes today.
 *
 * `src` is the pixels an edit started from; `cutout` is the alpha map a background
 * removal produced. Both exist so an edit can be re-opened and redone rather than only
 * stacked on, and neither is ever read by the renderer — the asset's own bytes are
 * always the finished picture.
 *
 * `src` and not `source`: the kind IS the key suffix (`a_8f21.src`), so there is no
 * mapping table between the two to drift.
 */
export type KnownSidecarKind = 'src' | 'cutout';

/**
 * An extra blob an asset owns, stored beside its current bytes.
 *
 * Open, not a closed union: a feature that needs its own blob adds a kind without
 * touching this file. `KnownSidecarKind` keeps autocomplete for the two that ship.
 *
 * A kind must be a slug — `[a-z0-9][a-z0-9-]*`. It becomes a filename on both sides of
 * the wire, and it must never look like an asset id, which is `a_` plus hex.
 */
export type SidecarKind = KnownSidecarKind | (string & {});

/**
 * What the manifest records about one sidecar blob.
 *
 * The same `{bytes, hash}` pair an asset carries, deliberately: sync already diffs
 * assets on exactly that, so sidecars extend the existing diff rather than growing a
 * second one beside it that will drift.
 *
 * Every field is optional because a sidecar written before this existed has none of
 * them. Such an entry still names a blob that is really there — it just cannot be
 * diffed, so it never syncs until the next save rewrites it.
 */
export interface SidecarEntry {
	bytes?: number;
	/** SHA-256 of the blob, hex. Without one this sidecar cannot sync. */
	hash?: string;
	/** Backends key opaque strings and store no type, so it is recorded here. */
	mime?: string;
	/**
	 * Whether this blob rides along with the manifest to the server.
	 *
	 * Per kind, not per store: `cutout` is a few hundred KB and worth having on every
	 * device an author edits from, while `src` is the un-edited original — routinely
	 * 16 MB, and wanted by nothing but this device's own editor.
	 */
	sync?: boolean;
}

/**
 * An asset's sidecar index: which extra blobs it owns, and what is known about each.
 *
 * `Partial`, and it has to be: `SidecarKind` is two string literals beside an index
 * signature, so a bare `Record` of it makes `src` and `cutout` REQUIRED properties —
 * `{cutout: {}}` alone would not typecheck.
 */
export type SidecarEntries = Partial<Record<SidecarKind, SidecarEntry>>;

// ---------------------------------------------------------------------------
// Asset effects (spec 14)
// ---------------------------------------------------------------------------

/**
 * A live, animated look an asset carries wherever it is drawn.
 *
 * Only `glitch` so far. The kind is a discriminant rather than a flag because the second
 * effect will want its own parameters, and an `AssetEffect` with every family's knobs
 * flattened into it has no way to say which of them mean anything.
 */
export type EffectKind = 'glitch';

/**
 * Analogue video tearing: horizontal bands slide sideways, the colour channels come apart,
 * and the clean picture returns between bursts.
 *
 * Every parameter is 0..100 and unitless, which is the one decision here worth stating.
 * A tear measured in pixels looks right in the asset editor's preview and wrong on a 4K
 * stage — the same asset is drawn at a dozen sizes, so every distance is a fraction of the
 * art's own width and survives all of them.
 */
export interface GlitchEffect {
	kind: 'glitch';
	/** How far a band slides, 0 (still) to 100 (a quarter of the art's width). */
	amount: number;
	/** How many horizontal slices the picture is torn into, 1..12. */
	bands: number;
	/** Steps per second of the tear clock, 1..50. Low reads as mechanical, high as electrical. */
	speed: number;
	/** How far the colour channels come apart, 0..100 (up to 2% of the width each way). */
	split: number;
	/** Loop length in seconds, 0.4..8. Short loops hide their own repetition. */
	period: number;
	/**
	 * What share of the loop is corrupted, 0..100. The rest is the untouched picture, and
	 * that contrast is most of the effect: a permanently torn image reads as a broken file
	 * rather than as interference.
	 */
	burst: number;
	/** CRT line overlay, 0 (none) to 100. */
	scanlines: number;
	/** Snow over the picture, 0 (none) to 100. */
	noise: number;
}

/**
 * What an asset's effect is set to, or absent for the overwhelming majority that have none.
 *
 * Metadata, NOT a sidecar, and the distinction costs data when it is got wrong. A sidecar
 * is local to the device that made the edit and is stripped from bundles and from sync,
 * because it describes pixels a reader never needs. An effect is the opposite: it is an
 * instruction to whoever draws the asset, so it has to reach the player, every collaborator
 * and every bundle. It also never touches the bytes — `replace` overwrites `edits`, `mask`
 * and `tuning` because those describe a render that just changed, and must LEAVE an effect
 * alone for the same reason it leaves the name alone.
 */
export type AssetEffect = GlitchEffect;

export interface AssetMeta {
	id: AssetId;
	name: string;
	kind: AssetKind;
	tags: string[];
	animated: boolean;
	w: number;
	h: number;
	bytes: number;
	hash: string;
	mime: string;
	ownerCharacter?: string;
	/** Set when this asset came out of the asset editor, not an upload. */
	sourceAsset?: AssetId;
	/**
	 * Where this asset's art is pinned, as a fraction of its own pixels. A prop drawn at
	 * `at: {x, y}` puts THIS point on that scene position, and scaling grows the art about
	 * it, so a lamp post pinned at its base stays on the floor when it is resized.
	 *
	 * Absent means the default: bottom centre, the same feet-on-the-floor rule characters
	 * follow. It is metadata, not pixels — an edit that only moves the anchor leaves the
	 * bytes and the hash alone.
	 */
	origin?: Frac2;
	/**
	 * How long a `sound` runs, in seconds. Absent when it could not be measured — a decoder
	 * that will not read the file headless, say — so every reader must treat it as a label
	 * and never as timing the player depends on.
	 */
	duration?: number;
	/**
	 * What the asset editor's controls were set to when these bytes were baked.
	 *
	 * Present means the bytes are a render of the `source` sidecar through these settings,
	 * so re-opening the editor can restore the controls and redo the render from the
	 * original pixels. Absent means the bytes are simply what was uploaded.
	 */
	edits?: ImageEdits;
	/**
	 * What the cutout controls were set to. Meaningful only alongside a `cutout` sidecar,
	 * which holds the alpha the tuning is applied to.
	 */
	tuning?: CutoutTuning;
	/**
	 * Holes and patches drawn by hand, on top of whatever the cutout model produced.
	 *
	 * Metadata rather than a sidecar, so it rides sync and can be re-opened a shape at a
	 * time. Like `edits`, it only describes bytes that were rendered FROM the `src`
	 * sidecar — without that base the asset's own pixels already are the mask, and
	 * re-applying it would cut the same hole twice.
	 */
	mask?: AssetMask;
	/**
	 * The live look this asset is drawn with, or absent for no effect.
	 *
	 * Not a render of anything, which is what keeps it out of `replace`'s overwrite list and
	 * out of the importer's strip list: an effect describes how to DRAW these bytes, so it
	 * outlives every re-crop and travels in every bundle. See `AssetEffect`.
	 */
	effect?: AssetEffect;
	/**
	 * Which extra blobs this asset owns, and what is known about each. An explicit index
	 * rather than a probe, so that `remove` can delete them without any backend having to
	 * scan for keys by prefix.
	 *
	 * Never in a bundle: a reader needs the finished picture, not the pixels an edit
	 * started from. Over the wire only per entry, and only when `sync` says so — see
	 * `SidecarEntry`.
	 *
	 * Was a `SidecarKind[]`, and is read back as one: `migrateSidecars` turns the old
	 * array into entries that name the blob and nothing else.
	 */
	sidecars?: SidecarEntries;
}

/** Resolves asset ids to something a renderer can draw. */
export interface AssetResolver {
	url(id: AssetId): Promise<string | undefined>;
	meta(id: AssetId): Promise<AssetMeta | undefined>;
	character(id: string): Promise<Character | undefined>;
}

// ---------------------------------------------------------------------------
// Renderer contract (spec 02). measure() is what makes a 3D renderer possible.
// ---------------------------------------------------------------------------

export interface Renderer {
	mount(el: HTMLElement, assets: AssetResolver): Promise<void>;
	apply(stage: Stage, transitions: Transition[]): Promise<void>;
	/** Screen-space position of a named anchor, in px relative to the mount element. */
	measure(entityId: EntityId, anchor: string): Vec2 | null;
	destroy(): void;
	/**
	 * Fire a one-shot sound.
	 *
	 * Optional, and separate from `apply()` on purpose: `apply()` takes a STATE, and firing
	 * is not one — the stage after a door slams looks exactly like the stage before it. The
	 * caller is whoever is stepping beats, which is the player in the format and the
	 * scrubber in the editor.
	 */
	cue?(sound: StageSound): void;
	/** Silence, without forgetting what should be playing. Renderers without sound may omit. */
	setMuted?(muted: boolean): void;
}

// ---------------------------------------------------------------------------
// Passage names
// ---------------------------------------------------------------------------

export * from './passage-name';
export * from './bubble-fonts';
