/**
 * Follow an ASSET rename into every scene block that names the art.
 *
 * Third of the rename followers, and the widest:
 *
 * | module | renames | slots |
 * |---|---|---|
 * | `rename-scene-targets.ts` | a passage | `from:`, `links:`, `link:` |
 * | `rename-scene-character.ts` | a character id | entity keys, `ref:`, `of:`, beat speakers |
 * | this one | an asset name | the above PLUS `bg:`, `fx:`, `music:` (keyed tracks too), `sfx:` |
 *
 * Asset names and character ids share ONE namespace (spec 03) and a `props:` entry key
 * doubles as its `ref:`, so renaming a piece of art moves an entity id as surely as
 * renaming a character does. That half is `renameSceneCharacter`, called here rather than
 * copied: its shadowing rule (`candle: {ref: lamp}` takes the name over for the rest of the
 * block) is subtle, tested, and would drift the day it existed twice.
 *
 * What this module adds is the art-only keys, spliced at the node ranges the YAML parser
 * reports — never re-serialized, or the author's flow maps, comments and blank lines come
 * back reflowed from a rename they did not ask to reformat.
 *
 * NOT rewritten, on purpose:
 *
 * - `pose:` — a pose belongs to a character, whose pose art is named `<id>-<pose>`.
 * - dialogue prose, `mark:` and `if:` expressions.
 */

import {isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Pair, Scalar, YAMLMap, YAMLSeq} from 'yaml';
import {extractSceneBlock} from '@sliders/scene-index';
import {MUSIC_KEYS} from '@sliders/scene-schema';
import {renameSceneCharacter} from './rename-scene-character';
import {scalarText} from './rename-scene-targets';

/** A span of the BLOCK text and what goes there instead. */
interface Edit {
	end: number;
	start: number;
	text: string;
}

interface Ctx {
	edits: Edit[];
	newName: string;
	oldName: string;
}

function keyName(pair: Pair<unknown, unknown>): string | undefined {
	return isScalar(pair.key) && typeof pair.key.value === 'string'
		? pair.key.value
		: undefined;
}

function pairsOf(node: unknown): Pair<unknown, unknown>[] {
	return isMap(node) ? ((node as YAMLMap).items as Pair<unknown, unknown>[]) : [];
}

/** A scalar that is the name outright: `bg: candle`, `id: candle`. */
function renameScalar(node: unknown, ctx: Ctx, flow: boolean): void {
	if (
		isScalar(node) &&
		(node as Scalar).value === ctx.oldName &&
		Array.isArray(node.range)
	) {
		ctx.edits.push({
			end: node.range[1],
			start: node.range[0],
			text: scalarText(ctx.newName, flow)
		});
	}
}

/**
 * `rain@0.6` — the `name@amount` token `fx:`, `sfx:` and `music:` share.
 *
 * Only the name half is the ref, so the amount is carried over as the author typed it
 * rather than re-derived: a round trip through a float prints `0.6000000000000001` on the
 * day the number does not divide.
 */
function renameToken(node: unknown, ctx: Ctx, flow: boolean): void {
	const value = isScalar(node) ? (node as Scalar).value : undefined;

	if (typeof value !== 'string' || !isScalar(node) || !Array.isArray(node.range)) {
		return;
	}

	const at = value.indexOf('@');

	if (value.slice(0, at === -1 ? undefined : at).trim() !== ctx.oldName) {
		return;
	}

	ctx.edits.push({
		end: node.range[1],
		start: node.range[0],
		text: scalarText(
			at === -1 ? ctx.newName : ctx.newName + value.slice(at),
			flow
		)
	});
}

/** The `id:` of a long-form `bg:`, `fx:`, `sfx:` or `music:` entry. */
function renameIdKey(map: unknown, ctx: Ctx): void {
	for (const pair of pairsOf(map)) {
		if (keyName(pair) === 'id') {
			renameScalar(pair.value, ctx, !!(map as YAMLMap).flow);
		}
	}
}

/** `bg: candle` or `bg: {id: candle, fx: parallax_left}`. Never a `name@amount` token. */
function renameBg(value: unknown, ctx: Ctx, flow: boolean): void {
	if (isMap(value)) {
		renameIdKey(value, ctx);
	} else {
		renameScalar(value, ctx, flow);
	}
}

/** `fx: rain@0.6`, `sfx: door-slam`, `music: {id: theme, volume: 0.4}`. */
function renameSound(value: unknown, ctx: Ctx, flow: boolean): void {
	if (isMap(value)) {
		renameIdKey(value, ctx);
	} else {
		renameToken(value, ctx, flow);
	}
}

/**
 * The keys that make a `music:` map the SINGLE long form (`{id: rain, volume: 0.4}`)
 * rather than a keyed map of tracks. `stop-other-tracks` is legal in both, so it decides
 * nothing. Read off the parser's own list, so a new track param cannot be mistaken for a
 * track name here.
 */
const MUSIC_TRACK_PARAMS: readonly string[] = MUSIC_KEYS.filter(
	key => key !== 'stop-other-tracks'
);

/**
 * `music: rain@0.4`, `music: {id: rain}`, or the keyed map of tracks:
 * `music: {mellow: {id: x}, drums: drum-loop@0.3, wind: {volume: 0.2}, rain: ~}`.
 *
 * In a keyed map the KEY is the author's track name, never an asset, and so is anything
 * `stop-other-tracks:` lists; only each entry's value can name a sound.
 */
function renameMusic(value: unknown, ctx: Ctx, flow: boolean): void {
	if (!isMap(value)) {
		renameToken(value, ctx, flow);
		return;
	}

	const pairs = pairsOf(value);

	if (pairs.some(pair => MUSIC_TRACK_PARAMS.includes(keyName(pair) ?? ''))) {
		renameIdKey(value, ctx);
		return;
	}

	for (const pair of pairs) {
		if (keyName(pair) !== 'stop-other-tracks') {
			renameSound(pair.value, ctx, !!(value as YAMLMap).flow);
		}
	}
}

/** Every art-key edit one block needs. */
function artEdits(blockText: string, ctx: Ctx): Edit[] {
	// Same YAML version the scene parser uses, so this module and the preview never
	// disagree about what a scalar says.
	const doc = parseDocument(blockText, {version: '1.2'});

	// The parser RECOVERS from a syntax error rather than throwing, and the tree it
	// recovers is a guess. A stale reference is visible and fixable; a mangled block is
	// neither.
	if (doc.errors.length > 0 || !isMap(doc.contents)) {
		return [];
	}

	const root = doc.contents as YAMLMap;

	for (const pair of pairsOf(root)) {
		switch (keyName(pair)) {
			case 'bg':
				renameBg(pair.value, ctx, false);
				break;

			case 'music':
				renameMusic(pair.value, ctx, false);
				break;

			case 'fx':
				if (isSeq(pair.value)) {
					for (const item of (pair.value as YAMLSeq).items) {
						renameSound(item, ctx, !!(pair.value as YAMLSeq).flow);
					}
				}
				break;

			case 'beats':
				if (isSeq(pair.value)) {
					for (const item of (pair.value as YAMLSeq).items) {
						beatEdits(item, ctx);
					}
				}
				break;
		}
	}

	return ctx.edits;
}

/**
 * One beat. `bg:`, `sfx:` and `music:` sit on the beat BASE, so they are a beat of their
 * own (`- sfx: door-slam`) or ride on a body (`- mira: {say: …, bg: street}`, `- box:
 * {text: …, music: rain}`) — every spelling, or an author who writes the compact one keeps
 * a dead reference.
 */
function beatEdits(item: unknown, ctx: Ctx): void {
	const flow = !!(item as YAMLMap)?.flow;

	for (const pair of pairsOf(item)) {
		switch (keyName(pair)) {
			case 'bg':
				renameBg(pair.value, ctx, flow);
				break;

			case 'fx':
			case 'sfx':
				renameSound(pair.value, ctx, flow);
				break;

			case 'music':
				renameMusic(pair.value, ctx, flow);
				break;

			case 'wait':
			case 'mark':
				break;

			default:
				// A speaker line or a `box:` map, whose body can carry a `bg:`, `sfx:` or
				// `music:` of its own. A speaker's `ref:` and the key itself belong to
				// `renameSceneCharacter`; a box's `text:` is prose.
				for (const bodyPair of pairsOf(pair.value)) {
					const key = keyName(bodyPair);
					const bodyFlow = !!(pair.value as YAMLMap).flow;

					if (key === 'bg') {
						renameBg(bodyPair.value, ctx, bodyFlow);
					} else if (key === 'sfx') {
						renameSound(bodyPair.value, ctx, bodyFlow);
					} else if (key === 'music') {
						renameMusic(bodyPair.value, ctx, bodyFlow);
					}
				}
				break;
		}
	}
}

/**
 * `passageText` with every scene-block reference to the asset `oldName` pointing at
 * `newName`.
 *
 * Returns the text unchanged when there is no scene block, nothing to rename, or the block
 * does not parse.
 */
export function renameSceneRefs(
	passageText: string,
	oldName: string,
	newName: string
): string {
	if (
		!oldName ||
		!newName ||
		oldName === newName ||
		!passageText.includes(oldName)
	) {
		return passageText;
	}

	// The entity half first, on the text as the author wrote it: it decides whether an
	// entry key still means this art by reading the `ref:` beside it, which the art half
	// is about to rewrite.
	const withIds = renameSceneCharacter(passageText, oldName, newName);
	const block = extractSceneBlock(withIds);

	if (!block || !block.text.includes(oldName)) {
		return withIds;
	}

	const edits = artEdits(block.text, {edits: [], newName, oldName});
	let result = withIds;

	// Back to front, so each splice leaves the earlier ranges where the parser found them.
	for (const edit of [...edits].sort((a, b) => b.start - a.start)) {
		result =
			result.slice(0, block.offset + edit.start) +
			edit.text +
			result.slice(block.offset + edit.end);
	}

	return result;
}
