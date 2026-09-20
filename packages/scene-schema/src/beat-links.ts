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

import type {Beat, EntityLink, Scene} from '@sliders/scene-types';
import {scanWikiLinks} from './links';

/** The text a beat shows the reader, or nothing for the beats that show none. */
function beatText(beat: Beat): string | undefined {
	return beat.kind === 'say' || beat.kind === 'box' ? beat.text : undefined;
}

/** A beat's patch carries the entity `link:`; only `say` and `set` beats have one. */
function beatLink(beat: Beat): EntityLink | null | undefined {
	return 'patch' in beat ? beat.patch?.link : undefined;
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
		const link = beatLink(beat);

		if (link && followable(link, liveLinks)) {
			return true;
		}

		const text = beatText(beat);

		if (text === undefined) {
			continue;
		}

		for (const wiki of scanWikiLinks(text)) {
			// `[[stay -> Street]]` states its own target; `[[stay]]` needs a live entry.
			if (wiki.target !== undefined || liveLinks.has(wiki.name)) {
				return true;
			}
		}
	}

	return false;
}
