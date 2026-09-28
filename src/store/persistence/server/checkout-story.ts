/**
 * Checking a server story out into the local library (spec 11).
 *
 * Text only. Art used to come down here too, through the bundle-import rules, and the
 * card waited for it. The shared asset library (`store/asset-library`) now syncs every
 * record on its own and fetches blobs lazily, so a checkout is one GET and one dispatch.
 */

import {unusedName} from '../../../util/unused-name';
import type {StoriesDispatch, Story} from '../../stories';
import type {ServerClient} from './client';
import {deleteSyncRecord, storyHash, updateSyncRecord} from './sync-record';

export interface CheckoutProgress {
	phase: 'story';
	done: number;
	total: number;
}

export interface CheckoutResult {
	story: Story;
	rev: number;
}

export interface CheckoutStoryOptions {
	client: ServerClient;
	storyId: string;
	dispatch: StoriesDispatch;
	/** Current local stories, for the id and name checks. */
	stories: Story[];
	onProgress?: (progress: CheckoutProgress) => void;
}

export async function checkoutStory(
	options: CheckoutStoryOptions
): Promise<CheckoutResult> {
	const {client, dispatch, onProgress, stories, storyId} = options;

	onProgress?.({done: 0, phase: 'story', total: 1});

	const fetched = await client.getStory(storyId);

	if (fetched === 'not-modified') {
		// Only sent when we ask with `If-None-Match`, which a checkout never does.
		throw new Error(
			'The server said the story was unchanged, but we have no copy.'
		);
	}

	const {rev, story} = fetched;
	const existing = stories.find(local => local.id === story.id);

	// The server's id and ifid are kept: they are what makes this the same story as
	// everyone else's copy. Only the name can be adjusted, and only because the reducer
	// silently refuses a duplicate name rather than failing loudly.
	const name = unusedName(
		story.name,
		stories.filter(local => local.id !== story.id).map(local => local.name)
	);
	const local: Story = {...story, name, sync: true};

	if (existing) {
		dispatch({props: {...local}, storyId: story.id, type: 'updateStory'});
	} else {
		dispatch({props: local, type: 'createStory'});
	}

	// A checkout takes the server's copy wholesale, so whatever this browser thought it
	// knew about the story is void — including a rev left over from a different backend,
	// whose counter has nothing to do with this one's. Records are monotonic in `rev`
	// (`sync-record.ts`); dropping the record first is the explicit escape from that, the
	// same one `publish()` uses.
	deleteSyncRecord(story.id);
	updateSyncRecord(story.id, {
		conflictClient: undefined,
		conflictRev: undefined,
		lastError: undefined,
		lastPulledAt: Date.now(),
		pushedHash: storyHash(local),
		rev,
		state: 'idle'
	});

	onProgress?.({done: 1, phase: 'story', total: 1});

	return {rev, story: local};
}
