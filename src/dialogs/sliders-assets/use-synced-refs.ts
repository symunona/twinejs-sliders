/**
 * Which of the art this story can see its scenes actually use — the "Unused" badge.
 *
 * The same answer the library's usage refs are built from (`storyAssetRefs` in
 * `store/asset-library/library-provider.tsx`): `collectAssetRefs` + `resolveBundleRefs`
 * over the story's resolved view. One derivation, so the badge and `usage()` cannot drift.
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
