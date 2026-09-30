/**
 * Where the scrubber stands when the preview changes passage: state 0.
 *
 * State 0 is the stage before any beat has run — the cast as `cast:` declared it. It is
 * also where an edit lands on the scene's defaults: grabbing a character there moves its
 * `cast:` entry, not the first beat's. Arriving on beat 1 made the first drag write a
 * beat override, which is rarely what an author opening a passage means to change.
 *
 * Keyed on the passage alone, so an author who scrubbed to beat 6 and keeps typing stays
 * on beat 6 — later parses of the same passage leave the position alone.
 */

import * as React from 'react';

export function useArrivalBeat(
	passageId: string | undefined,
	setBeat: (beat: number) => void
): void {
	React.useEffect(() => {
		setBeat(0);
	}, [passageId, setBeat]);
}
