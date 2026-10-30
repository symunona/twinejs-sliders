import * as React from 'react';
import type {ServerClient} from './client';
import type {RevisionsResponse, StoryIndexEntry} from './server.types';

/**
 * When a story was made, as far as the server can still tell.
 *
 * Neither the local `Story` nor the server's `meta.json` stores a creation time. The best
 * source left is the revision history: every snapshot keeps the `at` of the version it
 * holds. `exact` only when rev 1 is still there -- `REV_KEEP` prunes old unpinned
 * snapshots, and an unchanged write takes no snapshot at all, so past that the oldest
 * kept version is an upper bound, not the answer.
 */
export interface StoryCreated {
	at: string;
	exact: boolean;
}

export function storyCreatedFromRevisions(
	revisions: RevisionsResponse,
	entry?: Pick<StoryIndexEntry, 'rev' | 'updatedAt'>
): StoryCreated | undefined {
	let oldest: RevisionsResponse['revisions'][number] | undefined;

	for (const revision of revisions.revisions) {
		if (!oldest || revision.rev < oldest.rev) {
			oldest = revision;
		}
	}

	if (oldest) {
		return {at: oldest.at, exact: oldest.rev === 1};
	}

	// No snapshots: the current version is the only one there is.

	if (entry) {
		return {at: entry.updatedAt, exact: entry.rev === 1};
	}

	return undefined;
}

/**
 * Creation dates for story cards, fetched one story at a time on demand.
 *
 * `peek(id)` asks once per story while the library is up -- a story's creation does not move, so a
 * hit is kept and a miss (offline, 404) is retried on the next hover. No client, no
 * fetch: a library without a server has no dates to give.
 */
export function useStoryCreated(
	client: Pick<ServerClient, 'listRevisions'> | undefined,
	index: StoryIndexEntry[] | undefined
) {
	const [created, setCreated] = React.useState<Record<string, StoryCreated>>(
		{}
	);
	const asked = React.useRef(new Set<string>());
	const indexRef = React.useRef(index);

	indexRef.current = index;

	const peek = React.useCallback(
		(storyId: string) => {
			const entry = indexRef.current?.find(item => item.id === storyId);

			if (!client || !entry || asked.current.has(storyId)) {
				return;
			}

			asked.current.add(storyId);
			client.listRevisions(storyId).then(
				revisions => {
					const result = storyCreatedFromRevisions(revisions, entry);

					if (result) {
						setCreated(current => ({...current, [storyId]: result}));
					}
				},
				() => asked.current.delete(storyId)
			);
		},
		[client]
	);

	return {created, peek};
}
