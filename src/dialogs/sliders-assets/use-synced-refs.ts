/**
 * Which of this story's art the server would actually receive.
 *
 * A push uploads what the story *references*, not what the library holds: `syncStoryAssets`
 * runs `collectAssetRefs` + `resolveBundleRefs` and writes a manifest of exactly that. So an
 * asset nobody has named in a `[scene]` block yet lives on this machine and nowhere else.
 * That is deliberate — art the story does not use is not worth the bytes — but it is
 * invisible, and the way it becomes visible today is that someone opens the story on
 * another machine and finds a character missing.
 *
 * This hook exists to put a badge on those tiles before that happens. It calls the same two
 * functions the push does rather than re-deriving "referenced" from the scene YAML: a second
 * answer to that question would drift, and it would drift by telling the author their art is
 * safe when it is not.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import * as React from 'react';
import {collectAssetRefs, resolveBundleRefs} from '../../util/sliders-bundle';
import {useStoriesContext} from '../../store/stories';
import type {Story} from '../../store/stories';
import {
	useAssetScope,
	useAssetStore,
	useLibraryVersion
} from './asset-store-context';

export interface SyncedRefs {
	/** Ids of assets a push would upload. */
	assetIds: Set<string>;
	/** Ids of characters a push would send. */
	characterIds: Set<string>;
	/**
	 * False until the first scan finishes. Nothing is marked while it is false — a tile
	 * that flashes "unused" on every open would train the author to ignore the badge.
	 */
	ready: boolean;
}

const EMPTY: SyncedRefs = {
	assetIds: new Set(),
	characterIds: new Set(),
	ready: false
};

/** The resolve is over the whole library, so only redo it when the answer could change. */
export async function resolveSyncedRefs(
	store: AssetStore,
	story: Story
): Promise<{assets: AssetMeta[]; characters: Character[]}> {
	const resolved = await resolveBundleRefs(store, collectAssetRefs(story));

	return {assets: resolved.assets, characters: resolved.characters};
}

export function useSyncedRefs(): SyncedRefs {
	const storyId = useAssetScope();
	const store = useAssetStore();
	const version = useLibraryVersion();
	const {stories} = useStoriesContext();
	// The dialog lives inside the story route, so this is only undefined in the frame
	// where the story is being deleted out from under it.
	const story = stories.find(candidate => candidate.id === storyId);
	const [refs, setRefs] = React.useState<SyncedRefs>(EMPTY);

	// Passage text changes on every keystroke, and almost none of those keystrokes change
	// which assets are named. Keying the scan on the refs themselves collapses the rest.
	const refsKey = React.useMemo(
		() => (story ? JSON.stringify(collectAssetRefs(story)) : ''),
		[story]
	);

	React.useEffect(() => {
		let current = true;

		if (!story) {
			setRefs(EMPTY);
			return;
		}

		async function scan(target: Story) {
			try {
				const {assets, characters} = await resolveSyncedRefs(store, target);

				if (current) {
					setRefs({
						assetIds: new Set(assets.map(meta => meta.id)),
						characterIds: new Set(characters.map(character => character.id)),
						ready: true
					});
				}
			} catch (error) {
				// A library that will not resolve is a bigger problem than a missing
				// badge, and the grid it decorates has its own error path. Mark nothing.
				console.error('Could not work out which assets this story uses', error);

				if (current) {
					setRefs(EMPTY);
				}
			}
		}

		scan(story);
		return () => {
			current = false;
		};
		// `refsKey` stands in for `story`: same refs, same answer.
	}, [refsKey, store, version]);

	return refs;
}
