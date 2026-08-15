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
	LAYERS,
	LAYER_BASELINE,
	type Beat,
	type Camera,
	type EntityKind,
	type EntityPatch,
	type Layer,
	type ParseResult,
	type Scene,
	type SceneError,
	type SceneErrorCode,
	type SceneLink,
	type StageEntity,
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
	'fx',
	'beats',
	'links'
] as const;

/** Keys accepted inside a `cast:` / `props:` entry. */
export const ENTITY_KEYS = [
	'at',
	'frame',
	'flip',
	'layer',
	'z',
	'opacity',
	'ref'
] as const;

/** Beat map keys that are commands rather than a speaker id. */
export const BEAT_COMMAND_KEYS = ['box', 'wait', 'fx', 'mark'] as const;

export const CAMERA_KEYS = ['at', 'zoom'] as const;

export const LINK_KEYS = ['to', 'if', 'icon', 'transition'] as const;

/** The single tag the subset permits: `cast: !only {…}`. */
const ONLY_TAG = '!only';

type EntityPatchBody = Partial<
	Pick<StageEntity, 'at' | 'frame' | 'flip' | 'layer' | 'z' | 'opacity'>
>;

interface Ctx {
	errors: SceneError[];
	lineCounter: LineCounter;
	/** `[[name]]` uses awaiting a links: entry, checked once the whole doc is parsed. */
	pendingLinks: {name: string; node: unknown}[];
	/** Inline `[[name -> Target]]` links, applied only where links: is silent. */
	inlineLinks: Map<string, string>;
	/** Where each links: entry was written, so a late error can point at it. */
	linkNodes: Map<string, unknown>;
	/** `mira: ~` nodes, legal only once we know whether `from:` was set. */
	pendingRemovals: {id: string; node: unknown}[];
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
 * A bare number leaves y at the layer baseline, which is y = 0 — the type contract keeps
 * Vec2 fully populated, so "y omitted" is materialized as 0 here rather than left absent.
 */
function parseAt(ctx: Ctx, node: unknown, what = 'at'): Vec2 | undefined {
	if (isScalar(node)) {
		const value = scalarValue(node);

		if (typeof value === 'number' && Number.isFinite(value)) {
			checkRange(ctx, value, 'x', node);
			// A bare number is x only; y snaps to the layer baseline (spec 02), which is
			// the floor, not the vertical centre.
			return {x: value, y: LAYER_BASELINE};
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
// Entities
// ---------------------------------------------------------------------------

interface EntityBody {
	patch: EntityPatchBody;
	ref?: string;
	say?: string;
	sayNode?: unknown;
}

/**
 * The shared body of `cast:`/`props:` entries and of beat patches. `allowSay` is what
 * separates the two: `say:` is only meaningful inside a beat.
 */
function parseEntityBody(ctx: Ctx, map: YAMLMap, allowSay: boolean): EntityBody {
	const body: EntityBody = {patch: {}};
	const valid = allowSay ? [...ENTITY_KEYS, 'say'] : ENTITY_KEYS;

	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const key = keyName(pair);

		if (key === undefined) {
			addError(ctx, 'bad-value', 'Keys must be plain text.', pair.key);
			continue;
		}

		switch (key) {
			case 'at': {
				const at = parseAt(ctx, pair.value);

				if (at) {
					body.patch.at = at;
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
						body.patch.layer = layer as Layer;
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

			default:
				addError(ctx, 'unknown-key', `Unknown key '${key}'.`, pair.key, {
					hint: keyHint(key, valid)
				});
		}
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

		const body = parseEntityBody(ctx, pair.value as YAMLMap, false);
		const patch: EntityPatch = {kind, ref: body.ref ?? id, ...body.patch};

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

function parseBeat(
	ctx: Ctx,
	key: string,
	pair: Pair<unknown, unknown>,
	index: number
): Beat | undefined {
	switch (key) {
		case 'box': {
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
				const body = parseEntityBody(ctx, pair.value as YAMLMap, true);
				const hasPatch = Object.keys(body.patch).length > 0;

				if (body.say !== undefined) {
					collectLinks(ctx, body.say, body.sayNode ?? pair.value);
					return {
						index,
						kind: 'say',
						text: body.say,
						who,
						...(hasPatch ? {patch: body.patch} : {})
					};
				}

				if (!hasPatch) {
					addError(
						ctx,
						'bad-value',
						`Beat for '${who}' changes nothing and says nothing.`,
						pair.value
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

export function parseScene(text: string): ParseResult {
	const scene = emptyScene();
	const lineCounter = new LineCounter();
	const ctx: Ctx = {
		errors: [],
		inlineLinks: new Map(),
		linkNodes: new Map(),
		lineCounter,
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
			case 'props': {
				const kind: EntityKind = key === 'cast' ? 'cast' : 'prop';

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
					} else {
						scene.replaceProps = true;
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

	return {errors: ctx.errors, scene};
}
