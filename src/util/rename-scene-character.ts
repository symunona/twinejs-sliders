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
const BEAT_COMMANDS = ['box', 'wait', 'fx', 'sfx', 'mark', 'bg'];

/** A scalar to replace, as a character range within the BLOCK text. */
interface Target {
	start: number;
	end: number;
	/** Inside `{…}`, where a plain scalar may not contain a comma or a brace. */
	flow: boolean;
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
	flow: boolean,
	targets: Target[]
): void {
	if (isScalar(node) && nameOf(node) === id && Array.isArray(node.range)) {
		targets.push({start: node.range[0], end: node.range[1], flow});
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
			collect(pair.value, id, !!map.flow, targets);
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
	flow: boolean,
	shadowed: boolean,
	targets: Target[]
): void {
	const ref = explicitRef(pair.value);

	if (ref !== undefined) {
		scanBody(pair.value, id, shadowed, targets);
		return;
	}

	if (!shadowed && nameOf(pair.key) === id) {
		collect(pair.key, id, flow, targets);
	}

	scanBody(pair.value, id, shadowed, targets);
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

/** Every entity-bearing entry in the block: the three maps, then the beats. */
function forEachEntry(
	root: YAMLMap,
	visit: (pair: Pair<unknown, unknown>, flow: boolean) => void
): void {
	for (const pair of root.items as Pair<unknown, unknown>[]) {
		const key = nameOf(pair.key);

		if (key !== undefined && ENTITY_MAP_KEYS.includes(key) && isMap(pair.value)) {
			const map = pair.value as YAMLMap;

			for (const entry of map.items as Pair<unknown, unknown>[]) {
				visit(entry, !!map.flow);
			}
		} else if (key === 'beats' && isSeq(pair.value)) {
			for (const item of (pair.value as YAMLSeq).items) {
				const speaker = beatSpeaker(item);

				if (speaker) {
					visit(speaker, !!(item as YAMLMap).flow);
				}
			}
		}
	}
}

/** Every place this block names the character, in the order they were written. */
function characterTargets(blockText: string, id: string): Target[] {
	// Same YAML version the scene parser uses, so this module and the preview never
	// disagree about what a scalar says.
	const doc = parseDocument(blockText, {version: '1.2'});

	// The parser RECOVERS from a syntax error rather than throwing, and the tree it
	// recovers is a guess. A stale reference is visible and fixable; a mangled block is
	// neither.
	if (doc.errors.length > 0) {
		return [];
	}

	const root = doc.contents;

	if (!isMap(root)) {
		return [];
	}

	// An entry keyed with the id but pointing somewhere else takes the NAME over from the
	// character for the rest of the block, so neither that key nor any `of:` may move.
	let shadowed = false;

	forEachEntry(root as YAMLMap, pair => {
		const ref = explicitRef(pair.value);

		if (nameOf(pair.key) === id && ref !== undefined && ref !== id) {
			shadowed = true;
		}
	});

	const targets: Target[] = [];

	forEachEntry(root as YAMLMap, (pair, flow) =>
		scanEntry(pair, id, flow, shadowed, targets)
	);

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

	return characterTargets(block.text, id).length;
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

	const targets = characterTargets(block.text, oldId);

	if (targets.length === 0) {
		return passageText;
	}

	let result = passageText;

	// Back to front, so each splice leaves the earlier ranges where the parser found them.
	for (const target of [...targets].sort((a, b) => b.start - a.start)) {
		const start = block.offset + target.start;
		const end = block.offset + target.end;

		result =
			result.slice(0, start) + scalarText(newId, target.flow) + result.slice(end);
	}

	return result;
}
