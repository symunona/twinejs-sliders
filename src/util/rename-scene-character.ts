/**
 * Follow a character-ID rename into every scene block that names it.
 *
 * A character's `id` is its real handle: it shares one namespace with asset names, and it
 * is what scene YAML writes. Rename the character and the scenes keep addressing something
 * that no longer exists — the sprite stops resolving and the author has to go find every
 * mention by hand.
 *
 *   cast:               # the map key IS the ref when no `ref:` is written
 *     mira: {at: -0.4}
 *   props:
 *     lamp: {of: mira}  # positioned relative to that entity
 *   entities:
 *     shadow: {ref: mira}
 *   beats:
 *     - mira: "Hello."  # a beat's speaker key is an entity id too
 *
 * Numbered copies follow too. A second drop of the same art lands as `mira-2: {ref: mira}`
 * (`uniqueEntityId`), so renaming `mira` to `tav` turns that into `tav-2: {ref: tav}` and
 * moves its beat speakers and `of:` along with it. A key that only LOOKS numbered is left
 * alone: `mira-2: {at: 0}` with no `ref:` is art of its own called `mira-2`. Under `from:` a
 * bare `mira-2:` is a patch over the inherited copy, so it follows there.
 *
 * Sibling of `rename-scene-targets.ts`, which does the same job for a PASSAGE rename, and
 * built the same way: edits are SPLICED at the node ranges the YAML parser reports, never
 * re-serialized, so the author's flow maps, comments and blank lines survive a rename they
 * did not ask to reformat. A block with YAML errors is left alone — the tree the parser
 * recovers from a half-typed block is a guess, and splicing at a guess edits the author's
 * text into something they never wrote.
 *
 * NOT rewritten, on purpose: `pose:` (a pose name inside the character, not the id),
 * `mark:`, `fx` ids, `id:`/`from:`/`bg:`/`links:` (passage and asset names), dialogue prose
 * and `if:` expressions.
 */

import {isMap, isScalar, isSeq, parseDocument, stringify, Scalar} from 'yaml';
import type {Pair, YAMLMap, YAMLSeq} from 'yaml';
import {extractSceneBlock} from '@sliders/scene-index';

/** Top-level keys whose value is a map of entity id -> entity body. */
const ENTITY_MAP_KEYS = ['cast', 'props', 'entities'];

/** Beat keys that are commands rather than a speaker id. Mirrors `BEAT_COMMAND_KEYS`. */
const BEAT_COMMANDS = ['box', 'wait', 'fx', 'sfx', 'mark', 'bg', 'music'];

/** A scalar to replace, as a character range within the BLOCK text. */
interface Target {
	start: number;
	end: number;
	/** Inside `{…}`, where a plain scalar may not contain a comma or a brace. */
	flow: boolean;
	/** What goes there instead. */
	to: string;
}

/**
 * The new id as YAML.
 *
 * `stringify` decides on quoting for block context — a slug like `04` or `yes` has to come
 * back quoted or it stops being a string. Flow context is stricter than `stringify` knows
 * here (the scalar's own node is gone), so anything a `{…}` would end early is quoted too.
 */
function scalarText(id: string, flow: boolean): string {
	const written = stringify(id, {version: '1.2'}).trim();

	if (flow && /^[^'"].*[,{}[\]]/.test(written)) {
		return JSON.stringify(id);
	}

	return written;
}

/**
 * What a name slot says, reading a plain scalar from SOURCE.
 *
 * `04:` resolves to the number 4 under the YAML core schema while the author plainly typed
 * a name. The parser has `asSourceString`/`keyName` for exactly this; slugs are `[a-z0-9-]`
 * so `04` is a legal character id.
 */
function nameOf(node: unknown): string | undefined {
	if (!isScalar(node)) {
		return undefined;
	}

	const scalar = node as Scalar;

	if (
		scalar.type === 'PLAIN' &&
		typeof scalar.source === 'string' &&
		typeof scalar.value !== 'string' &&
		scalar.value !== null
	) {
		return scalar.source;
	}

	return typeof scalar.value === 'string' ? scalar.value : undefined;
}

function collect(
	node: unknown,
	id: string,
	to: string,
	flow: boolean,
	targets: Target[]
): void {
	if (isScalar(node) && nameOf(node) === id && Array.isArray(node.range)) {
		targets.push({start: node.range[0], end: node.range[1], flow, to});
	}
}

/** `ref:` as written in an entity body, or undefined when the body does not say. */
function explicitRef(body: unknown): string | undefined {
	if (!isMap(body)) {
		return undefined;
	}

	for (const pair of (body as YAMLMap).items as Pair<unknown, unknown>[]) {
		if (nameOf(pair.key) === 'ref') {
			return nameOf(pair.value);
		}
	}

	return undefined;
}

/**
 * Entity-body slots: `ref:` always, `of:` only when the id is still an entity id here.
 *
 * `of:` names another ENTITY in the same stage, not a character — usually the same word,
 * because an entry's key is its ref. When the block redefines that key as something else
 * (`mira: {ref: tav}`), `of: mira` means that other entity and the rename must not touch
 * it; `shadowed` carries that decision down.
 */
function scanBody(
	body: unknown,
	id: string,
	to: string,
	shadowed: boolean,
	targets: Target[]
): void {
	if (!isMap(body)) {
		return;
	}

	const map = body as YAMLMap;

	for (const pair of map.items as Pair<unknown, unknown>[]) {
		const key = nameOf(pair.key);

		if (key === 'ref' || (key === 'of' && !shadowed)) {
			collect(pair.value, id, to, !!map.flow, targets);
		}
	}
}

/**
 * One `cast:`/`props:`/`entities:` entry, or one beat.
 *
 * The key is only the character when the body does not override it with a `ref:` — and an
 * explicit `ref:` is the character even when the key is something else entirely.
 */
function scanEntry(
	pair: Pair<unknown, unknown>,
	id: string,
	to: string,
	flow: boolean,
	shadowed: boolean,
	targets: Target[]
): void {
	const ref = explicitRef(pair.value);

	if (ref !== undefined) {
		scanBody(pair.value, id, to, shadowed, targets);
		return;
	}

	if (!shadowed && nameOf(pair.key) === id) {
		collect(pair.key, id, to, flow, targets);
	}

	scanBody(pair.value, id, to, shadowed, targets);
}

/** The first pair of a beat map, when that beat has a speaker rather than a command. */
function beatSpeaker(item: unknown): Pair<unknown, unknown> | undefined {
	if (!isMap(item)) {
		return undefined;
	}

	const pairs = (item as YAMLMap).items as Pair<unknown, unknown>[];
	const first = pairs[0];

	if (!first) {
		return undefined;
	}

	const key = nameOf(first.key);

	return key !== undefined && !BEAT_COMMANDS.includes(key) ? first : undefined;
}

/**
 * Every entity-bearing entry in the block: the three maps, then the beats. `declared` is
 * false for a beat speaker, which names an entity rather than putting one on stage.
 */
function forEachEntry(
	root: YAMLMap,
	visit: (pair: Pair<unknown, unknown>, flow: boolean, declared: boolean) => void
): void {
	for (const pair of root.items as Pair<unknown, unknown>[]) {
		const key = nameOf(pair.key);

		if (key !== undefined && ENTITY_MAP_KEYS.includes(key) && isMap(pair.value)) {
			const map = pair.value as YAMLMap;

			for (const entry of map.items as Pair<unknown, unknown>[]) {
				visit(entry, !!map.flow, true);
			}
		} else if (key === 'beats' && isSeq(pair.value)) {
			for (const item of (pair.value as YAMLSeq).items) {
				const speaker = beatSpeaker(item);

				if (speaker) {
					visit(speaker, !!(item as YAMLMap).flow, false);
				}
			}
		}
	}
}

/** The block's root map, or undefined when it does not parse cleanly. */
function parseRoot(blockText: string): YAMLMap | undefined {
	// Same YAML version the scene parser uses, so this module and the preview never
	// disagree about what a scalar says.
	const doc = parseDocument(blockText, {version: '1.2'});

	// The parser RECOVERS from a syntax error rather than throwing, and the tree it
	// recovers is a guess. A stale reference is visible and fixable; a mangled block is
	// neither.
	if (doc.errors.length > 0 || !isMap(doc.contents)) {
		return undefined;
	}

	return doc.contents as YAMLMap;
}

/** Every place this block names the character, in the order they were written. */
function characterTargets(root: YAMLMap, id: string, to: string): Target[] {
	// An entry keyed with the id but pointing somewhere else takes the NAME over from the
	// character for the rest of the block, so neither that key nor any `of:` may move.
	let shadowed = false;

	forEachEntry(root, pair => {
		const ref = explicitRef(pair.value);

		if (nameOf(pair.key) === id && ref !== undefined && ref !== id) {
			shadowed = true;
		}
	});

	const targets: Target[] = [];

	forEachEntry(root, (pair, flow) =>
		scanEntry(pair, id, to, flow, shadowed, targets)
	);

	return targets;
}

/** `mira-2` -> `2` when the key numbers a copy of `id` the way `uniqueEntityId` does. */
function copyNumber(key: string | undefined, id: string): string | undefined {
	if (key === undefined || !key.startsWith(`${id}-`)) {
		return undefined;
	}

	const n = key.slice(id.length + 1);

	return /^[0-9]+$/.test(n) ? n : undefined;
}

/**
 * The numbered copies of `id` in this block, and the handle each moves to.
 *
 * A copy is a key `id-N` whose entry says `ref: id`. Without a `ref:` the key is the art
 * itself, so `mira-2: {at: 0}` is something else and stays — except under `from:`, where a
 * bare `mira-2:` patches the copy the base scene put on stage. A copy whose new handle is
 * already an entity here keeps its old one rather than merge into it.
 */
function copyHandles(root: YAMLMap, id: string, newId: string): Map<string, string> {
	const inherits = (root.items as Pair<unknown, unknown>[]).some(
		pair => nameOf(pair.key) === 'from' && nameOf(pair.value) !== undefined
	);
	const ids = new Set<string>();
	const copies = new Set<string>();
	const vetoed = new Set<string>();

	forEachEntry(root, (pair, _flow, declared) => {
		const key = nameOf(pair.key);

		if (key === undefined) {
			return;
		}

		ids.add(key);

		if (copyNumber(key, id) === undefined) {
			return;
		}

		const ref = explicitRef(pair.value);

		if (ref === id || (ref === undefined && inherits)) {
			copies.add(key);
		} else if (ref !== undefined || declared) {
			vetoed.add(key);
		}
	});

	const handles = new Map<string, string>();

	for (const key of copies) {
		const to = `${newId}-${copyNumber(key, id)}`;

		if (!vetoed.has(key) && !ids.has(to)) {
			handles.set(key, to);
		}
	}

	return handles;
}

/** A copy's handle wherever the block names it: its key, beat speakers and `of:`. */
function copyTargets(root: YAMLMap, handles: Map<string, string>): Target[] {
	const targets: Target[] = [];

	forEachEntry(root, (pair, flow) => {
		const key = nameOf(pair.key);
		const to = key === undefined ? undefined : handles.get(key);

		if (key !== undefined && to !== undefined) {
			collect(pair.key, key, to, flow, targets);
		}

		if (!isMap(pair.value)) {
			return;
		}

		const body = pair.value as YAMLMap;

		for (const bodyPair of body.items as Pair<unknown, unknown>[]) {
			const of = nameOf(bodyPair.key) === 'of' ? nameOf(bodyPair.value) : undefined;
			const ofTo = of === undefined ? undefined : handles.get(of);

			if (of !== undefined && ofTo !== undefined) {
				collect(bodyPair.value, of, ofTo, !!body.flow, targets);
			}
		}
	});

	return targets;
}

/** How many places this passage's scene block names the character. */
export function countSceneCharacterRefs(
	passageText: string,
	id: string
): number {
	if (!id || !passageText.includes(id)) {
		return 0;
	}

	const block = extractSceneBlock(passageText);

	if (!block || !block.text.includes(id)) {
		return 0;
	}

	const root = parseRoot(block.text);

	return root ? characterTargets(root, id, id).length : 0;
}

/**
 * `passageText` with every scene-block reference to `oldId` pointing at `newId`.
 *
 * Returns the text unchanged when there is no scene block, nothing to rename, or the block
 * does not parse.
 */
export function renameSceneCharacter(
	passageText: string,
	oldId: string,
	newId: string
): string {
	if (!oldId || !newId || oldId === newId || !passageText.includes(oldId)) {
		return passageText;
	}

	const block = extractSceneBlock(passageText);

	if (!block || !block.text.includes(oldId)) {
		return passageText;
	}

	const root = parseRoot(block.text);

	if (!root) {
		return passageText;
	}

	// Both read the tree as the author wrote it, so a copy is recognised by its `ref:`
	// before that `ref:` is rewritten. The two never overlap: one matches `oldId` whole,
	// the other only `oldId-N`.
	const targets = [
		...characterTargets(root, oldId, newId),
		...copyTargets(root, copyHandles(root, oldId, newId))
	];

	if (targets.length === 0) {
		return passageText;
	}

	let result = passageText;

	// Back to front, so each splice leaves the earlier ranges where the parser found them.
	for (const target of [...targets].sort((a, b) => b.start - a.start)) {
		const start = block.offset + target.start;
		const end = block.offset + target.end;

		result =
			result.slice(0, start) +
			scalarText(target.to, target.flow) +
			result.slice(end);
	}

	return result;
}
