/**
 * Going BACK, one passage at a time.
 *
 * Chapbook only ever pushes: `go()` appends to `trail`, and the trail is the only history
 * the runtime has. Stepping back is therefore a pop — the same one `<error-handler>` does
 * to survive a bad passage — plus one extra piece of intent that a pop alone cannot carry:
 * the reader is walking backwards, so the scene they land in must open at its LAST beat
 * rather than replay from its first. Re-reading a whole scene to get back to the line you
 * just left is not "back", it is a second viewing.
 *
 * That intent cannot ride on the stage element (it is destroyed and rebuilt by the
 * re-render) or on story state (it would persist into the reader's save), so it lives here
 * as a module-scope note, addressed to a passage name at a trail depth. It is never
 * cleared: a note for "P at depth 4" stops matching the moment the reader moves anywhere
 * else, because every navigation changes the depth, the name, or both.
 */

import {get, set} from '../state';

interface ResumeNote {
	passage: string;
	/** `trail.length` as it will be once the pop has landed. */
	depth: number;
}

let resume: ResumeNote | undefined;

function trail(): string[] {
	const value = get('trail');

	return Array.isArray(value) ? (value as string[]) : [];
}

/** The passage being read right now, per the trail. */
export function currentPassage(): string | undefined {
	const path = trail();

	return path[path.length - 1];
}

/**
 * Pop the trail, and ask the scenes in the passage below to open at their end.
 *
 * `false` when there is nowhere to go — the first passage of the story, or a trail that
 * something else has broken. The caller leaves the key press alone in that case, so the
 * browser's own back gesture still works on a story that has just started.
 */
export function stepBackPassage(): boolean {
	const path = trail();

	if (path.length < 2) {
		return false;
	}

	resume = {depth: path.length - 1, passage: path[path.length - 2]};
	set('trail', path.slice(0, path.length - 1));
	return true;
}

/** Should a stage in this passage open at its last beat? */
export function resumeAtEnd(passage: string | undefined): boolean {
	return Boolean(
		resume &&
			passage !== undefined &&
			resume.passage === passage &&
			resume.depth === trail().length
	);
}

/** Tests only: forget any pending back-step. */
export function clearResume(): void {
	resume = undefined;
}
