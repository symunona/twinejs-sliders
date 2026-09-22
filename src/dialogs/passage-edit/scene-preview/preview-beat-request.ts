/**
 * "Show me this passage, standing on this beat" — from outside the preview.
 *
 * The scrubber is local state inside `ScenePreview`, and deliberately so: it moves on
 * every caret change and lifting it into a context would re-render the story map for each
 * one. But voice mode's `open_preview(ref, beat)` has to reach it, and the dialog may not
 * even be mounted at the moment the tool runs.
 *
 * So a request is a module-level letter rather than a prop: whoever mounts next and
 * matches the passage opens it. It survives the debounce in `useSceneParse` — a request
 * placed before the parse lands is applied when it does — and it is one-shot, because a
 * request that stuck would fight the author's own scrubbing forever.
 *
 * Same shape as `refreshAssetLibrary` in `asset-store-context`, for the same reason.
 */

import * as React from 'react';
import type {SceneParse} from './use-scene-parse';

interface BeatRequest {
	/** 0-based index into the scene's `beats:`, the way `set_beat` counts. */
	beat: number;
	passageId: string;
}

let pending: BeatRequest | undefined;
const listeners = new Set<() => void>();

/** Ask the preview to stand on a beat. Replaces any request not yet taken. */
export function requestPreviewBeat(passageId: string, beat: number): void {
	pending = {beat: Math.max(0, Math.trunc(beat)), passageId};
	listeners.forEach(listener => listener());
}

/** Tests only — a request left over from one case would steer the next. */
export function clearPreviewBeatRequest(): void {
	pending = undefined;
}

/**
 * Applies a pending request for this passage, once the parse can answer how many beats
 * there are.
 *
 * Runs after `useFirstBeat`, and wins: an explicit "beat 4" is a later instruction than
 * "this is a new passage, go to its opening shot".
 *
 * The scrubber counts STATES, not beats — state 0 is the stage before anything has run,
 * so beat N is state N+1. Clamped to the last state the parse produced, because a model
 * asking for beat 9 of a six-beat scene should see the end of the scene rather than
 * nothing at all.
 */
export function useRequestedBeat(
	passageId: string | undefined,
	parse: SceneParse,
	setBeat: (beat: number) => void
): void {
	const [version, setVersion] = React.useState(0);

	React.useEffect(() => {
		const listener = () => setVersion(current => current + 1);

		listeners.add(listener);

		return () => {
			listeners.delete(listener);
		};
	}, []);

	React.useEffect(() => {
		if (
			pending === undefined ||
			passageId === undefined ||
			pending.passageId !== passageId ||
			!parse.hasScene
		) {
			return;
		}

		const wanted = Math.min(pending.beat + 1, parse.states.length - 1);

		pending = undefined;
		setBeat(Math.max(0, wanted));
	}, [parse, passageId, setBeat, version]);
}
