/**
 * `parseScene` — text in, best-effort Scene + positioned errors out (spec 05).
 *
 * Two rules drive every decision in here:
 *
 *  1. A Scene is ALWAYS returned, however broken the input. The preview keeps rendering
 *     instead of blanking on every half-typed line.
 *  2. Every error carries a 1-indexed line/col derived from the YAML node range, so the
 *     editor can put a dot in the gutter and a squiggle under the range.
 */

import {LineCounter, isAlias, isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Pair, Scalar, YAMLMap, YAMLSeq} from 'yaml';
import {
	BUBBLE_ANCHORS,
	BUBBLE_KEYS,
	BUBBLE_PLACES,
	BUBBLE_SIZINGS,
	EASE_KINDS,
	EASE_NAMES,
	FRAME_LOOPS,
	LAYERS,
	LAYER_BASELINE,
	LAYER_Z,
	SCENE_LOCKS,
	easeValue,
	type Beat,
	type BeatEase,
	type BubbleAnchor,
	type BubblePlace,
	type BubbleSizing,
	type BubbleStyle,
	type Camera,
	type EntityKind,
	type EntityPatch,
	type EntityPatchBody,
	type Frac2,
	type FrameLoop,
	type FrameStep,
	type Layer,
	type ParseResult,
	type Scene,
	type SceneError,
	type SceneErrorCode,
	type SceneFix,
	type SceneLink,
	type SceneLock,
	type SceneSpan,
	type StageBgFx,
	type StageFx,
	type StageSound,
	type Vec2
} from '@sliders/scene-types';
import {RaggedBlockLine, raggedBlockLines} from './block-scalar';
import {keyFix} from './levenshtein';
import {scanWikiLinks} from './links';

export const TOP_LEVEL_KEYS = [
	'id',
	'from',
	'bg',
	'camera',
	'cast',
	'props',
	'entities',
	'fx',
	'music',
	'autoAdvance',
	'ease',
	'bubble',
	'locked',
	'beats',
	'links'
] as const;

/** Keys accepted inside a `cast:` / `props:` / `entities:` entry. */
export const ENTITY_KEYS = [
	'at',
	'of',
	'scale',
	'rot',
	'frame',
	'frameLoop',
	'flip',
	'layer',
	'z',
	'opacity',
	'ref'
] as const;

/**
 * Keys inside one step of a `frame:` list.
 *
 * `name` is the pose; the rest are the entity's own placement keys, meaning what they mean
 * on the entity. `of`, `z` and `ref` are deliberately NOT here: a cycle animates one sprite
 * in place, and a step that could re-parent or re-point it would be a beat wearing a
 * frame's clothes.
 */
export const FRAME_STEP_KEYS = [
	'name',
	'dur',
	'ease',
	'at',
	'scale',
	'rot',
	'flip',
	'opacity'
] as const;

/** Beat map keys that are commands rather than a speaker id. */
export const BEAT_COMMAND_KEYS = [
	'box',
	'wait',
	'fx',
	'sfx',
	'mark',
	'bg'
] as const;

/** Keys accepted inside a `box:` map. The scalar form `box: "text"` stays the short way. */
export const BOX_KEYS = [
	'text',
	'as',
	'bubble',
	'dur',
	'ease',
	'sfx',
	'bg'
] as const;

/** Keys a beat may add to its speaker's entry beyond the entity keys. */
export const SAY_KEYS = ['say', 'as', 'bubble'] as const;

/**
 * Keys a beat body accepts that belong neither to the entity nor to its speech.
 *
 * Kept apart from `SAY_KEYS` because a beat that only stages something (`- mira: {at: 0.3,
 * dur: 0.8}`) takes these and says nothing, and apart from `ENTITY_KEYS` because they must
 * stay an unknown key inside `cast:` / `props:` / `entities:` — timing belongs to a moment,
 * not to a sprite.
 *
 * Not `BEAT_KEYS`: that name is already a local in the format's `scene-mode.ts`.
 */
export const BEAT_BODY_KEYS = ['dur', 'ease', 'sfx', 'bg'] as const;

export const CAMERA_KEYS = ['at', 'zoom'] as const;

/** Keys inside the long form of a `music:` or `sfx:` entry. */
export const SOUND_KEYS = ['id', 'volume'] as const;

/**
 * Keys inside the long form of a `bg:` entry — `bg: {id: cellar, fx: parallax_left}`.
 *
 * The motion is spelled `fx:` because that is what the stage already calls a visual effect
 * (`fx: [rain@0.6]`), and `sfx:` next door is a SOUND. Guessing `sfx:` here is the one
 * wrong guess worth predicting, so it gets a hand-written hint rather than a typo fix.
 */
export const BG_KEYS = ['id', 'fx', 'speed'] as const;

export const LINK_KEYS = ['to', 'if', 'icon', 'transition'] as const;

/** The single tag the subset permits: `cast: !only {…}`. */
const ONLY_TAG = '!only';

/**
 * Above this a sprite is many stage-heights tall, so the author almost certainly meant a
 * fraction. A warning, not an error — a deliberately huge prop is a legitimate effect.
 */
const MAX_SCALE = 10;

/**
 * Past this a beat sits still for a minute, which is almost always seconds-vs-milliseconds.
 * A warning, not an error — a deliberately long hold is a legitimate effect.
 */
const MAX_DUR = 60;

/**
 * A rotation past a full turn draws exactly as `rot % 360` does, so writing one is almost
 * always a misunderstanding — an author reaching for a spin, which is a frame cycle's job,
 * not a pose's. A warning, not an error: the drawing is still well defined.
 */
const MAX_ROT = 360;

interface Ctx {
	errors: SceneError[];
	lineCounter: LineCounter;
	/** `[[name]]` uses awaiting a links: entry, checked once the whole doc is parsed. */
	pendingLinks: {name: string; node: unknown}[];
	/** Inline `[[name -> Target]]` links, applied only where links: is silent. */
	inlineLinks: Map<string, string>;
	/** Where each links: entry was written, so a late error can point at it. */
	linkNodes: Map<string, unknown>;
	/**
	 * Where each link's TARGET was written -- the `to:` value, or the beat text that
	 * carried an inline `[[name -> Target]]`. Reported as `linkSpans` so the editor can
	 * mark a target that names no passage; the parser itself has no story to check against.
	 */
	linkTargetNodes: Map<string, unknown>;
	/**
	 * Where each link's `if:` was written. Reported as `linkIfSpans` for the same reason
	 * the target spans are: a condition names story variables, and the parser has no story.
	 */
	linkIfNodes: Map<string, unknown>;
	/** Where each beat was written, in `scene.beats` order. Reported as `beatSpans`. */
	beatNodes: unknown[];
	/** `mira: ~` nodes, legal only once we know whether `from:` was set. */
	pendingRemovals: {id: string; node: unknown}[];
	/** `of:` edges declared in THIS block, with the node to point an error at. */
	ofEdges: {id: string; parent: string; node: unknown}[];
}

// ---------------------------------------------------------------------------
// Positions
// ---------------------------------------------------------------------------

interface Span {
	line: number;
	col: number;
	endLine?: number;
	endCol?: number;
}

function rangeOf(node: unknown): [number, number, number] | undefined {
	const range = (node as {range?: [number, number, number]} | null)?.range;

	return Array.isArray(range) ? range : undefined;
}

function spanOf(ctx: Ctx, node: unknown): Span {
	const range = rangeOf(node);

	if (!range) {
		return {col: 1, line: 1};
	}

	const start = ctx.lineCounter.linePos(range[0]);
	const end = ctx.lineCounter.linePos(range[1]);

	return {col: start.col, endCol: end.col, endLine: end.line, line: start.line};
}

function addError(
	ctx: Ctx,
	code: SceneErrorCode,
	message: string,
	node: unknown,
	options: {
		hint?: string;
		severity?: 'error' | 'warning';
		/**
		 * A mechanical repair, without its span. The span is the node's own — every caller
		 * that can offer a fix already points the error at the exact token to replace.
		 */
		fix?: Omit<SceneFix, keyof SceneSpan>;
	} = {}
): void {
	const span = spanOf(ctx, node);

	ctx.errors.push({
		code,
		fix: options.fix && {...options.fix, ...span},
		hint: options.hint,
		message,
		severity: options.severity ?? 'error',
		...span
	});
}

// ---------------------------------------------------------------------------
// Subset enforcement (spec 05, "The subset")
// ---------------------------------------------------------------------------

function checkSubset(ctx: Ctx, node: unknown, depth = 0): void {
	if (node === null || typeof node !== 'object' || depth > 64) {
		return;
	}

	if (isAlias(node)) {
		addError(
			ctx,
			'subset-violation',
			`Aliases ('*${node.source}') are not allowed in a scene block.`,
			node,
			{hint: 'Write the value out in full, or use `from:` to inherit a state.'}
		);
		return;
	}

	const anchor = (node as {anchor?: string}).anchor;

	if (anchor !== undefined) {
		addError(
			ctx,
			'subset-violation',
			`Anchors ('&${anchor}') are not allowed in a scene block.`,
			node,
			{hint: 'Use `from:` to reuse a state instead.'}
		);
	}

	const tag = (node as {tag?: string}).tag;

	if (tag !== undefined && tag !== ONLY_TAG) {
		addError(ctx, 'subset-violation', `Tags ('${tag}') are not allowed in a scene block.`, node);
	}

	if (isScalar(node) && (node as Scalar).type === 'BLOCK_FOLDED') {
		addError(
			ctx,
			'subset-violation',
			"Folded block scalars ('>') are not allowed in a scene block.",
			node,
			{hint: "Use a literal block scalar ('|') instead."}
		);
	}

	if (isMap(node)) {
		for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
			checkSubset(ctx, pair.key, depth + 1);
			checkSubset(ctx, pair.value, depth + 1);
		}
	} else if (isSeq(node)) {
		for (const item of (node as YAMLSeq).items) {
			checkSubset(ctx, item, depth + 1);
		}
	}
}

// ---------------------------------------------------------------------------
// Scalar helpers
// ---------------------------------------------------------------------------

function scalarValue(node: unknown): unknown {
	return isScalar(node) ? (node as Scalar).value : undefined;
}

function isNullNode(node: unknown): boolean {
	return node === null || (isScalar(node) && (node as Scalar).value === null);
}

function asString(ctx: Ctx, node: unknown, what: string): string | undefined {
	if (!isScalar(node)) {
		addError(ctx, 'bad-value', `${what} must be a single value.`, node);
		return undefined;
	}

	const value = scalarValue(node);

	if (typeof value === 'string') {
		return value;
	}

	if (typeof value === 'number' || typeof value === 'boolean') {
		return String(value);
	}

	addError(ctx, 'bad-value', `${what} must be text.`, node);
	return undefined;
}

/**
 * `asString`, but for a slot that NAMES something — a passage, a scene, an entity, an
 * asset. Takes the scalar's source text whenever YAML resolved it to a non-string.
 *
 * A passage called `04` is written `to: 04`, and the YAML 1.2 core schema reads that as
 * the NUMBER 4; `String(4)` is `"4"`, so the link quietly pointed at a passage nobody has.
 * The story map disagreed as well — its own line scanner reads raw text and drew the arrow
 * at `04` — so the arrow and the player went to different places. `007`, `1.50` and `True`
 * are all the same trap. Ordinary text (dialogue, `if:` expressions, style tokens) keeps
 * normal scalar resolution: only a name is allowed to ignore what YAML made of it.
 *
 * Only PLAIN scalars are read from source. `.source` on a quoted scalar has its quotes
 * stripped but its escapes still raw, and a plain scalar may fold over several lines, so
 * once YAML has produced a string that string is always the better answer.
 */
function asSourceString(
	ctx: Ctx,
	node: unknown,
	what: string
): string | undefined {
	if (isScalar(node)) {
		const scalar = node as Scalar;

		if (
			scalar.type === 'PLAIN' &&
			typeof scalar.source === 'string' &&
			typeof scalar.value !== 'string' &&
			scalar.value !== null
		) {
			return scalar.source;
		}
	}

	return asString(ctx, node, what);
}

function asNumber(ctx: Ctx, node: unknown, what: string): number | undefined {
	const value = scalarValue(node);

	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	addError(ctx, 'bad-value', `${what} must be a number.`, node);
	return undefined;
}

/**
 * `rot:` — degrees, clockwise, about the entity's own origin.
 *
 * Shared by the entity body and by one step of a frame cycle so the two can never disagree
 * about what a rotation is. Negative is anticlockwise and perfectly ordinary, so the only
 * thing worth saying is that a value past a whole turn draws as a smaller one.
 */
function parseRot(ctx: Ctx, node: unknown): number | undefined {
	const rot = asNumber(ctx, node, 'rot');

	if (rot === undefined) {
		return undefined;
	}

	if (Math.abs(rot) > MAX_ROT) {
		addError(
			ctx,
			'bad-value',
			`rot of ${rot} draws the same as ${rot % MAX_ROT}.`,
			node,
			{
				hint: 'rot is degrees clockwise about the entity origin. A spin is a frame cycle, not a pose.',
				severity: 'warning'
			}
		);
	}

	return rot;
}

function asBoolean(ctx: Ctx, node: unknown, what: string): boolean | undefined {
	const value = scalarValue(node);

	if (typeof value === 'boolean') {
		return value;
	}

	addError(ctx, 'bad-value', `${what} must be true or false.`, node);
	return undefined;
}

function keyName(pair: Pair<unknown, unknown>): string | undefined {
	const key = pair.key;

	if (isScalar(key)) {
		const value = (key as Scalar).value;

		if (typeof value === 'string') {
			return value;
		}

		if (typeof value === 'number' || typeof value === 'boolean') {
			// An entity id or link name of `04:` resolves to the number 4 — the same trap
			// asSourceString exists for. The text the author typed is the name they meant.
			const source = (key as Scalar).source;

			return (key as Scalar).type === 'PLAIN' && typeof source === 'string'
				? source
				: String(value);
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Coordinates (spec 02, "Coordinates")
// ---------------------------------------------------------------------------

function checkRange(ctx: Ctx, value: number, axis: 'x' | 'y', node: unknown): void {
	if (value < -1 || value > 1) {
		addError(
			ctx,
			'bad-coordinate',
			`${axis} of ${value} is outside the stage (-1 to 1).`,
			node,
			{
				hint: 'Coordinates are normalized: -1 is the left/bottom edge, +1 the right/top.',
				severity: 'warning'
			}
		);
	}
}

/**
 * `at: -0.4` (bare number, x only) or `at: [x, y]`.
 *
 * A bare number leaves y at `baseline` — the type contract keeps Vec2 fully populated, so
 * "y omitted" has to be materialized as a concrete number here rather than left absent.
 *
 * `baseline` is the layer baseline for an ordinary entity: the floor, not the vertical
 * centre. For an `of:` child it is ZERO, because the number is an OFFSET — "0.4 to my
 * parent's right", not "0.4 across and 0.85 below it". Baking the floor into an offset
 * drops every child a stage-height under its parent, which is off-screen for anything
 * standing on the floor already.
 */
function parseAt(
	ctx: Ctx,
	node: unknown,
	what = 'at',
	baseline = LAYER_BASELINE
): Vec2 | undefined {
	if (isScalar(node)) {
		const value = scalarValue(node);

		if (typeof value === 'number' && Number.isFinite(value)) {
			checkRange(ctx, value, 'x', node);
			// A bare number is x only; y snaps to the layer baseline (spec 02), which is
			// the floor, not the vertical centre.
			return {x: value, y: baseline};
		}

		addError(
			ctx,
			'bad-coordinate',
			`${what} must be a number or [x, y].`,
			node
		);
		return undefined;
	}

	if (isSeq(node)) {
		const items = (node as YAMLSeq).items;

		if (items.length !== 2) {
			addError(
				ctx,
				'bad-coordinate',
				`${what} must have exactly two numbers, [x, y].`,
				node
			);
			return undefined;
		}

		const x = scalarValue(items[0]);
		const y = scalarValue(items[1]);

		if (
			typeof x !== 'number' ||
			typeof y !== 'number' ||
			!Number.isFinite(x) ||
			!Number.isFinite(y)
		) {
			addError(ctx, 'bad-coordinate', `${what} must be two numbers, [x, y].`, node);
			return undefined;
		}

		checkRange(ctx, x, 'x', items[0]);
		checkRange(ctx, y, 'y', items[1]);
		return {x, y};
	}

	addError(ctx, 'bad-coordinate', `${what} must be a number or [x, y].`, node);
	return undefined;
}


// ---------------------------------------------------------------------------
// Bubble style
// ---------------------------------------------------------------------------

/** `at: [0.5, 0.2]` inside a `bubble:` — fractions of the stage box, not scene units. */
function parseFrac2(ctx: Ctx, node: unknown, what: string): Frac2 | undefined {
	if (!isSeq(node) || (node as YAMLSeq).items.length !== 2) {
		addError(ctx, 'bad-coordinate', `${what} must be two numbers, [x, y].`, node, {
			hint: 'Bubble positions are fractions of the stage box: [0, 0] is its top left.'
		});
		return undefined;
	}

	const items = (node as YAMLSeq).items;
	const x = asNumber(ctx, items[0], `${what} x`);
	const y = asNumber(ctx, items[1], `${what} y`);

	if (x === undefined || y === undefined) {
		return undefined;
	}

	return {x, y};
}

/**
 * `as: yell` or the long form `bubble: {as: yell, place: top, w: 0.4}`.
 *
 * An unknown `as:` token is NOT an error. Presets are the styles the renderer ships CSS
 * for, and a story is free to invent its own and paint them in its stylesheet — the token
 * reaches the DOM either way. `place:` is the opposite: it changes where the renderer puts
 * the bubble, so a typo there has to be caught.
 */
function parseBubbleStyle(
	ctx: Ctx,
	node: unknown,
	what: string
): BubbleStyle | undefined {
	if (isScalar(node)) {
		const token = asString(ctx, node, what);

		return token === undefined ? undefined : {as: token};
	}

	if (!isMap(node)) {
		addError(
			ctx,
			'bad-value',
			`${what} must be a style name or a map of style keys.`,
			node
		);
		return undefined;
	}

	const style: BubbleStyle = {};

	for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		switch (key) {
			case 'as': {
				const token = asString(ctx, pair.value, 'as');

				if (token !== undefined) {
					style.as = token;
				}

				break;
			}

			case 'place': {
				const place = asString(ctx, pair.value, 'place');

				if (place === undefined) {
					break;
				}

				if (!(BUBBLE_PLACES as readonly string[]).includes(place)) {
					addError(ctx, 'bad-value', `Unknown place '${place}'.`, pair.value, {
						hint: `place: is one of ${BUBBLE_PLACES.join(', ')}.`
					});
					break;
				}

				style.place = place as BubblePlace;
				break;
			}

			case 'anchor': {
				const anchor = asString(ctx, pair.value, 'anchor');

				if (anchor === undefined) {
					break;
				}

				if (!(BUBBLE_ANCHORS as readonly string[]).includes(anchor)) {
					addError(ctx, 'bad-value', `Unknown anchor '${anchor}'.`, pair.value, {
						hint: `anchor: is one of ${BUBBLE_ANCHORS.join(
							', '
						)}. 'scene' detaches the bubble from its speaker.`
					});
					break;
				}

				style.anchor = anchor as BubbleAnchor;
				break;
			}

			case 'sizing': {
				const sizing = asString(ctx, pair.value, 'sizing');

				if (sizing === undefined) {
					break;
				}

				if (!(BUBBLE_SIZINGS as readonly string[]).includes(sizing)) {
					addError(ctx, 'bad-value', `Unknown sizing '${sizing}'.`, pair.value, {
						hint:
							`sizing: is one of ${BUBBLE_SIZINGS.join(', ')}. ` +
							"'absolute' fixes the box to w x h of the stage and scales the text."
					});
					break;
				}

				style.sizing = sizing as BubbleSizing;
				break;
			}

			case 'at': {
				const at = parseFrac2(ctx, pair.value, 'bubble at');

				if (at) {
					style.at = at;
				}

				break;
			}

			case 'w':
			case 'h': {
				const value = asNumber(ctx, pair.value, key);

				if (value === undefined) {
					break;
				}

				if (value <= 0 || value > 1) {
					addError(
						ctx,
						'bad-value',
						`Bubble ${key === 'w' ? 'width' : 'height'} of ${value} is outside 0 to 1.`,
						pair.value,
						{
							hint:
								key === 'w'
									? 'w: is a fraction of the stage width. 0.4 is a wide bubble.'
									: 'h: is a fraction of the stage height, and only sizing: absolute reads it.'
						}
					);
					break;
				}

				style[key] = value;
				break;
			}

			case 'size': {
				const size = asNumber(ctx, pair.value, 'size');

				if (size === undefined) {
					break;
				}

				if (size <= 0) {
					addError(
						ctx,
						'bad-value',
						`Text size of ${size} is not a size.`,
						pair.value,
						{hint: 'size: multiplies the stage text size. 1 is normal.'}
					);
					break;
				}

				style.size = size;
				break;
			}

			case 'bg':
			case 'accent':
			case 'color':
			case 'font': {
				const value = asString(ctx, pair.value, key);

				if (value !== undefined) {
					style[key] = value;
				}

				break;
			}

			default:
				addError(ctx, 'unknown-key', `Unknown bubble key '${key}'.`, pair.key, {
					...keyFix(key, BUBBLE_KEYS)
				});
		}
	}

	return Object.keys(style).length > 0 ? style : undefined;
}

/** `as:` and `bubble:` land in the same object; whichever key is written later wins. */
function mergeBubbleStyle(
	base: BubbleStyle | undefined,
	extra: BubbleStyle | undefined
): BubbleStyle | undefined {
	if (!base) {
		return extra;
	}

	return extra ? {...base, ...extra} : base;
}

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

interface EntityBody {
	patch: EntityPatchBody;
	ref?: string;
	/**
	 * What a legacy `layer:` asked for, held back until the whole map is read.
	 *
	 * `layer:` is sugar for a `z` seed, and an explicit `z:` must beat it whichever order the
	 * author wrote the two keys in — YAML map order is the author's, not a precedence rule.
	 */
	layerZ?: number;
	say?: string;
	sayNode?: unknown;
	/** From `as:` and `bubble:`. Only a beat can carry these. */
	style?: BubbleStyle;
	/**
	 * From `dur:`. Only a beat can carry it.
	 *
	 * Deliberately NOT inside `patch`: `patch` is `Omit<StageEntity, …>`, so a `dur` there
	 * would be merged onto a live entity by `mergePatch`, and would make `hasPatch` true —
	 * turning `- mira: {dur: 1}` into a set beat that stages nothing.
	 */
	dur?: number;
	/** From `ease:`. Only a beat can carry it, for the same reason `dur` can. */
	ease?: BeatEase;
	/** From `sfx:`. Only a beat can carry it, for the same reason `dur` can. */
	sfx?: StageSound;
	/** From `bg:`. Only a beat can carry it: `cast:` names the backdrop at the top. */
	bg?: ParsedBg;
	/** Where `of:` was written, so a cycle found after the whole block is read can point at it. */
	ofNode?: unknown;
}

/**
 * A non-negative number of seconds, for the keys that name a length of time.
 *
 * `key` and `zeroHint` are the only things that differ between them: `dur: 0` snaps and
 * plays on, `autoAdvance: 0` waits for a click, and a message that named the wrong one
 * would send the author to the wrong key.
 */
function parseSeconds(
	ctx: Ctx,
	node: unknown,
	key: string,
	zeroHint: string
): number | undefined {
	const seconds = asNumber(ctx, node, key);

	if (seconds === undefined) {
		return undefined;
	}

	if (seconds < 0) {
		addError(ctx, 'bad-value', `${key} of ${seconds} is not a length of time.`, node, {
			hint: `${key}: is seconds. ${zeroHint}`
		});
		return undefined;
	}

	if (seconds > MAX_DUR) {
		addError(
			ctx,
			'bad-value',
			`${key} of ${seconds} holds the scene still for over ${MAX_DUR} seconds.`,
			node,
			{hint: `${key}: is seconds, not milliseconds.`, severity: 'warning'}
		);
	}

	return seconds;
}

/**
 * `dur:` — how long a beat holds the screen, in seconds.
 *
 * Shared by the beat body and by the `box:` map, which are the only two places that can
 * carry one. Zero is legal and means "snap, then move straight on"; the warning about a
 * `dur: 0` on a line of dialogue is the caller's job, since only it knows whether anything
 * is being read.
 */
function parseDur(ctx: Ctx, node: unknown): number | undefined {
	return parseSeconds(ctx, node, 'dur', 'dur: 0 snaps and moves straight on.');
}

/**
 * `locked:` — what a gesture must not change in this scene.
 *
 * `true` for the whole stage, or a list naming what is pinned. A bare `false` is accepted
 * and dropped rather than stored: it says the same thing as leaving the key out, and
 * carrying it would make "this scene unlocks the stage" look like a thing a scene can do to
 * somebody's preference, which it is not.
 */
function parseSceneLock(
	ctx: Ctx,
	node: unknown
): true | SceneLock[] | undefined {
	if (isScalar(node)) {
		const flag = asBoolean(ctx, node, 'locked');

		return flag === true ? true : undefined;
	}

	if (!isSeq(node)) {
		addError(ctx, 'bad-value', 'locked: takes true, or a list of what to lock.', node, {
			hint: `locked: true, or locked: [${SCENE_LOCKS.join(', ')}]`
		});
		return undefined;
	}

	const out: SceneLock[] = [];

	for (const item of (node as YAMLSeq).items) {
		const name = asString(ctx, item, 'locked');

		if (name === undefined) {
			continue;
		}

		if (!(SCENE_LOCKS as readonly string[]).includes(name)) {
			addError(ctx, 'bad-value', `'${name}' is not something to lock.`, item, {
				...keyFix(name, SCENE_LOCKS)
			});
			continue;
		}

		if (!out.includes(name as SceneLock)) {
			out.push(name as SceneLock);
		}
	}

	// `locked: []` locks nothing, which is what no key already says.
	return out.length > 0 ? out : undefined;
}

/**
 * One ease token, checked but never rejected.
 *
 * An unrecognised word is a WARNING with a typo fix, and the word is KEPT: the renderer
 * falls back to the kind's default (`cssEase`), so a mistyped curve costs the shape of one
 * movement and nothing else, and the text the author is looking at still matches the model
 * the editor is showing them. Unlike `bg: {fx: …}` or `bubble: {as: …}` there is no
 * stylesheet escape hatch to be careful of — a timing function is written inline, so an
 * unknown token can only be a typo or a curve spelled out in full, and `easeValue` already
 * knows the second one when it sees it.
 */
function parseEaseToken(
	ctx: Ctx,
	node: unknown,
	label: string
): string | undefined {
	const token = asString(ctx, node, label);

	if (token === undefined) {
		return undefined;
	}

	if (easeValue(token) === undefined) {
		addError(ctx, 'bad-value', `Unknown ease '${token}'.`, node, {
			...keyFix(token, EASE_NAMES),
			hint: `One of ${EASE_NAMES.join(
				', '
			)}, or a CSS timing function written out, e.g. cubic-bezier(0.34, 1.56, 0.64, 1).`,
			severity: 'warning'
		});
	}

	return token;
}

/**
 * `ease:` — one token for everything this beat moves, or one per transition kind.
 *
 * The map's keys are TRANSITION kinds, not entity keys, which is the one thing about this
 * key worth reading twice: `scale` names the transition a size change produces, and there
 * is deliberately no way to ease one entity differently from another in the same beat. A
 * beat is a moment; if two sprites need different curves they are two beats.
 */
function parseEase(
	ctx: Ctx,
	node: unknown,
	label: string
): BeatEase | undefined {
	if (isNullNode(node)) {
		return undefined; // `ease: ~` is "no opinion", same as leaving the key out.
	}

	if (isScalar(node)) {
		return parseEaseToken(ctx, node, label);
	}

	if (!isMap(node)) {
		addError(
			ctx,
			'bad-value',
			`${label}: is one ease, or a map of them by what is moving.`,
			node,
			{hint: `${label}: back_out, or ${label}: {move: back_out, scale: linear}`}
		);
		return undefined;
	}

	const out: Partial<Record<string, string>> = {};

	for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		if (!EASE_KINDS.includes(key as (typeof EASE_KINDS)[number])) {
			addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
				...keyFix(key, EASE_KINDS),
				hint: `An ease map is keyed by what is moving: ${EASE_KINDS.join(', ')}.`
			});
			continue;
		}

		const token = parseEaseToken(ctx, pair.value, `${label} ${key}`);

		if (token !== undefined) {
			out[key] = token;
		}
	}

	return Object.keys(out).length > 0 ? (out as BeatEase) : undefined;
}

/**
 * `frame:` written as a list — a cycle the renderer plays on its own clock.
 *
 * A bare scalar item is the short form of `{name: …}`, so a plain pose cycle stays a list
 * of names. `baseline` is the entity's own: a step's `at` means what the entity's `at`
 * means, which under `of:` is an offset from the parent and otherwise sits on the floor.
 */
function parseFrameSteps(
	ctx: Ctx,
	seq: YAMLSeq,
	baseline: number
): FrameStep[] {
	const out: FrameStep[] = [];

	for (const item of seq.items) {
		if (isScalar(item)) {
			const name = asSourceString(ctx, item, 'frame');

			if (name !== undefined) {
				out.push({name});
			}

			continue;
		}

		if (!isMap(item)) {
			addError(
				ctx,
				'bad-value',
				'A frame step is a name, or a map of properties.',
				item,
				{hint: 'frame: [walk_1, walk_2] or frame: [{name: walk_1, dur: 0.1}]'}
			);
			continue;
		}

		const step: Partial<FrameStep> = {};

		for (const pair of (item as YAMLMap).items as Pair<unknown, unknown>[]) {
			const key = keyName(pair);

			if (key === undefined) {
				addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
				continue;
			}

			switch (key) {
				case 'name': {
					const name = asSourceString(ctx, pair.value, 'frame name');

					if (name !== undefined) {
						step.name = name;
					}

					break;
				}

				case 'dur': {
					// Its own key name in its own errors: `dur` on a beat and `dur` on a step
					// are different lengths of time and the hint has to point at the right one.
					const dur = parseSeconds(
						ctx,
						pair.value,
						'dur',
						'A step is held for at least one screen frame.'
					);

					if (dur !== undefined) {
						step.dur = dur;
					}

					break;
				}

				case 'ease': {
					// Scalar only. A step is one change to one sprite over one hold, so
					// there is exactly one thing here to give a curve to; a per-kind map
					// would be asking which of one.
					const ease = parseEaseToken(ctx, pair.value, 'frame ease');

					if (ease !== undefined) {
						step.ease = ease;
					}

					break;
				}

				case 'at': {
					const at = parseAt(ctx, pair.value, 'at', baseline);

					if (at) {
						step.at = at;
					}

					break;
				}

				case 'scale': {
					const scale = asNumber(ctx, pair.value, 'scale');

					if (scale !== undefined) {
						if (scale <= 0) {
							addError(
								ctx,
								'bad-value',
								`scale of ${scale} is not a size.`,
								pair.value,
								{hint: 'scale multiplies the natural size. 1 is normal.'}
							);
							break;
						}

						step.scale = scale;
					}

					break;
				}

				case 'rot': {
					const rot = parseRot(ctx, pair.value);

					if (rot !== undefined) {
						step.rot = rot;
					}

					break;
				}

				case 'flip': {
					const flip = asBoolean(ctx, pair.value, 'flip');

					if (flip !== undefined) {
						step.flip = flip;
					}

					break;
				}

				case 'opacity': {
					const opacity = asNumber(ctx, pair.value, 'opacity');

					if (opacity !== undefined) {
						if (opacity < 0 || opacity > 1) {
							addError(
								ctx,
								'bad-value',
								`opacity of ${opacity} is outside 0..1.`,
								pair.value,
								{hint: '0 is invisible, 1 is solid.'}
							);
							break;
						}

						step.opacity = opacity;
					}

					break;
				}

				default:
					addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
						...keyFix(key, FRAME_STEP_KEYS)
					});
			}
		}

		if (step.name === undefined) {
			addError(ctx, 'bad-value', 'A frame step needs a name.', item, {
				hint: 'name: is the pose to draw, e.g. {name: walk_1, dur: 0.1}.'
			});
			continue;
		}

		out.push(step as FrameStep);
	}

	return out;
}

/**
 * The shared body of `cast:`/`props:` entries and of beat patches. `allowSay` is what
 * separates the two: `say:` is only meaningful inside a beat.
 */
function parseEntityBody(
	ctx: Ctx,
	map: YAMLMap,
	allowSay: boolean,
	selfId?: string
): EntityBody {
	const body: EntityBody = {patch: {}};
	const valid = allowSay
		? [...ENTITY_KEYS, ...SAY_KEYS, ...BEAT_BODY_KEYS]
		: ENTITY_KEYS;
	/**
	 * Scanned up front because YAML map order is the author's, not ours: `{at: 0.4, of: table}`
	 * has to read the same as `{of: table, at: 0.4}`, and `at` is otherwise parsed before the
	 * `of` that changes what it means.
	 */
	const relative = (map.items as Pair<unknown, unknown>[]).some(
		pair =>
			keyName(pair) === 'of' &&
			!isNullNode(pair.value) &&
			// Any non-null scalar, not just a resolved string: `of: 04` is a parent named
			// `04` (see asSourceString), and the baseline has to agree with what `of:` took.
			isScalar(pair.value)
	);
	const baseline = relative ? 0 : LAYER_BASELINE;

	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		switch (key) {
			case 'at': {
				const at = parseAt(ctx, pair.value, 'at', baseline);

				if (at) {
					body.patch.at = at;
				}

				break;
			}

			case 'of': {
				// `of: ~` detaches. Only a patch scene has anything to detach FROM, but that
				// is `mergePatch`'s business — writing it in a snapshot is harmless and says
				// exactly what is true, so it is not worth an error of its own.
				if (isNullNode(pair.value)) {
					body.patch.of = null;
					break;
				}

				const parent = asSourceString(ctx, pair.value, 'of');

				if (parent === undefined) {
					break;
				}

				if (parent === selfId) {
					addError(
						ctx,
						'of-cycle',
						`'${parent}' cannot be positioned relative to itself.`,
						pair.value,
						{hint: 'of: names a DIFFERENT entity to move with.'}
					);
					break;
				}

				body.patch.of = parent;
				body.ofNode = pair.value;
				break;
			}

			case 'scale': {
				const scale = asNumber(ctx, pair.value, 'scale');

				if (scale !== undefined) {
					// Zero or negative is an error, not a warning: the sprite vanishes or turns
					// inside out, which reads as a broken renderer rather than as bad input.
					if (scale <= 0) {
						addError(
							ctx,
							'bad-value',
							`scale of ${scale} is not a size.`,
							pair.value,
							{hint: 'scale multiplies the natural size. 1 is normal, 0.5 is half.'}
						);
						break;
					}

					if (scale > MAX_SCALE) {
						addError(
							ctx,
							'bad-value',
							`scale of ${scale} is far past the stage (up to ${MAX_SCALE}).`,
							pair.value,
							{
								hint: 'scale multiplies the natural size. 1 is normal, 0.5 is half.',
								severity: 'warning'
							}
						);
					}

					body.patch.scale = scale;
				}

				break;
			}

			case 'rot': {
				const rot = parseRot(ctx, pair.value);

				if (rot !== undefined) {
					body.patch.rot = rot;
				}

				break;
			}

			case 'frame': {
				// A list is a cycle. `frame` still carries the first step's name, so
				// everything that only ever wanted "which pose" — the differ, the frame
				// picker, the asset collectors — is untouched by animation.
				if (isSeq(pair.value)) {
					const steps = parseFrameSteps(
						ctx,
						pair.value as YAMLSeq,
						baseline
					);

					if (steps.length > 0) {
						body.patch.frames = steps;
						body.patch.frame = steps[0].name;
					}

					break;
				}

				const frame = asSourceString(ctx, pair.value, 'frame');

				if (frame !== undefined) {
					// No `frames`, deliberately: `frame:` is ONE key, so a patch that names
					// a still pose is a patch that stops a cycle. mergePatch reads the
					// absence, which keeps `frames: null` out of every ordinary patch.
					body.patch.frame = frame;
				}

				break;
			}

			case 'frameLoop': {
				const loop = asString(ctx, pair.value, 'frameLoop');

				if (loop === undefined) {
					break;
				}

				if ((FRAME_LOOPS as readonly string[]).includes(loop)) {
					body.patch.frameLoop = loop as FrameLoop;
				} else {
					addError(
						ctx,
						'bad-value',
						`Unknown frameLoop '${loop}'.`,
						pair.value,
						{
							...keyFix(loop, FRAME_LOOPS),
							hint: `Must be one of ${FRAME_LOOPS.join(', ')}.`
						}
					);
				}

				break;
			}

			case 'flip': {
				const flip = asBoolean(ctx, pair.value, 'flip');

				if (flip !== undefined) {
					body.patch.flip = flip;
				}

				break;
			}

			case 'layer': {
				const layer = asString(ctx, pair.value, 'layer');

				if (layer !== undefined) {
					if ((LAYERS as readonly string[]).includes(layer)) {
						// Sugar only. `mid` is the y-derived order, so it seeds nothing.
						body.layerZ = LAYER_Z[layer as Layer];
					} else {
						addError(
							ctx,
							'bad-layer',
							`Unknown layer '${layer}'.`,
							pair.value,
							{
								// The fix comes from the edit distance, the hint from the closed
								// set: naming all three is more use than guessing at one, and the
								// button is there for when the guess is right.
								...keyFix(layer, LAYERS),
								hint: `Must be one of ${LAYERS.join(', ')}.`
							}
						);
					}
				}

				break;
			}

			case 'z': {
				const z = asNumber(ctx, pair.value, 'z');

				if (z !== undefined) {
					body.patch.z = z;
				}

				break;
			}

			case 'opacity': {
				const opacity = asNumber(ctx, pair.value, 'opacity');

				if (opacity !== undefined) {
					if (opacity < 0 || opacity > 1) {
						addError(
							ctx,
							'bad-value',
							`opacity of ${opacity} is outside 0 to 1.`,
							pair.value,
							{severity: 'warning'}
						);
					}

					body.patch.opacity = opacity;
				}

				break;
			}

			case 'ref': {
				const ref = asSourceString(ctx, pair.value, 'ref');

				if (ref !== undefined) {
					body.ref = ref;
				}

				break;
			}

			case 'say': {
				if (!allowSay) {
					addError(
						ctx,
						'unknown-key',
						`Unknown key 'say'.`,
						pair.key,
						{hint: 'say: only belongs to a beat, not to cast: or props:.'}
					);
					break;
				}

				const say = asString(ctx, pair.value, 'say');

				if (say !== undefined) {
					body.say = say;
					body.sayNode = pair.value;
				}

				break;
			}

			case 'as':
			case 'bubble': {
				if (!allowSay) {
					addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
						hint: `${key}: styles a line of dialogue, so it only belongs to a beat.`
					});
					break;
				}

				body.style = mergeBubbleStyle(
					body.style,
					parseBubbleStyle(ctx, pair.value, key)
				);
				break;
			}

			case 'dur': {
				if (!allowSay) {
					addError(ctx, 'unknown-key', `Unknown key 'dur'.`, pair.key, {
						hint: 'dur: times one moment, so it only belongs to a beat.'
					});
					break;
				}

				body.dur = parseDur(ctx, pair.value);
				break;
			}

			case 'ease': {
				if (!allowSay) {
					addError(ctx, 'unknown-key', `Unknown key 'ease'.`, pair.key, {
						hint: 'ease: shapes one moment\u2019s movement, so it only belongs to a beat. For the whole scene, put it at the top.'
					});
					break;
				}

				body.ease = parseEase(ctx, pair.value, 'ease');
				break;
			}

			case 'sfx': {
				if (!allowSay) {
					addError(ctx, 'unknown-key', `Unknown key 'sfx'.`, pair.key, {
						hint: 'sfx: fires at a moment, so it only belongs to a beat.'
					});
					break;
				}

				body.sfx = parseSoundNode(ctx, pair.value, 'sfx');
				break;
			}

			case 'bg': {
				if (!allowSay) {
					addError(ctx, 'unknown-key', `Unknown key 'bg'.`, pair.key, {
						hint: 'bg: is the whole stage\'s, so it belongs at the top of the scene or on a beat.'
					});
					break;
				}

				body.bg = parseBgNode(ctx, pair.value, 'bg');
				break;
			}

			default:
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					...keyFix(key, valid)
				});
		}
	}

	// Desugar `layer:` last, so an explicit `z:` wins no matter which came first.
	if (body.patch.z === undefined && body.layerZ !== undefined) {
		body.patch.z = body.layerZ;
	}

	return body;
}

function parseEntityMap(
	ctx: Ctx,
	map: YAMLMap,
	kind: EntityKind,
	scene: Scene
): void {
	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const id = keyName(pair);

		if (id === undefined) {
			addError(ctx, 'bad-value', 'Entity ids must be plain text.', pair.key);
			continue;
		}

		if (isNullNode(pair.value)) {
			// Removal. Only legal with `from:`, which may be declared further down, so the
			// check is deferred to the end of the parse.
			scene.entities[id] = null;
			ctx.pendingRemovals.push({id, node: pair.value ?? pair.key});
			continue;
		}

		if (!isMap(pair.value)) {
			addError(
				ctx,
				'bad-value',
				`'${id}' must be a map of properties, e.g. {at: 0, frame: idle}.`,
				pair.value
			);
			continue;
		}

		const body = parseEntityBody(ctx, pair.value as YAMLMap, false, id);
		const patch: EntityPatch = {kind, ref: body.ref ?? id, ...body.patch};

		if (typeof body.patch.of === 'string') {
			ctx.ofEdges.push({id, node: body.ofNode, parent: body.patch.of});
		}

		scene.entities[id] = patch;
	}
}

// ---------------------------------------------------------------------------
// FX
// ---------------------------------------------------------------------------

/** `rain@0.6` or plain `rain` (amount 1). */
function parseFxToken(token: string): StageFx {
	const at = token.lastIndexOf('@');

	if (at > 0) {
		const amount = Number(token.slice(at + 1));

		if (Number.isFinite(amount)) {
			return {amount, id: token.slice(0, at)};
		}
	}

	return {amount: 1, id: token};
}

function parseFxNode(ctx: Ctx, node: unknown): StageFx | undefined {
	if (isScalar(node)) {
		const token = asString(ctx, node, 'fx');

		return token === undefined ? undefined : parseFxToken(token);
	}

	if (isMap(node)) {
		let id: string | undefined;
		let amount = 1;

		for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
			const key = keyName(pair);

			if (key === 'id') {
				id = asString(ctx, pair.value, 'fx id');
			} else if (key === 'amount') {
				amount = asNumber(ctx, pair.value, 'fx amount') ?? 1;
			} else if (key !== undefined) {
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					...keyFix(key, ['id', 'amount'])
				});
			}
		}

		if (id === undefined) {
			addError(ctx, 'bad-value', 'An fx entry needs an id.', node);
			return undefined;
		}

		return {amount, id};
	}

	addError(ctx, 'bad-value', 'An fx entry must be a name or {id, amount}.', node);
	return undefined;
}

// ---------------------------------------------------------------------------
// Sound
// ---------------------------------------------------------------------------

/**
 * `door-slam`, `rain@0.4`, or the long form `{id: rain, volume: 0.4}`.
 *
 * The `name@amount` half is `fx:`'s token, on purpose — an author who has written
 * `fx: [rain@0.6]` already knows how to turn a sound down. The long form spells the number
 * `volume:` rather than `amount:`, because that is what it is called everywhere a person
 * has ever turned one down, and the two forms never appear in the same line.
 *
 * `label` names the key in errors, so `music:` and `sfx:` each complain about themselves.
 */
function parseSoundNode(
	ctx: Ctx,
	node: unknown,
	label: string
): StageSound | undefined {
	if (isScalar(node)) {
		// asSourceString, not asString: a sound file called `04.mp3` is an asset named `04`,
		// and the YAML core schema would hand back the number 4 (see the `to: 04` note).
		const token = asSourceString(ctx, node, label);

		return token === undefined ? undefined : parseFxToken(token);
	}

	if (isMap(node)) {
		let id: string | undefined;
		let amount = 1;

		for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
			const key = keyName(pair);

			if (key === 'id') {
				id = asSourceString(ctx, pair.value, `${label} id`);
			} else if (key === 'volume') {
				amount = asNumber(ctx, pair.value, `${label} volume`) ?? 1;
			} else if (key === 'amount') {
				// The one wrong guess worth predicting: `fx:` spells this `amount`, and
				// levenshtein is nowhere near close enough to suggest `volume` for it.
				addError(ctx, 'unknown-key', `Unknown key 'amount'.`, pair.key, {
					hint: `A sound's is spelled volume: — ${label}: {id: …, volume: 0.4}.`
				});
			} else if (key !== undefined) {
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					...keyFix(key, SOUND_KEYS)
				});
			}
		}

		if (id === undefined) {
			addError(ctx, 'bad-value', `A ${label} entry needs an id.`, node, {
				hint: `${label}: {id: rain, volume: 0.4}`
			});
			return undefined;
		}

		return {amount, id};
	}

	addError(
		ctx,
		'bad-value',
		`${label}: must be a sound's name, e.g. \`${label}: rain\` or \`${label}: rain@0.4\`.`,
		node
	);
	return undefined;
}

// ---------------------------------------------------------------------------
// Backdrop
// ---------------------------------------------------------------------------

/** What a `bg:` line said: the art, and the motion it was given. */
interface ParsedBg {
	/** `null` is `bg: ~`, i.e. no backdrop at all. */
	id: string | null;
	fx?: StageBgFx;
}

/**
 * `cellar`, `~`, or the long form `{id: cellar, fx: parallax_left, speed: 20}`.
 *
 * One parser for all three places a backdrop can be named — the scene's own `bg:`, a beat
 * of its own, and a `bg:` riding on a line — so `- bg: {…}` cannot drift from `bg: {…}`.
 *
 * `label` names the key in errors, the way `parseSoundNode`'s does.
 */
function parseBgNode(
	ctx: Ctx,
	node: unknown,
	label: string
): ParsedBg | undefined {
	if (isNullNode(node)) {
		return {id: null};
	}

	if (isScalar(node)) {
		// asSourceString, not asString: a backdrop called `04.png` is an asset named `04`,
		// and the YAML core schema would hand back the number 4 (see the `to: 04` note).
		const id = asSourceString(ctx, node, label);

		return id === undefined ? undefined : {id};
	}

	if (isMap(node)) {
		let id: string | null | undefined;
		let fxId: string | undefined;
		let speed: number | undefined;

		for (const pair of (node as YAMLMap).items as Pair<unknown, unknown>[]) {
			const key = keyName(pair);

			if (key === 'id') {
				id = isNullNode(pair.value)
					? null
					: asSourceString(ctx, pair.value, `${label} id`);
			} else if (key === 'fx') {
				fxId = asSourceString(ctx, pair.value, `${label} fx`);
			} else if (key === 'speed') {
				const value = asNumber(ctx, pair.value, `${label} speed`);

				if (value !== undefined) {
					if (value <= 0) {
						addError(
							ctx,
							'bad-value',
							`${label} speed of ${value} is not a length of time.`,
							pair.value,
							{hint: 'speed: is the seconds one cycle of the motion takes.'}
						);
					} else {
						speed = value;
					}
				}
			} else if (key === 'sfx') {
				// The wrong guess worth predicting: `sfx:` is a SOUND everywhere else in a
				// scene, and levenshtein would happily "fix" it to the `fx:` that means
				// something else, with no word about which is which.
				addError(ctx, 'unknown-key', `Unknown key 'sfx'.`, pair.key, {
					hint: `A backdrop's motion is spelled fx: — ${label}: {id: …, fx: parallax_left}. sfx: is a sound.`
				});
			} else if (key !== undefined) {
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					...keyFix(key, BG_KEYS)
				});
			}
		}

		if (id === undefined) {
			addError(ctx, 'bad-value', `A ${label} entry needs an id.`, node, {
				hint: `${label}: {id: cellar, fx: parallax_left, speed: 20}`
			});
			return undefined;
		}

		if (fxId === undefined && speed !== undefined) {
			addError(
				ctx,
				'bad-value',
				`${label} speed has no motion to time.`,
				node,
				{
					hint: `Add one, e.g. ${label}: {id: …, fx: parallax_left, speed: ${speed}}.`,
					severity: 'warning'
				}
			);
		}

		return {
			id,
			...(fxId !== undefined
				? {fx: {id: fxId, ...(speed !== undefined ? {speed} : {})}}
				: {})
		};
	}

	addError(
		ctx,
		'bad-value',
		`${label}: must be a backdrop's name, e.g. \`${label}: cellar\` or \`${label}: {id: cellar, fx: parallax_left}\`.`,
		node
	);
	return undefined;
}

/**
 * The `bg`/`bgFx` pair a beat carries, spread into the beat object.
 *
 * `bg` may legitimately be `null` (`bg: ~` takes the backdrop away), so this cannot be the
 * usual `...(x ? {x} : {})` — a null would be dropped and the cut would silently not happen.
 */
function bgFields(bg: ParsedBg | undefined): {
	bg?: string | null;
	bgFx?: StageBgFx;
} {
	if (bg === undefined) {
		return {};
	}

	return {bg: bg.id, ...(bg.fx ? {bgFx: bg.fx} : {})};
}

// ---------------------------------------------------------------------------
// Beats
// ---------------------------------------------------------------------------

function collectLinks(ctx: Ctx, text: string, node: unknown): void {
	for (const link of scanWikiLinks(text)) {
		if (link.target !== undefined) {
			if (!ctx.inlineLinks.has(link.name)) {
				ctx.inlineLinks.set(link.name, link.target);
			}

			if (!ctx.linkTargetNodes.has(link.name)) {
				ctx.linkTargetNodes.set(link.name, node);
			}
		} else {
			ctx.pendingLinks.push({name: link.name, node});
		}
	}
}

/**
 * The commonest beat mistake: the speaker's body written one indent short, so YAML makes
 * it the speaker's SIBLINGS instead of the speaker's value.
 *
 *     - mira:
 *       at: [0.1, 0.2]     <- same column as `mira`, so a beat key of its own
 *       frame: idle
 *
 * Told apart from a genuine two-key beat (`- wait: 1` merged into `- mark: x`) by what the
 * extra keys ARE: every one of them belongs to an entity body, and the first key is a
 * speaker id rather than one of the beat commands, which take a value and never a body.
 */
function isExplodedBeat(key: string, extras: Pair<unknown, unknown>[]): boolean {
	if ((BEAT_COMMAND_KEYS as readonly string[]).includes(key)) {
		return false;
	}

	const bodyKeys: readonly string[] = [
		...ENTITY_KEYS,
		...SAY_KEYS,
		...BEAT_BODY_KEYS
	];

	return extras.every(extra => {
		const name = keyName(extra);

		return name !== undefined && bodyKeys.includes(name);
	});
}

function parseBeats(ctx: Ctx, seq: YAMLSeq, scene: Scene): void {
	for (const item of seq.items) {
		if (!isMap(item)) {
			addError(
				ctx,
				'bad-value',
				'A beat must be a map, e.g. `- mira: "…"` or `- wait: 0.5`.',
				item
			);
			continue;
		}

		const pairs = (item as YAMLMap).items as Pair<unknown, unknown>[];

		if (pairs.length === 0) {
			addError(ctx, 'bad-value', 'Empty beat.', item);
			continue;
		}

		const pair = pairs[0];
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'A beat key must be plain text.', pair.key);
			continue;
		}

		const extras = pairs.slice(1);

		if (extras.length > 0) {
			if (isExplodedBeat(key, extras)) {
				// One error, naming the real mistake. The three the generic path used to
				// produce ("two keys" twice, then "needs dialogue or a stage change") all
				// describe the SAME missing indent, and none of them says so.
				addError(
					ctx,
					'bad-value',
					`Indent these under \`${key}:\` — at this indent they are separate beat keys, not ${key}'s.`,
					extras[0].key,
					{
						hint: `Everything '${key}' does belongs one level deeper than \`${key}:\`.`
					}
				);

				// `mira:` alone is empty, and "needs dialogue or a stage change" is that
				// same indent again, not a second problem. Only the beat that DOES carry
				// something of its own is worth parsing on.
				if (isNullNode(pair.value)) {
					continue;
				}
			} else {
				for (const extra of extras) {
					addError(
						ctx,
						'bad-value',
						'A beat has exactly one key. Split this into two beats.',
						extra.key
					);
				}
			}
		}

		const index = scene.beats.length;
		const beat = parseBeat(ctx, key, pair, index);

		if (beat) {
			scene.beats.push(beat);
			// The whole `- …` item, not just its value: the highlight covers the beat as
			// the author sees it, dash and all.
			ctx.beatNodes.push(item);
		}
	}
}

/**
 * The long form of a narration beat: `box: {text: "…", as: narrator, bubble: {place: top}}`.
 *
 * Same shape as a say beat's map, minus the stage patch — a box has no speaker to move.
 */
function parseBoxMap(ctx: Ctx, map: YAMLMap, index: number): Beat | undefined {
	let text: string | undefined;
	let style: BubbleStyle | undefined;
	let textNode: unknown;
	let dur: number | undefined;
	let ease: BeatEase | undefined;
	let sfx: StageSound | undefined;
	let bg: ParsedBg | undefined;

	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		switch (key) {
			case 'text': {
				text = asString(ctx, pair.value, 'text');
				textNode = pair.value;
				break;
			}

			case 'as':
			case 'bubble': {
				style = mergeBubbleStyle(style, parseBubbleStyle(ctx, pair.value, key));
				break;
			}

			case 'dur': {
				dur = parseDur(ctx, pair.value);
				break;
			}

			case 'ease': {
				ease = parseEase(ctx, pair.value, 'ease');
				break;
			}

			case 'sfx': {
				sfx = parseSoundNode(ctx, pair.value, 'sfx');
				break;
			}

			case 'bg': {
				bg = parseBgNode(ctx, pair.value, 'bg');
				break;
			}

			default:
				addError(ctx, 'unknown-key', `Unknown box key '${key}'.`, pair.key, {
					...keyFix(key, BOX_KEYS)
				});
		}
	}

	if (text === undefined) {
		addError(ctx, 'bad-value', 'A box: map needs text.', map, {
			hint: 'box: {text: "The candle gutters.", as: narrator}'
		});
		return undefined;
	}

	collectLinks(ctx, text, textNode ?? map);
	return {
		index,
		kind: 'box',
		text,
		...(style ? {style} : {}),
		...(dur !== undefined ? {dur} : {}),
		...(ease !== undefined ? {ease} : {}),
		...(sfx ? {sfx} : {}),
		...bgFields(bg)
	};
}

function parseBeat(
	ctx: Ctx,
	key: string,
	pair: Pair<unknown, unknown>,
	index: number
): Beat | undefined {
	switch (key) {
		case 'box': {
			if (isMap(pair.value)) {
				return parseBoxMap(ctx, pair.value as YAMLMap, index);
			}

			const text = asString(ctx, pair.value, 'box');

			if (text === undefined) {
				return undefined;
			}

			collectLinks(ctx, text, pair.value);
			return {index, kind: 'box', text};
		}

		case 'wait': {
			const seconds = asNumber(ctx, pair.value, 'wait');

			return seconds === undefined
				? undefined
				: {index, kind: 'wait', seconds};
		}

		case 'mark': {
			const name = asSourceString(ctx, pair.value, 'mark');

			return name === undefined ? undefined : {index, kind: 'mark', name};
		}

		case 'fx': {
			const fx = parseFxNode(ctx, pair.value);

			return fx === undefined ? undefined : {fx, index, kind: 'fx'};
		}

		case 'sfx': {
			const sfx = parseSoundNode(ctx, pair.value, 'sfx');

			return sfx === undefined ? undefined : {index, kind: 'sfx', sfx};
		}

		case 'bg': {
			const bg = parseBgNode(ctx, pair.value, 'bg');

			return bg === undefined
				? undefined
				: {index, kind: 'bg', bg: bg.id, ...(bg.fx ? {bgFx: bg.fx} : {})};
		}

		default: {
			// Anything else is a speaker id.
			const who = key;

			if (isScalar(pair.value)) {
				if (isNullNode(pair.value)) {
					addError(
						ctx,
						'bad-value',
						`Beat for '${who}' needs dialogue or a stage change.`,
						pair.value
					);
					return undefined;
				}

				const text = asString(ctx, pair.value, `dialogue for '${who}'`);

				if (text === undefined) {
					return undefined;
				}

				collectLinks(ctx, text, pair.value);
				return {index, kind: 'say', text, who};
			}

			if (isMap(pair.value)) {
				const body = parseEntityBody(ctx, pair.value as YAMLMap, true, who);
				const hasPatch = Object.keys(body.patch).length > 0;

				if (body.say !== undefined) {
					// A line held for no time is read by nobody. Zero is meaningful on a beat
					// that only stages something -- snap, then straight on -- so the warning
					// belongs here rather than in parseDur.
					if (body.dur === 0) {
						addError(
							ctx,
							'bad-value',
							'dur: 0 shows this line for no time at all.',
							pair.value,
							{
								hint: 'Leave dur: off to wait for the reader.',
								severity: 'warning'
							}
						);
					}

					collectLinks(ctx, body.say, body.sayNode ?? pair.value);
					return {
						index,
						kind: 'say',
						text: body.say,
						who,
						...(hasPatch ? {patch: body.patch} : {}),
						...(body.style ? {style: body.style} : {}),
						...(body.dur !== undefined ? {dur: body.dur} : {}),
						...(body.ease !== undefined ? {ease: body.ease} : {}),
						...(body.sfx ? {sfx: body.sfx} : {}),
						...bgFields(body.bg)
					};
				}

				if (!hasPatch) {
					addError(
						ctx,
						'bad-value',
						`Beat for '${who}' changes nothing and says nothing.`,
						pair.value,
						body.style
							? {hint: 'A style needs a line to paint: add say: to this beat.'}
							: body.sfx
							? {
									// A sound belongs to the moment, not to whoever is standing
									// there, so a beat with nothing but `sfx:` has a speaker for
									// no reason. The beat form says the same thing and is shorter.
									hint: `A sound needs no speaker: write \`- sfx: ${body.sfx.id}\` as its own beat.`
							  }
							: body.bg
							? {
									// Same shape as the sfx hint: a backdrop belongs to the
									// stage, not to whoever happens to be standing on it.
									hint: `A backdrop needs no speaker: write \`- bg: ${
										body.bg.id ?? '~'
									}\` as its own beat.`
							  }
							: body.dur !== undefined
							? {hint: 'dur: times a beat, it cannot be the whole of one.'}
							: body.ease !== undefined
							? {
									// Same shape as the dur hint: a curve shapes a movement,
									// so a beat with nothing but a curve shapes nothing.
									hint: 'ease: shapes a beat\u2019s movement, it cannot be the whole of one.'
							  }
							: undefined
					);
					return undefined;
				}

				return {
					index,
					kind: 'set',
					patch: body.patch,
					who,
					...(body.dur !== undefined ? {dur: body.dur} : {}),
					...(body.ease !== undefined ? {ease: body.ease} : {}),
					...(body.sfx ? {sfx: body.sfx} : {}),
					...bgFields(body.bg)
				};
			}

			addError(
				ctx,
				'bad-value',
				`Beat for '${who}' must be dialogue or a map of stage changes.`,
				pair.value
			);
			return undefined;
		}
	}
}

// ---------------------------------------------------------------------------
// Links + camera
// ---------------------------------------------------------------------------

function parseLinks(ctx: Ctx, map: YAMLMap, scene: Scene): void {
	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const name = keyName(pair);

		if (name === undefined) {
			addError(ctx, 'bad-value', 'Link names must be plain text.', pair.key);
			continue;
		}

		if (isScalar(pair.value) && !isNullNode(pair.value)) {
			// Shorthand: `stay: Tavern Fight`.
			const to = asSourceString(ctx, pair.value, `link '${name}'`);

			if (to !== undefined) {
				scene.links[name] = {name, to};
				ctx.linkTargetNodes.set(name, pair.value);
			}

			continue;
		}

		if (!isMap(pair.value)) {
			addError(
				ctx,
				'bad-value',
				`Link '${name}' must be a target or a map of link properties.`,
				pair.value
			);
			continue;
		}

		const link: SceneLink = {name, to: ''};

		for (const prop of (pair.value as YAMLMap).items as Pair<unknown, unknown>[]) {
			const key = keyName(prop);

			if (key === undefined) {
				addError(ctx, 'bad-value', 'Link property names must be plain text.', prop.key);
				continue;
			}

			if ((LINK_KEYS as readonly string[]).includes(key)) {
				// `to:` names a passage, the other three are text the player reads or an
				// expression it evaluates.
				const value =
					key === 'to'
						? asSourceString(ctx, prop.value, 'link to')
						: asString(ctx, prop.value, `link ${key}`);

				if (value !== undefined) {
					link[key as 'to' | 'if' | 'icon' | 'transition'] = value;

					if (key === 'to') {
						ctx.linkTargetNodes.set(name, prop.value);
					} else if (key === 'if') {
						ctx.linkIfNodes.set(name, prop.value);
					}
				}
			} else {
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, prop.key, {
					...keyFix(key, LINK_KEYS)
				});
			}
		}

		// A missing `to:` is not an error yet — an inline `[[name -> Target]]` in beat
		// text may still supply it. Checked once, after the inline merge below.
		ctx.linkNodes.set(name, pair.value);
		scene.links[name] = link;
	}
}

function parseCamera(ctx: Ctx, map: YAMLMap): Partial<Camera> {
	const camera: Partial<Camera> = {};

	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === 'at') {
			const at = parseAt(ctx, pair.value, 'camera at');

			if (at) {
				camera.at = at;
			}
		} else if (key === 'zoom') {
			const zoom = asNumber(ctx, pair.value, 'camera zoom');

			if (zoom !== undefined) {
				camera.zoom = zoom;
			}
		} else if (key !== undefined) {
			addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
				...keyFix(key, CAMERA_KEYS)
			});
		}
	}

	return camera;
}

// ---------------------------------------------------------------------------
// Entry point
// ---------------------------------------------------------------------------

export function emptyScene(): Scene {
	return {beats: [], entities: {}, links: {}};
}

/**
 * What the parser can say about `of:` once the whole block has been read.
 *
 * Both checks are SOUND but INCOMPLETE, on purpose. One block is not the whole graph: with
 * `from:`, an entity's parent may be inherited from another passage entirely, and the
 * parser has no index. So it reports only what is certain from this text alone, and
 * `resolveStage` carries the net for everything else — an unresolvable parent there just
 * leaves the entity in world space rather than breaking the render.
 */
function checkOfEdges(ctx: Ctx, scene: Scene): void {
	// A snapshot scene IS its whole cast, so a parent that is not in it is definitely a typo.
	// A patch scene inherits, so silence is the only correct answer there.
	if (scene.from === undefined) {
		for (const edge of ctx.ofEdges) {
			const parent = scene.entities[edge.parent];

			if (parent === undefined || parent === null) {
				addError(
					ctx,
					'unknown-parent',
					`'${edge.id}' is positioned relative to '${edge.parent}', which is not on stage.`,
					edge.node,
					{
						...keyFix(
							edge.parent,
							Object.keys(scene.entities).filter(id => id !== edge.id)
						)
					}
				);
			}
		}
	}

	// Cycles among the edges written HERE. Following them into inherited entities is not
	// possible without the index, but a loop closed inside one block survives any merge —
	// a patch overrides the key it names — so flagging it is never a false positive.
	const edgeOf = new Map(ctx.ofEdges.map(edge => [edge.id, edge]));

	for (const edge of ctx.ofEdges) {
		const seen = new Set<string>([edge.id]);
		let cursor: string | undefined = edge.parent;

		while (cursor !== undefined) {
			if (seen.has(cursor)) {
				addError(
					ctx,
					'of-cycle',
					`'${edge.id}' is positioned relative to itself, through '${cursor}'.`,
					edge.node,
					{hint: 'of: chains must not loop. One of them has to sit in world space.'}
				);
				break;
			}

			seen.add(cursor);
			cursor = edgeOf.get(cursor)?.parent;
		}
	}
}

/**
 * One error for a line that fell out of the block scalar above it, replacing the three or
 * four YAML complaints it causes. See `block-scalar.ts`.
 */
function raggedBlockError(ragged: RaggedBlockLine): SceneError {
	return {
		code: 'yaml-syntax',
		col: ragged.col,
		endCol: ragged.col + 1,
		fix: {
			col: 1,
			endCol: ragged.col,
			label: 'Indent to match the block',
			line: ragged.line,
			replaces: ragged.indentText,
			text: ' '.repeat(ragged.blockIndent)
		},
		hint: `Every line of a \`|\` block shares one indent — the first line's. Indent this one to column ${
			ragged.blockIndent + 1
		}, or move it out to where \`${ragged.key}:\` sits.`,
		line: ragged.line,
		message: `This line is indented less than the text block above, so it is not part of \`${ragged.key}:\` — and too far in to be anything else.`,
		severity: 'error'
	};
}

export function parseScene(text: string): ParseResult {
	const ragged = raggedBlockLines(text);
	const result = parseSceneDoc(text);

	if (ragged.length === 0) {
		return result;
	}

	// Everything reported on one of these lines is downstream of the indent: the scalar
	// ended early, so the rest of the line was read as structure. Including a beat error
	// about a beat the author never wrote.
	const lines = new Set(ragged.map(entry => entry.line));

	return {
		...result,
		errors: [
			...result.errors.filter(error => !lines.has(error.line)),
			...ragged.map(raggedBlockError)
		].sort((a, b) => a.line - b.line || a.col - b.col)
	};
}

function parseSceneDoc(text: string): ParseResult {
	const scene = emptyScene();
	const lineCounter = new LineCounter();
	const ctx: Ctx = {
		beatNodes: [],
		errors: [],
		inlineLinks: new Map(),
		linkIfNodes: new Map(),
		linkNodes: new Map(),
		linkTargetNodes: new Map(),
		lineCounter,
		ofEdges: [],
		pendingLinks: [],
		pendingRemovals: []
	};

	let doc;

	try {
		doc = parseDocument(text, {lineCounter, prettyErrors: false, version: '1.2'});
	} catch (error) {
		// parseDocument is not supposed to throw, but a best-effort Scene beats a crash.
		ctx.errors.push({
			code: 'yaml-syntax',
			col: 1,
			line: 1,
			message: error instanceof Error ? error.message : String(error),
			severity: 'error'
		});
		return {errors: ctx.errors, scene};
	}

	for (const error of doc.errors) {
		const start = lineCounter.linePos(error.pos[0]);
		const end = lineCounter.linePos(error.pos[1]);

		ctx.errors.push({
			code: error.code === 'MULTIPLE_DOCS' ? 'subset-violation' : 'yaml-syntax',
			col: start.col,
			endCol: end.col,
			endLine: end.line,
			hint:
				error.code === 'MULTIPLE_DOCS'
					? 'A scene block holds exactly one document. Remove the `---` separator.'
					: undefined,
			line: start.line,
			message: error.message,
			severity: 'error'
		});
	}

	const contents = doc.contents;

	if (contents === null || (isScalar(contents) && scalarValue(contents) === null)) {
		return {errors: ctx.errors, scene}; // Empty block: nothing to say about it.
	}

	if (!isMap(contents)) {
		addError(ctx, 'bad-value', 'A scene block must be a map of keys.', contents);
		return {errors: ctx.errors, scene};
	}

	checkSubset(ctx, contents);

	for (const pair of (contents as YAMLMap).items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		switch (key) {
			case 'id': {
				const id = asSourceString(ctx, pair.value, 'id');

				if (id !== undefined) {
					scene.id = id;
				}

				break;
			}

			case 'from': {
				if (isNullNode(pair.value)) {
					break; // `from: ~` is the documented "no parent" placeholder.
				}

				const from = asSourceString(ctx, pair.value, 'from');

				if (from !== undefined) {
					scene.from = from;
				}

				break;
			}

			case 'bg': {
				const bg = parseBgNode(ctx, pair.value, 'bg');

				if (bg !== undefined) {
					scene.bg = bg.id;
					scene.bgFx = bg.fx;
				}

				break;
			}

			case 'camera': {
				if (isMap(pair.value)) {
					scene.camera = parseCamera(ctx, pair.value as YAMLMap);
				} else if (!isNullNode(pair.value)) {
					addError(
						ctx,
						'bad-value',
						'camera must be a map, e.g. {at: [0, 0], zoom: 1}.',
						pair.value
					);
				}

				break;
			}

			case 'cast':
			case 'props':
			case 'entities': {
				// `entities:` declares no kind. The parser has no asset store, so it cannot
				// tell a character id from an asset name — `auto` defers that to whoever does.
				const kind: EntityKind =
					key === 'cast' ? 'cast' : key === 'props' ? 'prop' : 'auto';

				if (isNullNode(pair.value)) {
					break;
				}

				if (!isMap(pair.value)) {
					addError(ctx, 'bad-value', `${key} must be a map of ids.`, pair.value);
					break;
				}

				if ((pair.value as YAMLMap).tag === ONLY_TAG) {
					if (key === 'cast') {
						scene.replaceCast = true;
					} else if (key === 'props') {
						scene.replaceProps = true;
					} else {
						scene.replaceEntities = true;
					}
				}

				parseEntityMap(ctx, pair.value as YAMLMap, kind, scene);
				break;
			}

			case 'fx': {
				if (isNullNode(pair.value)) {
					scene.fx = [];
					break;
				}

				if (!isSeq(pair.value)) {
					addError(ctx, 'bad-value', 'fx must be a list, e.g. [rain@0.6].', pair.value);
					break;
				}

				const fx: StageFx[] = [];

				for (const item of (pair.value as YAMLSeq).items) {
					const parsed = parseFxNode(ctx, item);

					if (parsed) {
						fx.push(parsed);
					}
				}

				scene.fx = fx;
				break;
			}

			case 'music': {
				// `music: ~` is silence stated out loud, the same shape `bg: ~` has. Under
				// `from:` it is the only way to turn an inherited bed off, since an absent
				// key there means inherit.
				if (isNullNode(pair.value)) {
					scene.music = null;
					break;
				}

				scene.music = parseSoundNode(ctx, pair.value, 'music');
				break;
			}

			case 'autoAdvance': {
				if (isNullNode(pair.value)) {
					break; // `autoAdvance: ~` is "no opinion", i.e. leave it to the reader.
				}

				const seconds = parseSeconds(
					ctx,
					pair.value,
					'autoAdvance',
					'autoAdvance: 0 waits for a click.'
				);

				if (seconds !== undefined) {
					scene.autoAdvance = seconds;
				}

				break;
			}

			case 'ease': {
				const ease = parseEase(ctx, pair.value, 'ease');

				if (ease !== undefined) {
					scene.ease = ease;
				}

				break;
			}

			case 'bubble': {
				// Scene-wide defaults for every line. Merged UNDER a character's own
				// `bubble:` and under a beat's keys, so this never takes a look away
				// from a speaker who states one — see `Scene.bubble`.
				const style = parseBubbleStyle(ctx, pair.value, 'bubble');

				if (style) {
					scene.bubble = style;
				}

				break;
			}

			case 'locked': {
				if (isNullNode(pair.value)) {
					break; // `locked: ~` is "no opinion", i.e. leave it to the preference.
				}

				const locked = parseSceneLock(ctx, pair.value);

				if (locked !== undefined) {
					scene.locked = locked;
				}

				break;
			}

			case 'beats': {
				if (isNullNode(pair.value)) {
					break;
				}

				if (!isSeq(pair.value)) {
					addError(ctx, 'bad-value', 'beats must be a list.', pair.value);
					break;
				}

				parseBeats(ctx, pair.value as YAMLSeq, scene);
				break;
			}

			case 'links': {
				if (isNullNode(pair.value)) {
					break;
				}

				if (!isMap(pair.value)) {
					addError(ctx, 'bad-value', 'links must be a map of names.', pair.value);
					break;
				}

				parseLinks(ctx, pair.value as YAMLMap, scene);
				break;
			}

			default:
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					...keyFix(key, TOP_LEVEL_KEYS)
				});
		}
	}

	// Inline `[[name -> Target]]` creates links: entries that don't exist, and supplies
	// the target for entries that carry only presentation props. Writing the target
	// inline is the idiom, because Twine's own editor parses [[...]] out of the passage
	// source to draw the story map and auto-create passages.
	for (const [name, to] of ctx.inlineLinks) {
		const existing = scene.links[name];

		if (existing === undefined) {
			scene.links[name] = {name, to};
		} else if (!existing.to) {
			existing.to = to;
		}
	}

	for (const link of Object.values(scene.links)) {
		if (!link.to) {
			addError(
				ctx,
				'bad-value',
				`Link '${link.name}' has no 'to:' target.`,
				ctx.linkNodes.get(link.name),
				{
					hint: `Add 'to:' under links:, or write [[${link.name} -> Target]] in a beat.`
				}
			);
		}
	}

	for (const pending of ctx.pendingLinks) {
		if (scene.links[pending.name] === undefined) {
			addError(
				ctx,
				'unknown-link',
				`[[${pending.name}]] has no target.`,
				pending.node,
				{
					hint: `Add '${pending.name}: {to: …}' under links:, or write [[${pending.name} -> Target]].`
				}
			);
		}
	}

	checkOfEdges(ctx, scene);

	if (scene.from === undefined) {
		for (const removal of ctx.pendingRemovals) {
			addError(
				ctx,
				'bad-value',
				`'${removal.id}: ~' removes an entity, which only makes sense with 'from:'.`,
				removal.node,
				{
					hint: 'Without from:, a scene is a complete snapshot — just leave the entity out.'
				}
			);
		}
	}

	const linkSpans: Record<string, SceneSpan> = {};

	for (const [name, node] of ctx.linkTargetNodes) {
		if (scene.links[name]) {
			linkSpans[name] = spanOf(ctx, node);
		}
	}

	const linkIfSpans: Record<string, SceneSpan> = {};

	for (const [name, node] of ctx.linkIfNodes) {
		if (scene.links[name]) {
			linkIfSpans[name] = spanOf(ctx, node);
		}
	}

	return {
		beatSpans: ctx.beatNodes.map(node => spanOf(ctx, node)),
		errors: ctx.errors,
		linkIfSpans,
		linkSpans,
		scene
	};
}
