/**
 * Where the scrubber stands when the preview changes passage.
 *
 * State 0 is the stage before any beat has run: the cast as `cast:` declared it, nobody
 * speaking. For a scene that has beats that is a moment the reader never sees, so opening
 * a passage on it shows a picture the story does not contain — no bubble, and often a pose
 * the first beat immediately replaces. The first beat is the scene's actual opening shot,
 * so that is what an author arriving at a passage gets.
 *
 * It waits for a parse rather than acting on the passage change alone, because
 * `useSceneParse` is debounced: the render where `passageId` flips still carries the new
 * editor's EMPTY parse, and "does this scene have beats" is not answerable yet. The flag
 * is one-shot per passage, so an author who scrubbed to beat 6 and keeps typing stays on
 * beat 6 — every later parse leaves the position alone.
 */

import * as React from 'react';
import type {SceneParse} from './use-scene-parse';

export function useFirstBeat(
	passageId: string | undefined,
	parse: SceneParse,
	setBeat: (beat: number) => void
): void {
	// True from mount: opening the preview on a passage is an arrival like any other.
	const pending = React.useRef(true);

	React.useEffect(() => {
		pending.current = true;
		setBeat(0);
	}, [passageId, setBeat]);

	React.useEffect(() => {
		if (!pending.current || !parse.hasScene) {
			return;
		}

		pending.current = false;
		// states = S0..Sn, so anything past the first entry means the scene has beats.
		setBeat(parse.states.length > 1 ? 1 : 0);
	}, [parse, setBeat]);
}
