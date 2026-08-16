/**
 * Finding things in the block text, and nothing else.
 *
 * Everything here works off `parseDocument()` node ranges rather than regexes, because a
 * regex for `mira:` also matches `mira:` inside a beat's dialogue and inside a comment.
 * Ranges are the only source that agrees with what the parser saw.
 */

import {LineCounter, isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Document, Pair, Scalar, YAMLMap, YAMLSeq} from 'yaml';
import type {EntityKind} from '@sliders/scene-types';
import type {EntityTarget} from './types';

/** Top-level key order from spec 02. A new `props:` map is inserted into this order. */
export const TOP_LEVEL_ORDER = [
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

/** Beat keys that are commands, not speaker ids (spec 02, "Beats"). */
export const BEAT_COMMANDS = ['box', 'wait', 'fx', 'mark'] as const;

/**
 * Order used when a whole entity entry is written out.
 *
 * `ref` leads because it says what the thing IS; the rest follow the schema's own order so a
 * generated entry reads like a hand-written one. Must stay a superset of the schema's
 * `ENTITY_KEYS` — a key missing here is silently DROPPED by `addEntity`, which is how a
 * `scale:` from a resize handle went missing the first time. `entityKeyOrderCoversSchema`
 * in the tests is the tripwire.
 */
export const ENTITY_KEY_ORDER = [
	'ref',
	// Before `at`, because it says what `at` is measured from — reading `{of: table, at: …}`
	// in the other order means re-reading the coordinate once you reach the parent.
	'of',
	'at',
	'scale',
	'frame',
	'flip',
	'layer',
	'z',
	'opacity'
] as const;

export type NodeRange = [number, number, number];

export interface Parsed {
	text: string;
	doc: Document;
	root: YAMLMap;
	lineCounter: LineCounter;
}

/**
 * Parse, or give up quietly.
 *
 * The editor calls into this package on every keystroke, mid-word and mid-quote. It must
 * never throw and never assert: half-typed YAML is the normal case, not the error case.
 */
export function parseBlock(text: string): Parsed | undefined {
	try {
		const lineCounter = new LineCounter();
		const doc = parseDocument(text, {
			lineCounter,
			prettyErrors: false,
			version: '1.2'
		});

		if (!isMap(doc.contents)) {
			return undefined;
		}

		return {doc, lineCounter, root: doc.contents as YAMLMap, text};
	} catch {
		return undefined;
	}
}

export function rangeOf(node: unknown): NodeRange | undefined {
	const range = (node as {range?: NodeRange} | null | undefined)?.range;

	return Array.isArray(range) ? range : undefined;
}

export function keyName(pair: Pair<unknown, unknown>): string | undefined {
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

export function findPair(
	map: YAMLMap,
	key: string
): Pair<unknown, unknown> | undefined {
	return (map.items as Pair<unknown, unknown>[]).find(
		pair => keyName(pair) === key
	);
}

/** `cast` -> the `cast:` key, `prop` -> the `props:` key. */
export function mapKeyFor(kind: EntityKind): 'cast' | 'props' {
	return kind === 'cast' ? 'cast' : 'props';
}

/** The `cast:` / `props:` map node, when it exists and is actually a map. */
export function entityMapOf(
	parsed: Parsed,
	kind: EntityKind
): YAMLMap | undefined {
	const pair = findPair(parsed.root, mapKeyFor(kind));

	return pair && isMap(pair.value) ? (pair.value as YAMLMap) : undefined;
}

export function beatsSeqOf(parsed: Parsed): YAMLSeq | undefined {
	const pair = findPair(parsed.root, 'beats');

	return pair && isSeq(pair.value) ? (pair.value as YAMLSeq) : undefined;
}

export interface Located {
	/** The `id: {…}` pair, whether it lives under `cast:` or inside a beat. */
	pair: Pair<unknown, unknown>;
	/** The map the pair belongs to: the `cast:`/`props:` map, or the beat map. */
	container: YAMLMap;
}

/**
 * The entry a target names.
 *
 * A beat target that does not actually patch this entity returns undefined rather than
 * the wrong beat's entry — the caller then falls back to the `cast:` entry, which is what
 * the scrubber is showing anyway.
 */
export function locateEntity(
	parsed: Parsed,
	target: EntityTarget
): Located | undefined {
	if (target.beat !== undefined) {
		const beats = beatsSeqOf(parsed);
		const item = beats?.items[target.beat];

		if (!isMap(item)) {
			return undefined;
		}

		const map = item as YAMLMap;
		const first = (map.items as Pair<unknown, unknown>[])[0];

		if (!first) {
			return undefined;
		}

		const key = keyName(first);

		// `- wait: 0.5` and friends are commands, not entities. A caller that somehow asks
		// for `id: 'wait'` gets nothing rather than a write into the timeline.
		if (
			key === undefined ||
			key !== target.id ||
			(BEAT_COMMANDS as readonly string[]).includes(key)
		) {
			return undefined;
		}

		return {container: map, pair: first};
	}

	const map = entityMapOf(parsed, target.kind);

	if (!map) {
		return undefined;
	}

	const pair = findPair(map, target.id);

	return pair ? {container: map, pair} : undefined;
}

// ---------------------------------------------------------------------------
// Offsets
// ---------------------------------------------------------------------------

/**
 * Where a pair's written form ends: after its value, or after its key when the value is
 * absent. Deliberately `range[1]`, not `range[2]` — `range[2]` swallows the trailing
 * comment, and a splice that ends there deletes the author's note.
 */
export function pairEnd(pair: Pair<unknown, unknown>): number | undefined {
	const value = rangeOf(pair.value);

	if (value) {
		return value[1];
	}

	return rangeOf(pair.key)?.[1];
}

export function lineStartAt(text: string, offset: number): number {
	const nl = text.lastIndexOf('\n', Math.max(0, offset - 1));

	return nl === -1 ? 0 : nl + 1;
}

/** End of the line `offset` sits on, i.e. the index of its `\n` (or the text end). */
export function lineEndAt(text: string, offset: number): number {
	const nl = text.indexOf('\n', offset);

	return nl === -1 ? text.length : nl;
}

/** The leading whitespace of the line `offset` sits on — the indent to write siblings at. */
export function indentAt(text: string, offset: number): string {
	const start = lineStartAt(text, offset);
	const match = /^[ \t]*/.exec(text.slice(start, offset));

	return match ? match[0] : '';
}

/** Walk back over whitespace, so a range that ends on a newline reports the line before. */
export function trimEnd(text: string, end: number, floor: number): number {
	let at = end;

	while (at > floor && /\s/.test(text[at - 1])) {
		at--;
	}

	return at;
}
