/*
Parses passage text for links in every syntax this editor understands: Twine's own
`[[…]]`, plus the `links:` block of a Sliders `[scene]`.

Core only ever knew `[[…]]` (see parse-links.ts). A scene declares its choices in YAML
instead, so without this a scene-only link is not a link as far as the rest of the app is
concerned: it goes unreported when it is broken, and the story map draws it as a
second-class dashed reference rather than a real arrow.
*/

import uniq from 'lodash/uniq';
import {extractSceneBlock} from '@sliders/scene-index';
import {
	sceneEntityLinkTargets,
	sceneLinkTargets
} from '@sliders/scene-schema';
import {parseLinks} from './parse-links';

// Links _not_ starting with a protocol, e.g. abcd://. Same test parse-links.ts applies.
const internalLink = (link: string) => !/^\w+:\/\/\/?\w/i.test(link);

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
	].filter(target => target !== '' && (!internalOnly || internalLink(target)));

	return uniq([...parseLinks(text, internalOnly), ...sceneLinks]);
}
