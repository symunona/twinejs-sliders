/**
 * "Open the story standing on this beat" — the editor's Alt+T.
 *
 * An author testing a scene is almost never testing its opening shot: they are eight lines
 * in, and playing from the top to get there costs eight clicks and re-cues eight sounds.
 * Alt+T publishes the story with the beat the preview is showing, and the first stage to
 * mount snaps to it.
 *
 * The number rides on `<tw-storydata>` rather than on the URL because the same publish
 * feeds both ways a story gets tested: the web route replaces this tab's DOM, while
 * Electron writes a scratch file and opens it with no query string to read. The attribute
 * is written by `src/util/publish.ts`, which is the one place that knows how to publish a
 * story, and Chapbook itself only ever reads that element, so an extra attribute on it is
 * inert.
 *
 * ONE-SHOT, and deliberately: the request means "this scene, this beat", and a story whose
 * every later scene also jumped to beat eight would be unplayable. Reading it takes it.
 */

const ATTRIBUTE = 'data-sliders-start-beat';

let taken = false;

/**
 * The beat to open on, once, or `undefined` for a normal play.
 *
 * Counted the way the editor's scrubber counts — the number of beats that have already
 * run, so `3` means "after the third beat". `stage-element.ts` turns that into the stop a
 * reader would be standing on.
 */
export function takeStartBeat(): number | undefined {
	if (taken) {
		return undefined;
	}

	taken = true;

	const raw = document.querySelector('tw-storydata')?.getAttribute(ATTRIBUTE);

	if (raw === null || raw === undefined) {
		return undefined;
	}

	const beat = Number.parseInt(raw, 10);

	return Number.isFinite(beat) && beat > 0 ? beat : undefined;
}

/** Tests only — a request taken in one case would be missing from the next. */
export function resetStartBeat(): void {
	taken = false;
}
