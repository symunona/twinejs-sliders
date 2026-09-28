/*
Parses passage text for links in every syntax this editor understands: Twine's own
`[[…]]`, plus the `links:` block of a Sliders `[scene]`.

Core only ever knew `[[…]]` (see parse-links.ts). A scene declares its choices in YAML
instead, so without this a scene-only link is not a link as far as the rest of the app is
concerned: it goes unreported when it is broken, and the story map draws it as a
second-class dashed reference rather than a real arrow.
*/

import uniq from 'lodash/uniq';
import {extractSceneBlock, splitSceneRef} from '@sliders/scene-index';
import {
	sceneEntityLinkTargets,
	sceneLinkTargets
} from '@sliders/scene-schema';
import {isInternalLink, parseLinks} from './parse-links';

/**
 * Returns a list of unique links in passage source code, optionally internal ones only.
 *
 * The scene scan runs only on a passage that actually holds a `[scene]` block, and only
 * over the block itself. Core is shared with Harlowe, SugarCube and Chapbook stories,
 * where `links:` is just a word someone might write in prose or use as a variable name —
 * scanning unconditionally would invent links in a story that has never heard of a scene.
 * `extractSceneBlock` is the same gate the passage editor and the scene index use, so all
 * three agree on where a scene starts and stops.
 */
export function passageLinks(text: string, internalOnly?: boolean): string[] {
	const block = extractSceneBlock(text);

	if (!block) {
		return parseLinks(text, internalOnly);
	}

	// Both scene spellings: the `links:` block the reader is offered as choices, and the
	// `link:` on an entity the reader clicks. A clickable door is a real exit from this
	// passage, so the map must draw it, a rename must follow it and a broken one must get
	// a ghost card — none of which happens for a target nothing reports.
	const sceneLinks = [
		...sceneLinkTargets(block.text).values(),
		...sceneEntityLinkTargets(block.text)
	].filter(target => target !== '' && (!internalOnly || isInternalLink(target)));

	return uniq([...parseLinks(text, internalOnly), ...sceneLinks]);
}

/** A top-level `from:` in a scene block, capturing its value. */
const FROM_LINE_RE = /^from[ \t]*:[ \t]*(.*)$/m;

/**
 * The passage a scene's `from:` inherits its stage from, as a one-item list so it fits
 * `passageConnections`' parser slot. Empty when the passage has no scene or no `from:`.
 *
 * A line scan, not `parseScene`, for the same reason as the `links:` pass: it runs on every
 * passage on every keystroke and must survive a half-typed block. The `@mark` half of
 * `Tavern@tense` is dropped — the map draws passages, not marks.
 */
export function passageDerivedFrom(text: string): string[] {
	const block = extractSceneBlock(text);
	const match = block && FROM_LINE_RE.exec(block.text);

	if (!match) {
		return [];
	}

	const value = match[1]
		.replace(/\s+#.*$/, '')
		.trim()
		.replace(/^(['"])(.*)\1$/, '$2');
	const {id} = splitSceneRef(value);

	return id === '' || id === '~' || id === 'null' ? [] : [id];
}
