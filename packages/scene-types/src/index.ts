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

/** Layer set is fixed (D11). Order is back -> mid -> front. */
export const LAYERS = ['back', 'mid', 'front'] as const;
export type Layer = (typeof LAYERS)[number];

/**
 * Scene y of the layer baseline — the floor an entity stands on when the author writes
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

export type EntityKind = 'cast' | 'prop';

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
	/** Named frame for cast; ignored for simple props. */
	frame?: string;
	flip: boolean;
	layer: Layer;
	/** Explicit z within a layer. When undefined, z derives from y. */
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
}

export interface StageFx {
	id: string;
	amount: number;
}

export interface Camera {
	at: Vec2;
	zoom: number;
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
	camera: Camera;
	/** Keyed by entity id. Insertion order is not significant; z decides drawing. */
	entities: Record<EntityId, StageEntity>;
	fx: StageFx[];
}

export function emptyStage(): Stage {
	return {bg: undefined, camera: {at: {x: 0, y: 0}, zoom: 1}, entities: {}, fx: []};
}

// ---------------------------------------------------------------------------
// Beats — the timeline laid over the stage.
// ---------------------------------------------------------------------------

export type BeatKind = 'say' | 'box' | 'wait' | 'fx' | 'mark' | 'set';

export interface BeatBase {
	kind: BeatKind;
	/** Index in the scene's beat list. */
	index: number;
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

export interface SayBeat extends BeatBase {
	kind: 'say';
	who: EntityId;
	text: string;
	/** Stage mutations applied when this beat runs. */
	patch?: EntityPatchBody;
}

export interface BoxBeat extends BeatBase {
	kind: 'box';
	text: string;
}

export interface WaitBeat extends BeatBase {
	kind: 'wait';
	seconds: number;
}

export interface FxBeat extends BeatBase {
	kind: 'fx';
	fx: StageFx;
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

export type Beat = SayBeat | BoxBeat | WaitBeat | FxBeat | MarkBeat | SetBeat;

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
export interface Scene {
	id?: SceneId;
	/** `other-scene` | `other-scene@enter` | `other-scene@markName` */
	from?: string;
	bg?: AssetId | null;
	camera?: Partial<Camera>;
	/** Entity patches keyed by id. `null` means "remove this entity" (only valid with from). */
	entities: Record<EntityId, EntityPatch | null>;
	fx?: StageFx[];
	beats: Beat[];
	links: Record<string, SceneLink>;
	/** True when `cast: !only {...}` was used — replace rather than merge. */
	replaceCast?: boolean;
	replaceProps?: boolean;
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
	| 'frame'
	| 'flip'
	| 'bg'
	| 'camera'
	| 'fx';

export interface Transition {
	kind: TransitionKind;
	entityId?: EntityId;
	from?: unknown;
	to?: unknown;
	/** Seconds. 0 means snap. */
	duration: number;
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
	size: {w: number; h: number};
	/** Fraction of the frame. Default {x:0.5,y:1} = feet, bottom centre. */
	origin: Frac2;
	frames: Record<string, CharacterFrame>;
	tags: string[];
}

export type AssetKind = 'bg' | 'object' | 'frame' | 'fx';

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
}
