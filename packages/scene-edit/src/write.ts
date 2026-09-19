/**
 * The two-tier write strategy (spec 07, "write-back without wrecking the file").
 *
 *   tier 1 — the key already exists: take the VALUE node's range and splice just that span.
 *            Comments, key order, quote style, blank lines and flow-vs-block formatting are
 *            not merely preserved, they are never touched.
 *   tier 2 — the key is missing, or a whole entry is added or removed: still a splice, but
 *            of the smallest enclosing thing (one pair, one line, one map). Never of the
 *            whole block.
 *
 * There is no tier 3. A `parseDocument -> mutate -> toString()` of the entire document is
 * what destroys comments and reflows the file, and an author who loses their director's
 * notes to a drag stops using the tool that afternoon.
 */

import {isMap, isScalar} from 'yaml';
import type {Pair, Scalar, YAMLMap} from 'yaml';
import type {EntityId, EntityKind, EntityPatch} from '@sliders/scene-types';
import {formatNumber, formatValue} from './format';
import {
	BEAT_COMMANDS,
	ENTITY_KEY_ORDER,
	TOP_LEVEL_ORDER,
	type NodeRange,
	beatsSeqOf,
	entityMapOf,
	findPair,
	indentAt,
	keyName,
	lineEndAt,
	lineStartAt,
	locateEntity,
	mapKeyFor,
	pairEnd,
	parseBlock,
	rangeOf,
	trimEnd,
	type Parsed
} from './locate';
import type {EntityTarget, TextEdit} from './types';

// ---------------------------------------------------------------------------
// Splice primitives
// ---------------------------------------------------------------------------

/**
 * Fold disjoint splices into one, spanning from the first to the last.
 *
 * The text between two edits is re-inserted unchanged, so a gesture that touches three
 * entries is still ONE edit — which is what the editor needs (one gesture, one undo, one
 * `replaceRange`) and what `removeEntities` needs to answer "was that the last entry?" once
 * instead of once per id.
 *
 * Returns undefined if the edits overlap, rather than splicing garbage.
 */
export function mergeEdits(
	text: string,
	edits: TextEdit[]
): TextEdit | undefined {
	const sorted = [...edits].sort((a, b) => a.from - b.from);

	if (sorted.length === 0) {
		return undefined;
	}

	let at = sorted[0].from;
	let insert = '';

	for (const edit of sorted) {
		if (edit.from < at) {
			return undefined;
		}

		insert += text.slice(at, edit.from) + edit.insert;
		at = edit.to;
	}

	return {from: sorted[0].from, insert, to: at};
}

/** `key:` is written but the value is still being typed — put it after the colon. */
export function insertValueAfterKey(
	text: string,
	pair: Pair<unknown, unknown>,
	formatted: string
): TextEdit | undefined {
	const keyRange = rangeOf(pair.key);

	if (!keyRange) {
		return undefined;
	}

	const colon = text.indexOf(':', keyRange[1]);
	let at = colon === -1 ? keyRange[1] : colon + 1;
	let separator = ' ';

	// `mira: ` already has the space. Writing another gives `mira:  {…}`.
	if (text[at] === ' ') {
		at++;
		separator = '';
	}

	return {from: at, insert: `${separator}${formatted}`, to: at};
}

/**
 * A new `key: value` inside an existing map, matching that map's style.
 *
 * Flow stays inline (`{at: -0.4, scale: 1.15}`); block gets its own line at the map's own
 * indentation. Getting this backwards produces YAML that still parses but reads as if a
 * machine had been through the file, which is the thing this package exists to avoid.
 */
function insertIntoMap(
	parsed: Parsed,
	map: YAMLMap,
	key: string,
	formatted: string
): TextEdit | undefined {
	const {text} = parsed;
	const items = map.items as Pair<unknown, unknown>[];

	if (map.flow) {
		if (items.length === 0) {
			const mapRange = rangeOf(map);
			const open = mapRange ? text.indexOf('{', mapRange[0]) : -1;

			return open === -1
				? undefined
				: {from: open + 1, insert: `${key}: ${formatted}`, to: open + 1};
		}

		const end = pairEnd(items[items.length - 1]);

		return end === undefined
			? undefined
			: {from: end, insert: `, ${key}: ${formatted}`, to: end};
	}

	if (items.length === 0) {
		return undefined;
	}

	const firstKey = rangeOf(items[0].key);
	const end = pairEnd(items[items.length - 1]);

	if (!firstKey || end === undefined) {
		return undefined;
	}

	// Go to the end of the LINE, not the end of the value: a trailing `# comment` belongs
	// to the pair above and must stay above the new one. `trimEnd` first, because a nested
	// block map's range runs past its last newline — without it the new key lands after the
	// blank line that separates the next section.
	const at = lineEndAt(text, trimEnd(text, end, firstKey[0]));

	return {
		from: at,
		insert: `\n${indentAt(text, firstKey[0])}${key}: ${formatted}`,
		to: at
	};
}

/** Delete one pair from a map, taking its separator (flow) or its whole line (block). */
export function removePairEdit(
	parsed: Parsed,
	map: YAMLMap,
	pair: Pair<unknown, unknown>
): TextEdit | undefined {
	const {text} = parsed;
	const keyRange = rangeOf(pair.key);
	const end = pairEnd(pair);

	if (!keyRange || end === undefined) {
		return undefined;
	}

	if (map.flow) {
		let from = keyRange[0];
		let to = end;
		let after = to;

		while (after < text.length && /[ \t]/.test(text[after])) {
			after++;
		}

		if (text[after] === ',') {
			// Take the comma that follows, plus the space after it: `{at: 0, }` is legal
			// YAML but nobody writes it.
			after++;

			while (after < text.length && /[ \t]/.test(text[after])) {
				after++;
			}

			to = after;
		} else {
			let before = from;

			while (before > 0 && /[ \t]/.test(text[before - 1])) {
				before--;
			}

			if (text[before - 1] === ',') {
				before--;

				while (before > 0 && /[ \t]/.test(text[before - 1])) {
					before--;
				}

				from = before;
			}
		}

		return {from, insert: '', to};
	}

	// In a block map the pair owns its whole line, trailing comment included — that comment
	// annotates the value being deleted, so it goes too.
	return {
		from: lineStartAt(text, keyRange[0]),
		insert: '',
		to: Math.min(
			text.length,
			lineEndAt(text, trimEnd(text, end, keyRange[0])) + 1
		)
	};
}

// ---------------------------------------------------------------------------
// setEntityKey / removeEntityKey
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Promoting a bare dialogue beat
// ---------------------------------------------------------------------------

/**
 * Can this scalar's SOURCE sit inside a flow map (`{say: …, at: …}`) unchanged?
 *
 * Two ways it cannot. A block scalar (`|`, `>`) carries its text on the lines BELOW the
 * indicator, which a flow map has no room for; and a plain multi-word scalar may hold the
 * flow indicators `,{}[]`, which would end the value early — `- bob: Hello, world` promoted
 * naively becomes a map with a key called `world`.
 *
 * A quoted scalar is safe whatever is inside it, as long as it is one line.
 */
function flowSafeScalar(source: string): boolean {
	if (source.includes('\n') || /^[|>]/.test(source)) {
		return false;
	}

	return /^["']/.test(source) || !/[,{}[\]]/.test(source);
}

/** Re-indent a block scalar's content (or a folded scalar's continuation lines). */
function shiftLines(lines: string[], indent: string): string[] {
	const body = lines.filter(line => line.trim() !== '');
	const base = Math.min(
		...body.map(line => line.length - line.trimStart().length)
	);

	return lines.map(line =>
		line.trim() === ''
			? ''
			: indent + ' '.repeat(line.length - line.trimStart().length - base) +
			  line.trimStart()
	);
}

/**
 * `- bob: |` plus a stage key. The flow form cannot hold a block scalar, so the beat
 * becomes a block map instead, with the dialogue kept verbatim and moved one level in.
 *
 *     - bob:                          - bob: |
 *         say: |                          Hello.
 *           Hello.            <--
 *         at: [0.1, 0]
 *
 * The content is re-indented as a whole, so a line the author indented further stays
 * further in. Everything else about it — quoting, trailing spaces, blank lines — is the
 * author's and is carried across untouched.
 */
function promoteToBlock(
	text: string,
	pair: Pair<unknown, unknown>,
	range: NodeRange,
	entries: readonly (readonly [string, string])[]
): TextEdit {
	const keyRange = rangeOf(pair.key);
	// The COLUMN of the key, not the line's leading whitespace: a beat's key sits after
	// `- `, and anything under it must be indented past the key itself.
	const keyStart = keyRange ? keyRange[0] : range[0];
	const childIndent = ' '.repeat(keyStart - lineStartAt(text, keyStart) + 2);
	const source = text.slice(range[0], range[1]);
	const trailing = source.endsWith('\n') ? '\n' : '';
	const [first, ...rest] = source.replace(/\n+$/, '').split('\n');
	const value =
		rest.length === 0
			? first
			: [first, ...shiftLines(rest, childIndent + '  ')].join('\n');

	// Back over the spaces after the colon, so the promoted line does not keep a stray one.
	let from = range[0];

	while (from > 0 && text[from - 1] === ' ') {
		from--;
	}

	return {
		from,
		insert:
			'\n' +
			entries
				.map(([key, formatted], index) =>
					index === 0
						? `${childIndent}${key}: ${value}`
						: `${childIndent}${key}: ${formatted}`
				)
				.join('\n') +
			trailing,
		to: range[1]
	};
}

/**
 * A bare dialogue beat gaining its first key: `- bob: "Hi."` -> `- bob: {say: "Hi.", …}`.
 *
 * The dialogue is carried across as its ORIGINAL source text, so `'single'` stays
 * single-quoted and an escaped `\"` stays escaped — re-serializing the parsed string would
 * quietly rewrite the author's prose. When that source cannot live in a flow map, the beat
 * is promoted to block form instead; see `promoteToBlock`.
 */
function promoteScalarBeat(
	text: string,
	pair: Pair<unknown, unknown>,
	textKey: string,
	entries: readonly (readonly [string, string])[]
): TextEdit | undefined {
	const range = rangeOf(pair.value);

	if (!range) {
		return undefined;
	}

	const source = text.slice(range[0], range[1]);
	const all = [[textKey, source] as const, ...entries];

	if (!flowSafeScalar(source)) {
		return promoteToBlock(text, pair, range, all);
	}

	return {
		from: range[0],
		insert: `{${all.map(([key, value]) => `${key}: ${value}`).join(', ')}}`,
		to: range[1]
	};
}

function writeKey(
	parsed: Parsed,
	pair: Pair<unknown, unknown>,
	key: string,
	formatted: string,
	inBeat: boolean
): TextEdit | undefined {
	const {text} = parsed;
	const body = pair.value;

	if (isMap(body)) {
		const map = body as YAMLMap;
		const existing = findPair(map, key);

		if (!existing) {
			return insertIntoMap(parsed, map, key, formatted);
		}

		const valueRange = rangeOf(existing.value);

		// Tier 1. This single line is the whole promise of the package.
		return valueRange
			? {from: valueRange[0], insert: formatted, to: valueRange[1]}
			: insertValueAfterKey(text, existing, formatted);
	}

	const valueRange = rangeOf(body);
	const scalar = isScalar(body) ? (body as Scalar).value : null;

	// `- mira: "Get out."` — a bare dialogue beat. Adding a stage key means promoting it to
	// `{say: "…", at: …}` (spec 02, "Beats").
	if (inBeat && typeof scalar === 'string' && valueRange) {
		return promoteScalarBeat(text, pair, 'say', [[key, formatted]]);
	}

	// `mira: ~` — an explicit removal being dragged back onto the stage.
	if (valueRange && valueRange[0] < valueRange[1]) {
		return {
			from: valueRange[0],
			insert: `{${key}: ${formatted}}`,
			to: valueRange[1]
		};
	}

	return insertValueAfterKey(text, pair, `{${key}: ${formatted}}`);
}

/** Change or add one key on an entity. undefined when the entry does not exist. */
export function setEntityKey(
	text: string,
	target: EntityTarget,
	key: string,
	value: unknown
): TextEdit | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const located = locateEntity(parsed, target);

	if (!located) {
		return undefined;
	}

	return writeKey(
		parsed,
		located.pair,
		key,
		formatValue(key, value, {relative: hasParent(located.pair)}),
		target.beat !== undefined
	);
}

/**
 * Does this entry declare an `of:` parent? That changes what a bare `at:` means, so it
 * changes how one is written.
 *
 * Read off the entry being written rather than passed in by the caller: the text is the
 * source of truth, and a caller's idea of the graph is one more thing that can disagree
 * with it. An `of` inherited through `from:` is invisible here, which is why the editor
 * writes an explicit pair for those — see spec 02.
 */
function hasParent(pair: Pair<unknown, unknown>): boolean {
	if (!isMap(pair.value)) {
		return false;
	}

	const of = findPair(pair.value as YAMLMap, 'of');

	return !!of && typeof (of.value as Scalar | undefined)?.value === 'string';
}

/** Remove one key from an entity entry — how `scale: 1` and `flip: false` go away. */
export function removeEntityKey(
	text: string,
	target: EntityTarget,
	key: string
): TextEdit | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const located = locateEntity(parsed, target);

	if (!located || !isMap(located.pair.value)) {
		return undefined;
	}

	const map = located.pair.value as YAMLMap;
	const pair = findPair(map, key);

	return pair ? removePairEdit(parsed, map, pair) : undefined;
}

// ---------------------------------------------------------------------------
// addEntity / removeEntity
// ---------------------------------------------------------------------------

/** `{at: -0.4, frame: idle}` — the flow form spec 02 uses for every entity example. */
function formatEntityBody(id: EntityId, patch: EntityPatch): string {
	const source = patch as unknown as Record<string, unknown>;
	const parts: string[] = [];
	// A new entry carries its own `of:`, so unlike `setEntityKey` this can be read straight
	// off the patch rather than out of the text.
	const relative = typeof source.of === 'string';

	for (const key of ENTITY_KEY_ORDER) {
		const value = source[key];

		if (value === undefined) {
			continue;
		}

		// `ref` defaults to the entity id, so writing `mira: {ref: mira}` is pure noise.
		if (key === 'ref' && value === id) {
			continue;
		}

		parts.push(`${key}: ${formatValue(key, value, {relative})}`);
	}

	return `{${parts.join(', ')}}`;
}

/** Whatever the file already indents nested maps by. Guessing 2 would fight a 4-space file. */
function detectIndent(parsed: Parsed): string {
	for (const pair of parsed.root.items as Pair<unknown, unknown>[]) {
		const value = pair.value;

		if (!isMap(value) || (value as YAMLMap).flow) {
			continue;
		}

		const first = (value as YAMLMap).items[0] as
			Pair<unknown, unknown> | undefined;
		const range = first && rangeOf(first.key);
		const indent = range && indentAt(parsed.text, range[0]);

		if (indent) {
			return indent;
		}
	}

	return '  ';
}

/**
 * Put a brand-new top-level key in its conventional slot (spec 02's key table), by landing
 * it after the last key that sorts before it. Appending blindly gives `beats:` … `props:`,
 * which parses fine and reads like the file was generated.
 */
export function insertTopLevelKey(
	parsed: Parsed,
	key: string,
	block: string
): TextEdit {
	const {text} = parsed;
	const mine = (TOP_LEVEL_ORDER as readonly string[]).indexOf(key);
	let after: Pair<unknown, unknown> | undefined;

	for (const pair of parsed.root.items as Pair<unknown, unknown>[]) {
		const name = keyName(pair);
		const index =
			name === undefined
				? -1
				: (TOP_LEVEL_ORDER as readonly string[]).indexOf(name);

		if (index !== -1 && index < mine) {
			after = pair;
		}
	}

	if (after) {
		const end = pairEnd(after);

		if (end !== undefined) {
			const at = lineEndAt(text, trimEnd(text, end, 0));

			return {from: at, insert: `\n${block}`, to: at};
		}
	}

	const first = rangeOf(
		(parsed.root.items[0] as Pair<unknown, unknown> | undefined)?.key
	);
	const at = first ? lineStartAt(text, first[0]) : 0;

	return {from: at, insert: `${block}\n`, to: at};
}

export function appendAtEnd(text: string, block: string): TextEdit {
	const prefix = text.length === 0 || text.endsWith('\n') ? '' : '\n';

	return {from: text.length, insert: `${prefix}${block}\n`, to: text.length};
}

/** Add a whole entity entry, creating the `cast:` / `props:` map if it is absent. */
export function addEntity(
	text: string,
	kind: EntityKind,
	id: EntityId,
	patch: EntityPatch
): TextEdit {
	const body = formatEntityBody(id, patch);
	const mapKey = mapKeyFor(kind);
	const parsed = parseBlock(text);

	if (!parsed) {
		// Empty or unparseable block: there is nothing to insert relative to, so append.
		return appendAtEnd(text, `${mapKey}:\n  ${id}: ${body}`);
	}

	const indent = detectIndent(parsed);
	const map = entityMapOf(parsed, kind);

	if (map) {
		const edit = insertIntoMap(parsed, map, id, body);

		if (edit) {
			return edit;
		}
	}

	const owner = findPair(parsed.root, mapKey);

	if (owner) {
		// `cast:` is there but empty. Hang the first entry off it.
		const end = pairEnd(owner) ?? rangeOf(owner.key)?.[1] ?? 0;
		const at = lineEndAt(parsed.text, end);

		return {from: at, insert: `\n${indent}${id}: ${body}`, to: at};
	}

	return insertTopLevelKey(
		parsed,
		mapKey,
		`${mapKey}:\n${indent}${id}: ${body}`
	);
}

/**
 * `mira: {…}` -> `mira: ~`.
 *
 * With `from:`, an absent key means INHERITED (spec 02) — deleting the entry would put the
 * character straight back on stage. `id: ~` is the only way to say "gone".
 */
function tombstoneEdit(pair: Pair<unknown, unknown>): TextEdit | undefined {
	const keyRange = rangeOf(pair.key);

	if (!keyRange) {
		return undefined;
	}

	const end = pairEnd(pair) ?? keyRange[1];

	return {from: keyRange[1], insert: ': ~', to: Math.max(keyRange[1], end)};
}

/**
 * Delete the `cast:` / `props:` key along with the entries under it.
 *
 * A bare `cast:` parses as null, so it is harmless — and that is exactly the problem: the
 * next author to read the file cannot tell it from a half-finished edit. `last` is the final
 * entry in the map, because the deleted span runs from the map key to the end of its line.
 */
function removeMapEdit(
	parsed: Parsed,
	kind: EntityKind,
	last: Pair<unknown, unknown>
): TextEdit | undefined {
	const owner = findPair(parsed.root, mapKeyFor(kind));
	const ownerKey = owner && rangeOf(owner.key);
	const keyRange = rangeOf(last.key);

	if (!ownerKey || !keyRange) {
		return undefined;
	}

	const source = parsed.text;
	const end = pairEnd(last) ?? keyRange[1];
	let to = Math.min(
		source.length,
		lineEndAt(source, trimEnd(source, end, keyRange[0])) + 1
	);

	// A whole section carries the blank line that separated it. Leaving it behind stacks up
	// two blank lines where there was one, which is exactly the "a machine was here" tell.
	// Exactly ONE, though: an author who put two blank lines between sections meant them, and
	// eating the lot closes a gap they will have to type back in.
	if (source[to] === '\n') {
		to++;
	}

	return {from: lineStartAt(source, ownerKey[0]), insert: '', to};
}

function definedEdits(edits: (TextEdit | undefined)[]): TextEdit[] {
	return edits.filter((edit): edit is TextEdit => edit !== undefined);
}

/**
 * Remove several entries from one map, as ONE edit.
 *
 * The plural form exists because "was that the last entry?" cannot be answered one id at a
 * time. Two removals computed against the same original text each see a map that still has
 * two members, so each leaves the map behind, and merging them yields a dangling `cast:`
 * above a `props:` that still has content. With every id in hand the question is asked once.
 *
 * Ids not present in the map are ignored rather than refused: a selection can legitimately
 * hold an entity this scene only inherits.
 */
export function removeEntities(
	text: string,
	kind: EntityKind,
	ids: EntityId[],
	isPatchScene: boolean
): TextEdit | undefined {
	const parsed = parseBlock(text);
	const map = parsed && entityMapOf(parsed, kind);

	if (!parsed || !map) {
		return undefined;
	}

	const wanted = new Set<string>(ids);
	// Map order, not caller order — the splices have to run left to right, and a duplicate id
	// in the selection must not splice the same span twice.
	const pairs = (map.items as Pair<unknown, unknown>[]).filter(pair => {
		const name = keyName(pair);

		return name !== undefined && wanted.has(name);
	});

	if (pairs.length === 0) {
		return undefined;
	}

	if (isPatchScene) {
		// The map obviously stays: every entry it loses is replaced by a tombstone.
		return mergeEdits(parsed.text, definedEdits(pairs.map(tombstoneEdit)));
	}

	if (pairs.length >= map.items.length) {
		const edit = removeMapEdit(parsed, kind, pairs[pairs.length - 1]);

		if (edit) {
			return edit;
		}
	}

	return mergeEdits(
		parsed.text,
		definedEdits(pairs.map(pair => removePairEdit(parsed, map, pair)))
	);
}

/**
 * Remove one entity entry, or rewrite it as `id: ~` when the scene is a patch scene.
 *
 * The common case, and a plain pass-through: one id is just the shortest list.
 */
export function removeEntity(
	text: string,
	kind: EntityKind,
	id: EntityId,
	isPatchScene: boolean
): TextEdit | undefined {
	return removeEntities(text, kind, [id], isPatchScene);
}

// ---------------------------------------------------------------------------
// setBeatBubble
// ---------------------------------------------------------------------------

/** Written in this order, so a hand-edited map and a dragged one look the same. */
const BUBBLE_KEY_ORDER = [
	'as',
	'place',
	'at',
	'w',
	'bg',
	'color',
	'font',
	'size'
] as const;

/** The geometry a drag or a resize produces. `null` removes the key. */
/**
 * The bubble keys the editor writes: geometry from a drag, style from the beat toolbar.
 *
 * `null` removes the key. Anything absent is left exactly as the author wrote it — the
 * `bubble:` map is theirs, and a bubble moved after `as: yell` was typed keeps the yell.
 */
export interface BubbleGeometry {
	at?: {x: number; y: number} | null;
	/** Where the tail points, in stage fractions. `null` sends it back to the speaker. */
	tail?: {x: number; y: number} | null;
	w?: number | null;
	h?: number | null;
	as?: string | null;
	place?: string | null;
	/** `scene` detaches the bubble from its speaker. */
	anchor?: string | null;
	/** `absolute` fixes the box and fits the text to it. */
	sizing?: string | null;
}

/** `[0.7, 0.25]` — fractions of the stage box, so never the bare-number `at:`/`tail:` form. */
function formatBubbleValue(key: string, value: unknown): string {
	if ((key === 'at' || key === 'tail') && value && typeof value === 'object') {
		const at = value as {x: number; y: number};

		return `[${formatNumber(at.x)}, ${formatNumber(at.y)}]`;
	}

	return formatValue(key, value);
}

/**
 * Where the beat at `index` lives, and what its body is.
 *
 * A beat is a one-pair map — `- mira: "…"` or `- box: {…}` — so the pair IS the beat, and
 * a command beat (`wait`, `fx`, `mark`) has nothing to say and is refused.
 */
function locateBeat(
	parsed: Parsed,
	index: number
): {map: YAMLMap; pair: Pair<unknown, unknown>; key: string} | undefined {
	const beats = beatsSeqOf(parsed);
	const item = beats?.items[index];

	if (!isMap(item)) {
		return undefined;
	}

	const map = item as YAMLMap;
	const pair = (map.items as Pair<unknown, unknown>[])[0];
	const key = pair ? keyName(pair) : undefined;

	if (!pair || key === undefined) {
		return undefined;
	}

	if (key !== 'box' && (BEAT_COMMANDS as readonly string[]).includes(key)) {
		return undefined;
	}

	return {key, map, pair};
}

/**
 * A brand new `- id: {…}` set beat, spliced in at seq position `index`.
 *
 * This is what a drag does when the scrubber is parked on a beat the entity has no line in.
 * A beat item holds exactly ONE key, so the move cannot join somebody else's beat, and
 * falling through to the `cast:` entry would restage the character from the top of the scene
 * — the position the author is looking at is the one AFTER the beat on screen, so a beat of
 * its own, right after it, is the only place that means what the gesture meant.
 *
 * `index` is where the new item lands, so the item it follows is `index - 1`; inserting
 * before the first beat is refused, because state 0 is the entry block's job.
 *
 * Block sequences only. A flow `beats: [...]` is legal YAML nobody writes, and splicing one
 * would need its own comma rules for no gain.
 */
export function insertBeatEntity(
	text: string,
	index: number,
	id: EntityId,
	keys: Record<string, unknown>,
	options: {relative?: boolean} = {}
): TextEdit | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const beats = beatsSeqOf(parsed);
	const after = index > 0 ? beats?.items[index - 1] : undefined;

	if (!beats || beats.flow || after === undefined) {
		return undefined;
	}

	const range = rangeOf(after);

	if (!range) {
		return undefined;
	}

	const parts: string[] = [];

	for (const key of ENTITY_KEY_ORDER) {
		if (key === 'ref' || keys[key] === undefined) {
			continue;
		}

		parts.push(
			`${key}: ${formatValue(key, keys[key], {relative: options.relative})}`
		);
	}

	if (parts.length === 0) {
		return undefined;
	}

	// End of the LINE the previous beat ends on, so its trailing `# note` stays with it —
	// the same rule `insertIntoMap` follows, and `trimEnd` first for the same reason: a
	// block map's range runs past its own newline.
	const at = lineEndAt(text, trimEnd(text, range[1], range[0]));

	return {
		from: at,
		insert: `\n${indentAt(text, range[0])}- ${id}: {${parts.join(', ')}}`,
		to: at
	};
}

/**
 * Does this entity's own entry declare an `of:` parent? What a new beat needs to know, since
 * the beat it is writing has no entry of its own to read it off.
 */
export function entityHasParent(text: string, target: EntityTarget): boolean {
	const parsed = parseBlock(text);
	const located = parsed && locateEntity(parsed, target);

	return !!located && hasParent(located.pair);
}

/**
 * Set `bubble:` keys on one beat — how a dragged or resized bubble gets written down.
 *
 * Only the keys passed are touched, because the map is the author's: a bubble moved after
 * `as: yell` was typed keeps the yell, and the whole map keeps its own formatting. The
 * scalar forms (`- mira: "…"`, `- box: "…"`) are promoted to map form on the way, which is
 * the one case where the beat's own text is rewritten — carried across verbatim, quotes
 * and escapes included.
 */
export function setBeatBubble(
	text: string,
	index: number,
	geometry: BubbleGeometry
): TextEdit | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const beat = locateBeat(parsed, index);

	if (!beat) {
		return undefined;
	}

	const entries = Object.entries(geometry).filter(
		([, value]) => value !== undefined
	);

	if (entries.length === 0) {
		return undefined;
	}

	const body = beat.pair.value;

	// The beat is already a map: write into (or beside) whatever `bubble:` it has.
	if (isMap(body)) {
		const existing = findPair(body as YAMLMap, 'bubble');

		if (existing && isMap(existing.value)) {
			return writeBubbleKeys(parsed, existing.value as YAMLMap, entries);
		}

		if (existing) {
			// `bubble: yell` — the scalar shorthand. Keep the token as `as:` rather than
			// dropping the author's style on the floor to make room for a position.
			const token = isScalar(existing.value)
				? (existing.value as Scalar).value
				: undefined;
			const range = rangeOf(existing.value);

			return range
				? {
						from: range[0],
						insert: formatBubbleMap([
							...(typeof token === 'string' ? [['as', token] as const] : []),
							...entries
						]),
						to: range[1]
				  }
				: undefined;
		}

		return insertIntoMap(
			parsed,
			body as YAMLMap,
			'bubble',
			formatBubbleMap(entries)
		);
	}

	// A bare scalar beat. Promote it, keeping the source text of the line exactly.
	return promoteScalarBeat(text, beat.pair, beat.key === 'box' ? 'text' : 'say', [
		['bubble', formatBubbleMap(entries)]
	]);
}

/**
 * Set one key on a beat's own body — `dur:`, and whatever the beat toolbar grows next.
 *
 * The sibling of `setBeatBubble`, addressed the same way: by beat INDEX, not by entity.
 * `dur:` belongs to the moment rather than to whoever is speaking in it, and a beat with no
 * speaker at all (`- box: {…}`) still has one.
 *
 * `null` removes the key. A bare scalar beat is promoted to map form, carrying its text
 * across verbatim — the same one rewrite `setBeatBubble` allows itself, for the same reason:
 * there is nowhere else to put a key.
 */
export function setBeatKey(
	text: string,
	index: number,
	key: string,
	value: unknown
): TextEdit | undefined {
	const parsed = parseBlock(text);

	if (!parsed) {
		return undefined;
	}

	const beat = locateBeat(parsed, index);

	if (!beat) {
		return undefined;
	}

	const body = beat.pair.value;

	if (isMap(body)) {
		const map = body as YAMLMap;
		const existing = findPair(map, key);

		if (value === null) {
			return existing ? removePairEdit(parsed, map, existing) : undefined;
		}

		return existing
			? spliceValue(parsed, existing, formatValue(key, value))
			: insertIntoMap(parsed, map, key, formatValue(key, value));
	}

	// Nothing to remove from a beat that is still one line of dialogue.
	if (value === null) {
		return undefined;
	}

	return promoteScalarBeat(text, beat.pair, beat.key === 'box' ? 'text' : 'say', [
		[key, formatValue(key, value)]
	]);
}

function formatBubbleMap(
	entries: readonly (readonly [string, unknown])[]
): string {
	const kept = entries.filter(([, value]) => value !== null);
	const ordered = [...kept].sort(
		(a, b) =>
			BUBBLE_KEY_ORDER.indexOf(a[0] as (typeof BUBBLE_KEY_ORDER)[number]) -
			BUBBLE_KEY_ORDER.indexOf(b[0] as (typeof BUBBLE_KEY_ORDER)[number])
	);

	return `{${ordered
		.map(([key, value]) => `${key}: ${formatBubbleValue(key, value)}`)
		.join(', ')}}`;
}

/** One edit per key, folded into a single splice so a gesture stays one undo. */
function writeBubbleKeys(
	parsed: Parsed,
	map: YAMLMap,
	entries: readonly (readonly [string, unknown])[]
): TextEdit | undefined {
	const edits: TextEdit[] = [];

	for (const [key, value] of entries) {
		const existing = findPair(map, key);
		const edit =
			value === null
				? existing
					? removePairEdit(parsed, map, existing)
					: undefined
				: existing
				? spliceValue(parsed, existing, formatBubbleValue(key, value))
				: insertIntoMap(parsed, map, key, formatBubbleValue(key, value));

		if (edit) {
			edits.push(edit);
		}
	}

	return mergeEdits(parsed.text, edits);
}

function spliceValue(
	parsed: Parsed,
	pair: Pair<unknown, unknown>,
	formatted: string
): TextEdit | undefined {
	const range = rangeOf(pair.value);

	return range
		? {from: range[0], insert: formatted, to: range[1]}
		: insertValueAfterKey(parsed.text, pair, formatted);
}
