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
	BUBBLE_KEYS,
	BUBBLE_PLACES,
	LAYERS,
	LAYER_BASELINE,
	LAYER_Z,
	type Beat,
	type BubblePlace,
	type BubbleStyle,
	type Camera,
	type EntityKind,
	type EntityPatch,
	type EntityPatchBody,
	type Frac2,
	type Layer,
	type ParseResult,
	type Scene,
	type SceneError,
	type SceneErrorCode,
	type SceneLink,
	type SceneSpan,
	type StageFx,
	type Vec2
} from '@sliders/scene-types';
import {keyHint} from './levenshtein';
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
	'beats',
	'links'
] as const;

/** Keys accepted inside a `cast:` / `props:` / `entities:` entry. */
export const ENTITY_KEYS = [
	'at',
	'of',
	'scale',
	'frame',
	'flip',
	'layer',
	'z',
	'opacity',
	'ref'
] as const;

/** Beat map keys that are commands rather than a speaker id. */
export const BEAT_COMMAND_KEYS = ['box', 'wait', 'fx', 'mark'] as const;

/** Keys accepted inside a `box:` map. The scalar form `box: "text"` stays the short way. */
export const BOX_KEYS = ['text', 'as', 'bubble'] as const;

/** Keys a beat may add to its speaker's entry beyond the entity keys. */
export const SAY_KEYS = ['say', 'as', 'bubble'] as const;

export const CAMERA_KEYS = ['at', 'zoom'] as const;

export const LINK_KEYS = ['to', 'if', 'icon', 'transition'] as const;

/** The single tag the subset permits: `cast: !only {…}`. */
const ONLY_TAG = '!only';

/**
 * Above this a sprite is many stage-heights tall, so the author almost certainly meant a
 * fraction. A warning, not an error — a deliberately huge prop is a legitimate effect.
 */
const MAX_SCALE = 10;

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
	options: {hint?: string; severity?: 'error' | 'warning'} = {}
): void {
	ctx.errors.push({
		code,
		hint: options.hint,
		message,
		severity: options.severity ?? 'error',
		...spanOf(ctx, node)
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

function asNumber(ctx: Ctx, node: unknown, what: string): number | undefined {
	const value = scalarValue(node);

	if (typeof value === 'number' && Number.isFinite(value)) {
		return value;
	}

	addError(ctx, 'bad-value', `${what} must be a number.`, node);
	return undefined;
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
			return String(value);
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

			case 'at': {
				const at = parseFrac2(ctx, pair.value, 'bubble at');

				if (at) {
					style.at = at;
				}

				break;
			}

			case 'w': {
				const w = asNumber(ctx, pair.value, 'w');

				if (w === undefined) {
					break;
				}

				if (w <= 0 || w > 1) {
					addError(
						ctx,
						'bad-value',
						`Bubble width of ${w} is outside 0 to 1.`,
						pair.value,
						{hint: 'w: is a fraction of the stage width. 0.4 is a wide bubble.'}
					);
					break;
				}

				style.w = w;
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
					hint: keyHint(key, BUBBLE_KEYS)
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
	/** Where `of:` was written, so a cycle found after the whole block is read can point at it. */
	ofNode?: unknown;
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
	const valid = allowSay ? [...ENTITY_KEYS, ...SAY_KEYS] : ENTITY_KEYS;
	/**
	 * Scanned up front because YAML map order is the author's, not ours: `{at: 0.4, of: table}`
	 * has to read the same as `{of: table, at: 0.4}`, and `at` is otherwise parsed before the
	 * `of` that changes what it means.
	 */
	const relative = (map.items as Pair<unknown, unknown>[]).some(
		pair =>
			keyName(pair) === 'of' &&
			!isNullNode(pair.value) &&
			typeof scalarValue(pair.value) === 'string'
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

				const parent = asString(ctx, pair.value, 'of');

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

			case 'frame': {
				const frame = asString(ctx, pair.value, 'frame');

				if (frame !== undefined) {
					body.patch.frame = frame;
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
							{hint: `Must be one of ${LAYERS.join(', ')}.`}
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
				const ref = asString(ctx, pair.value, 'ref');

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

			default:
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					hint: keyHint(key, valid)
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
					hint: keyHint(key, ['id', 'amount'])
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

		for (const extra of pairs.slice(1)) {
			addError(
				ctx,
				'bad-value',
				'A beat has exactly one key. Split this into two beats.',
				extra.key
			);
		}

		const pair = pairs[0];
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'A beat key must be plain text.', pair.key);
			continue;
		}

		const index = scene.beats.length;
		const beat = parseBeat(ctx, key, pair, index);

		if (beat) {
			scene.beats.push(beat);
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

			default:
				addError(ctx, 'unknown-key', `Unknown box key '${key}'.`, pair.key, {
					hint: keyHint(key, BOX_KEYS)
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
	return {index, kind: 'box', text, ...(style ? {style} : {})};
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
			const name = asString(ctx, pair.value, 'mark');

			return name === undefined ? undefined : {index, kind: 'mark', name};
		}

		case 'fx': {
			const fx = parseFxNode(ctx, pair.value);

			return fx === undefined ? undefined : {fx, index, kind: 'fx'};
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
					collectLinks(ctx, body.say, body.sayNode ?? pair.value);
					return {
						index,
						kind: 'say',
						text: body.say,
						who,
						...(hasPatch ? {patch: body.patch} : {}),
						...(body.style ? {style: body.style} : {})
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
							: undefined
					);
					return undefined;
				}

				return {index, kind: 'set', patch: body.patch, who};
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
			const to = asString(ctx, pair.value, `link '${name}'`);

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
				const value = asString(ctx, prop.value, `link ${key}`);

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
					hint: keyHint(key, LINK_KEYS)
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
				hint: keyHint(key, CAMERA_KEYS)
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
						hint: keyHint(
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

export function parseScene(text: string): ParseResult {
	const scene = emptyScene();
	const lineCounter = new LineCounter();
	const ctx: Ctx = {
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
				const id = asString(ctx, pair.value, 'id');

				if (id !== undefined) {
					scene.id = id;
				}

				break;
			}

			case 'from': {
				if (isNullNode(pair.value)) {
					break; // `from: ~` is the documented "no parent" placeholder.
				}

				const from = asString(ctx, pair.value, 'from');

				if (from !== undefined) {
					scene.from = from;
				}

				break;
			}

			case 'bg': {
				if (isNullNode(pair.value)) {
					scene.bg = null;
					break;
				}

				const bg = asString(ctx, pair.value, 'bg');

				if (bg !== undefined) {
					scene.bg = bg;
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
					hint: keyHint(key, TOP_LEVEL_KEYS)
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

	return {errors: ctx.errors, linkIfSpans, linkSpans, scene};
}
