/**
 * Follow a passage rename into the scene block's YAML.
 *
 * Twine relinks by rewriting `[[…]]`, which is the only way a stock passage names another
 * one. A sliders scene has two more, and neither is a wiki link:
 *
 *   links:            # `to:`, and the `name: Target` shorthand
 *     go: {to: Tavern}
 *     back: Tavern
 *   from: Tavern      # inherits another passage's stage
 *
 * Rename the target and those keep pointing at a passage that no longer exists — the link
 * validator lights up and the author has to go find them by hand.
 *
 * Edits are SPLICED at the node ranges the YAML parser reports, never re-serialized: the
 * block is the author's own text, and round-tripping it through `stringify` would reflow
 * their flow maps, comments and blank lines on a rename they didn't ask to reformat.
 */

import {isMap, isScalar, parseDocument, stringify, Scalar, YAMLMap} from 'yaml';
import {extractSceneBlock} from '@sliders/scene-index';

/** A scalar to replace, as a character range within the BLOCK text. */
interface Target {
	start: number;
	end: number;
	/** Inside `{…}`, where a plain scalar may not contain a comma or a brace. */
	flow: boolean;
}

/**
 * The new name as YAML.
 *
 * `stringify` decides on quoting for block context — a name like `42` or `yes` has to come
 * back quoted or it stops being a string. Flow context is stricter than `stringify` knows
 * here (the scalar's own node is gone), so anything a `{…}` would end early is quoted too.
 */
function scalarText(name: string, flow: boolean): string {
	const written = stringify(name, {version: '1.2'}).trim();

	if (flow && /^[^'"].*[,{}[\]]/.test(written)) {
		return JSON.stringify(name);
	}

	return written;
}

function collect(
	node: unknown,
	oldName: string,
	flow: boolean,
	targets: Target[]
): void {
	if (
		isScalar(node) &&
		(node as Scalar).value === oldName &&
		Array.isArray(node.range)
	) {
		targets.push({start: node.range[0], end: node.range[1], flow});
	}
}

/** Every place the scene block names a passage, in the order they were written. */
function sceneTargets(blockText: string, oldName: string): Target[] {
	// Same YAML version the scene parser uses, so this module and the preview never
	// disagree about what a scalar says.
	const doc = parseDocument(blockText, {version: '1.2'});

	// The parser RECOVERS from a syntax error rather than throwing, and the tree it
	// recovers is a guess — splicing at ranges taken from a guess would edit the author's
	// half-typed block into something they never wrote. A stale target is visible and
	// fixable; a mangled block is neither.
	if (doc.errors.length > 0) {
		return [];
	}

	const root = doc.contents;

	if (!isMap(root)) {
		return [];
	}

	const targets: Target[] = [];

	for (const pair of (root as YAMLMap).items) {
		const key = isScalar(pair.key) ? pair.key.value : undefined;

		if (key === 'from') {
			collect(pair.value, oldName, false, targets);
		} else if (key === 'links' && isMap(pair.value)) {
			const links = pair.value as YAMLMap;

			for (const link of links.items) {
				// `back: Tavern` — the target IS the value.
				collect(link.value, oldName, !!links.flow, targets);

				if (isMap(link.value)) {
					const props = link.value as YAMLMap;

					for (const prop of props.items) {
						if (isScalar(prop.key) && prop.key.value === 'to') {
							collect(prop.value, oldName, !!props.flow, targets);
						}
					}
				}
			}
		}
	}

	return targets;
}

/**
 * `passageText` with every scene-block reference to `oldName` pointing at `newName`.
 *
 * Returns the text unchanged when there is no scene block, nothing to rename, or the block
 * does not parse. Beat text is left alone: an inline `[[go -> Tavern]]` is a wiki link and
 * Twine's own relinking already covers it.
 */
export function renameSceneTargets(
	passageText: string,
	oldName: string,
	newName: string
): string {
	if (!oldName || oldName === newName || !passageText.includes(oldName)) {
		return passageText;
	}

	const block = extractSceneBlock(passageText);

	if (!block || !block.text.includes(oldName)) {
		return passageText;
	}

	const targets = sceneTargets(block.text, oldName);

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
			scalarText(newName, target.flow) +
			result.slice(end);
	}

	return result;
}
