/**
 * The way back through scenes the preview walked into.
 *
 * "Next" past a scene's last beat opens the passage its one link goes to, and the preview
 * arrives there on state 0. Without a trail, "previous" on that state 0 has nowhere to go:
 * the author pressed forward through two scenes and cannot press back through them. So
 * every hop the preview makes records where it left from -- the passage and the state the
 * scrubber stood on -- and "previous" on the arrival state walks the hop back, landing on
 * the beat the author left, not on the start of the old scene.
 *
 * Module-level for the same reason as `preview-beat-request`: the scrubber is local state,
 * and the hop outlives whichever passage the preview was showing when it was made.
 *
 * A hop only counts while the preview is still on the passage it arrived at. Opening some
 * other passage from the map is not a hop, so "previous" there must not jump back into a
 * scene the author left long ago; `hopInto` checks the top of the trail against where the
 * preview actually is.
 */

export interface SceneHop {
	/** The passage the preview left. */
	fromId: string;
	fromName: string;
	/** The scrubber's state when it left: state N is the stage after N beats. */
	fromState: number;
	/** The passage it arrived at. */
	toId: string;
}

/** Long enough for any walk an author does by hand; stops a long session growing it. */
const LIMIT = 50;

let trail: SceneHop[] = [];

/** Record a hop the preview is about to make. */
export function pushSceneHop(hop: SceneHop): void {
	trail = [...trail, hop].slice(-LIMIT);
}

/** The hop that brought the preview to this passage, if it is still standing there. */
export function hopInto(passageId: string | undefined): SceneHop | undefined {
	const top = trail[trail.length - 1];

	return top && passageId !== undefined && top.toId === passageId
		? top
		: undefined;
}

/** Walk the last hop back. Returns it, or nothing if this passage was not reached by one. */
export function popSceneHop(
	passageId: string | undefined
): SceneHop | undefined {
	const hop = hopInto(passageId);

	if (hop) {
		trail = trail.slice(0, -1);
	}

	return hop;
}

/** Tests only -- a trail left over from one case would steer the next. */
export function clearSceneTrail(): void {
	trail = [];
}
