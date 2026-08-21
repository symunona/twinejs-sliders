/**
 * Which passages in the story have broken scenes, for the story map (warning badge and a
 * dashed outline on the card).
 *
 * The passage editor already parses one passage at a time; this is the same parse run
 * over every passage at once, so the map can show trouble without the author having to
 * open each card to find it.
 *
 * Two things keep that affordable:
 *
 *   - `parseSceneText` bails immediately on a passage with no `[scene]` block, which is
 *     most of them.
 *   - results are cached per passage text, under a key describing everything OUTSIDE the
 *     passage that its errors depend on — the story's passage names (link targets) and
 *     its vars sections (`if:` conditions). Typing inside one scene therefore reparses
 *     that one passage, not the whole story.
 */

import * as React from 'react';
import {parseSceneText} from '../../dialogs/passage-edit/scene-preview/use-scene-parse';
import {passageVariables} from '../../dialogs/passage-edit/scene-preview/validate-vars';
import {Passage} from '../../store/stories';

/** Passage ID -> how many error-severity problems its scene has. Clean passages are absent. */
export type PassageErrorCounts = Record<string, number>;

/**
 * Cache of passage text -> error count, valid only for one story context. Module-level so
 * that leaving the story map and coming back does not throw the work away.
 */
let cache = new Map<string, number>();
let cacheKey: string | undefined;

/** Bounded so a long editing session cannot grow the cache without limit. */
const maxCacheEntries = 2000;

/**
 * Everything outside a passage that changes what its errors are: the names other passages
 * can be linked to, and the variables their vars sections set. `passageVariables` gives up
 * on the first line that is not `name: value`, so this stays cheap on prose.
 */
function storyContextKey(passages: Passage[]): string {
	return passages
		.map(passage => `${passage.name} ${passageVariables(passage.text).join(',')}`)
		.join('\n');
}

/** Scans every passage. Exported unmemoized so tests can call it directly. */
export function storySceneErrors(passages: Passage[]): PassageErrorCounts {
	const key = storyContextKey(passages);

	if (key !== cacheKey || cache.size > maxCacheEntries) {
		cache = new Map();
		cacheKey = key;
	}

	const indexed = passages.map(passage => ({
		name: passage.name,
		text: passage.text
	}));
	const counts: PassageErrorCounts = {};

	for (const passage of passages) {
		let count = cache.get(passage.text);

		if (count === undefined) {
			count = parseSceneText(passage.text, indexed).errors.filter(
				error => error.severity === 'error'
			).length;
			cache.set(passage.text, count);
		}

		if (count > 0) {
			counts[passage.id] = count;
		}
	}

	return counts;
}

/**
 * Debounced version for the story map. The delay is longer than the editor's own 200ms:
 * the badge on a card is glanced at, not typed against, and the scan is story-wide.
 */
export function useStorySceneErrors(
	passages: Passage[],
	delay = 500
): PassageErrorCounts {
	const [counts, setCounts] = React.useState<PassageErrorCounts>({});

	// Text and name are all the scan reads; position and selection change constantly and
	// must not trigger one.
	const signature = React.useMemo(
		() =>
			passages
				.map(passage => `${passage.id} ${passage.name} ${passage.text}`)
				.join('\n'),
		[passages]
	);

	// Read through a ref so that `signature` alone decides when to rescan.
	const latest = React.useRef(passages);

	latest.current = passages;

	React.useEffect(() => {
		const timer = window.setTimeout(
			() => setCounts(storySceneErrors(latest.current)),
			delay
		);

		return () => window.clearTimeout(timer);
	}, [delay, signature]);

	return counts;
}
