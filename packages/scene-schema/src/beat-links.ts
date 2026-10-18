/**
 * Does the scene put a way out on the STAGE?
 *
 * The player draws the scene's `links:` a second time as ordinary Chapbook links under the
 * stage (`scene-modifier.ts`). That list is the only way out of a scene whose beats offer
 * none — and pure duplication in a scene whose beats do, where it also spoils the choice
 * by showing it before the line that poses it has been read. So the player asks this, and
 * draws the list only when the beats leave the reader nowhere to click.
 *
 * "A link in the beats" is either form:
 *
 *   - `[[…]]` in a `say:` or `box:` line, which the renderer turns into an `<a>`;
 *   - `link:` in a beat's patch, which makes an entity clickable from that beat on.
 *
 * A link that cannot be followed does not count, because hiding the list for one would
 * strand the reader: a bare `[[stay]]` is a NAME, dead unless `links:` claims it, and a
 * `link: escape` is dead once `escape` has been filtered out by its own `if:`. Pass the
 * names that survived that filter as `liveLinks`; the default is "every entry", which is
 * what a host with no story state to evaluate `if:` against can say.
 */

import {beatLines, beatParts} from '@sliders/scene-types';
import type {Beat, EntityLink, Scene} from '@sliders/scene-types';
import {scanWikiLinks} from './links';

/** Every text a beat shows the reader: the box and each speaker's words. */
function beatTexts(beat: Beat): string[] {
	return beatLines(beat).map(line => line.text);
}

/** Every entity `link:` a beat's patches set — its first entity's and each `with:` part's. */
function beatLinkList(beat: Beat): (EntityLink | null | undefined)[] {
	return beatParts(beat).map(part => part.patch?.link);
}

function followable(link: EntityLink, liveLinks: ReadonlySet<string>): boolean {
	// A named entry resolves through the filtered map, exactly as the player does it.
	if (link.name !== undefined) {
		return liveLinks.has(link.name);
	}

	return typeof link.to === 'string' && link.to !== '';
}

export function beatsOfferLinks(
	scene: Scene,
	liveLinks: ReadonlySet<string> = new Set(Object.keys(scene.links ?? {}))
): boolean {
	for (const beat of scene.beats ?? []) {
		for (const link of beatLinkList(beat)) {
			if (link && followable(link, liveLinks)) {
				return true;
			}
		}

		for (const text of beatTexts(beat)) {
			for (const wiki of scanWikiLinks(text)) {
				// `[[stay -> Street]]` states its own target; `[[stay]]` needs a live entry.
				if (wiki.target !== undefined || liveLinks.has(wiki.name)) {
					return true;
				}
			}
		}
	}

	return false;
}
