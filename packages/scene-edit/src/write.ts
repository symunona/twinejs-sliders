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
import {formatValue} from './format';
import {
	ENTITY_KEY_ORDER,
	TOP_LEVEL_ORDER,
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
	// `{say: "…", at: …}` (spec 02, "Beats"). The dialogue is carried across as its ORIGINAL
	// source text, so `'single'` stays single-quoted and an escaped `\"` stays escaped —
	// re-serializing the parsed string would quietly rewrite the author's prose.
	if (inBeat && typeof scalar === 'string' && valueRange) {
		return {
			from: valueRange[0],
			insert: `{say: ${text.slice(valueRange[0], valueRange[1])}, ${key}: ${formatted}}`,
			to: valueRange[1]
		};
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
