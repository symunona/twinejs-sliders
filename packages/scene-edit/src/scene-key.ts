/**
 * Splices for the TOP-LEVEL scene keys the visual editor writes: `bg:` and `camera:`.
 *
 * Same two-tier strategy as `write.ts`, one level up the tree — an entity write splices a
 * value inside `cast:`, these splice a value hanging directly off the root. They share that
 * file's primitives rather than owning look-alikes of them: two copies of this logic is how
 * one writer learns to keep a trailing comment while the other quietly eats it.
 */

import {findPair, parseBlock, rangeOf, trimEnd} from './locate';
import {
	appendAtEnd,
	insertTopLevelKey,
	insertValueAfterKey,
	removePairEdit
} from './write';
import type {TextEdit} from './types';

/**
 * Set a top-level key to already-formatted YAML. Never undefined: the worst case is an
 * unparseable block, and appending is still better than dropping the author's gesture.
 *
 * `formatted` is a string rather than a value because the two keys this serves format
 * differently — `bg:` is a scalar the `yaml` quoter decides about, `camera:` is a flow map
 * with its own omission rules — and a writer that guessed would eventually guess wrong.
 */
export function setSceneKey(
	text: string,
	key: string,
	formatted: string
): TextEdit {
	const parsed = parseBlock(text);

	if (!parsed) {
		// Empty or unparseable: there is nothing to insert relative to.
		return appendAtEnd(text, `${key}: ${formatted}`);
	}

	const existing = findPair(parsed.root, key);

	if (existing) {
		const valueRange = rangeOf(existing.value);

		if (!valueRange || valueRange[0] >= valueRange[1]) {
			return (
				insertValueAfterKey(text, existing, formatted) ??
				appendAtEnd(text, `${key}: ${formatted}`)
			);
		}

		const keyRange = rangeOf(existing.key);
		const colon = keyRange ? text.indexOf(':', keyRange[1]) : -1;
		const to = trimEnd(text, valueRange[1], valueRange[0]);

		// A block-style value starts on the NEXT line, so a splice of its range alone would
		// leave `camera:` and an orphaned indent behind. Take the newline and the indent with
		// it. Collapsing a block map to flow is the documented cost of rewriting a whole
		// value — and it is confined to that one key.
		if (colon !== -1 && text.slice(colon + 1, valueRange[0]).includes('\n')) {
			return {from: colon + 1, insert: ` ${formatted}`, to};
		}

		// Tier 1. This single line is the whole promise of the two-tier strategy.
		return {from: valueRange[0], insert: formatted, to};
	}

	// Tier 2, and spec 02's key order decides where: a generated `bg:` landing after `beats:`
	// parses fine and reads as if a machine had been through the file.
	return insertTopLevelKey(parsed, key, `${key}: ${formatted}`);
}

/** Remove a top-level key and the line it owns — how `camera:` goes away at zoom 1. */
export function removeSceneKey(
	text: string,
	key: string
): TextEdit | undefined {
	const parsed = parseBlock(text);
	const pair = parsed && findPair(parsed.root, key);

	// The pair owns its whole line, trailing comment included — that comment annotates the
	// value being deleted, so it goes too. `removePairEdit` is the same rule entity keys use.
	return parsed && pair ? removePairEdit(parsed, parsed.root, pair) : undefined;
}
