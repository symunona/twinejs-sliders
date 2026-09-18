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
 * What `layer:` desugars to. `mid` keeps the y-derived z, so it has no seed.
 *
 * The numbers match the space `resolveZ` documents: a derived z lands in 0..1, so -1 is
 * behind everything derived and 2 is in front of it.
 */
export const LAYER_Z: Record<Layer, number | undefined> = {
	back: -1,
	mid: undefined,
	front: 2
};

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
	 * Explicit draw order. When undefined, z derives from y — lower on screen is nearer, so
	 * it paints later. ONE space for the whole stage: there are no layers to cross.
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
	Omit<StageEntity, 'id' | 'kind' | 'ref' | 'of'>
> & {
	/**
	 * `of` is the one key a patch can also CLEAR. Everything else is set-or-inherit, but a
	 * patch scene that wants a child back in world space has no other way to say so — an
	 * absent key means "inherited" under `from:`, so omitting it keeps the parent. `null` is
	 * `of: ~` in the YAML, and detaches.
	 */
	of?: EntityId | null;
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
	'at',
	'w',
	'bg',
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
	/** Preset name, or any token the story's stylesheet defines. */
	as?: string;
	place?: BubblePlace;
	/**
	 * Explicit position: the bubble's CENTRE, in fractions of the stage box measured from
	 * its top left. Wins over `place`.
	 */
	at?: Frac2;
	/** Width as a fraction of the stage box's width. */
	w?: number;
	/** Background colour. Any CSS colour. */
	bg?: string;
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
	| 'unknown-variable'
	| 'unknown-parent'
	| 'of-cycle'
	| 'dupe-scene-id'
	| 'unknown-from'
	| 'from-cycle'
	| 'vars-separator'
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
