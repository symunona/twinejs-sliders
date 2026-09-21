/**
 * Follow an ASSET rename into every scene block that names the art.
 *
 * Third of the rename followers, and the widest:
 *
 * | module | renames | slots |
 * |---|---|---|
 * | `rename-scene-targets.ts` | a passage | `from:`, `links:`, `link:` |
 * | `rename-scene-character.ts` | a character id | entity keys, `ref:`, `of:`, beat speakers |
 * | this one | an asset name | the above PLUS `bg:`, `fx:`, `music:`, `sfx:` |
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
 * - `frame:` — a frame belongs to a character, whose frame art is named `<id>-<frame>`.
 * - `id:` — it is the scene's name, and another passage's `from:` points at it. When it was
 *   standing in for the backdrop, the backdrop is spelled out instead; see `insertBg`.
 * - dialogue prose, `mark:` and `if:` expressions.
 */

import {isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Pair, Scalar, YAMLMap, YAMLSeq} from 'yaml';
import {extractSceneBlock} from '@sliders/scene-index';
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
 * The backdrop a scene asked for by writing nothing.
 *
 * `id:` doubles as `bg:` (spec 02), so a scene called `candle` draws the `candle` art. The
 * id itself cannot move — it is what `from:` in another passage points at — so the rename
 * spells the backdrop out on the line below instead. A patch scene (`from:`) inherits its
 * backdrop rather than defaulting to its id, so it needs nothing.
 */
function insertBg(root: YAMLMap, blockText: string, ctx: Ctx): void {
	const idPair = pairsOf(root).find(pair => keyName(pair) === 'id');

	if (
		!idPair ||
		pairsOf(root).some(pair => ['bg', 'from'].includes(keyName(pair) ?? '')) ||
		!isScalar(idPair.key) ||
		!Array.isArray(idPair.key.range) ||
		!isScalar(idPair.value) ||
		(idPair.value as Scalar).value !== ctx.oldName ||
		!Array.isArray(idPair.value.range)
	) {
		return;
	}

	const keyStart = idPair.key.range[0];
	// After the whole LINE, not after the value: a trailing comment on `id:` is the id's.
	const lineEnd = blockText.indexOf('\n', idPair.value.range[1]);
	const end = lineEnd === -1 ? blockText.length : lineEnd;

	ctx.edits.push({
		end,
		start: end,
		text: `\n${' '.repeat(
			keyStart - (blockText.lastIndexOf('\n', keyStart) + 1)
		)}bg: ${scalarText(ctx.newName, false)}`
	});
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
				renameSound(pair.value, ctx, false);
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

	insertBg(root, blockText, ctx);

	return ctx.edits;
}

/**
 * One beat. `bg:` and `sfx:` sit on the beat BASE, so they are a beat of their own
 * (`- sfx: door-slam`) or ride on a speaker's body (`- mira: {say: …, bg: street}`) — both
 * spellings, or an author who writes the compact one keeps a dead reference.
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

			case 'wait':
			case 'mark':
			case 'box':
				break;

			default:
				// A speaker line, whose body can carry a `bg:` or `sfx:` of its own. Its
				// `ref:` and the key itself belong to `renameSceneCharacter`.
				for (const bodyPair of pairsOf(pair.value)) {
					const key = keyName(bodyPair);

					if (key === 'bg') {
						renameBg(bodyPair.value, ctx, !!(pair.value as YAMLMap).flow);
					} else if (key === 'sfx') {
						renameSound(bodyPair.value, ctx, !!(pair.value as YAMLMap).flow);
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
