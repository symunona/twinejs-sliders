/**
 * Checkout is text only now: art arrives through the shared asset library.
 */
import {checkoutStory} from '../checkout-story';
import type {ServerClient} from '../client';
import {resetSyncRecordsForTests, syncRecord} from '../sync-record';
import {testStory} from '../test-fixtures';
import type {StoriesAction} from '../../../stories';

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
});

interface FakeServer {
	client: ServerClient;
	dispatched: StoriesAction[];
}

function fakeServer(): FakeServer {
	const dispatched: StoriesAction[] = [];
	const client = {
		getStory: jest.fn(async () => ({
			rev: 43,
			story: testStory({id: 'story-1', name: 'Lighthouse'})
		}))
	} as unknown as ServerClient;

	return {client, dispatched};
}

describe('checkoutStory', () => {
	it('inserts the story under the server id and ifid, synced', async () => {
		const {client, dispatched} = fakeServer();
		const result = await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			storyId: 'story-1'
		});

		expect(dispatched).toHaveLength(1);
		expect(dispatched[0]).toMatchObject({
			props: {id: 'story-1', ifid: 'IFID-1', sync: true},
			type: 'createStory'
		});
		expect(result.rev).toBe(43);
		expect(syncRecord('story-1')).toMatchObject({rev: 43, state: 'idle'});
	});

	it('records the pushed hash so a fresh checkout is not instantly dirty', async () => {
		const {client, dispatched} = fakeServer();

		await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			storyId: 'story-1'
		});

		expect(syncRecord('story-1')?.pushedHash).not.toBe('');
	});

	it('renames around a local story that already owns the name', async () => {
		const {client, dispatched} = fakeServer();

		await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [testStory({id: 'other', name: 'Lighthouse'})],
			storyId: 'story-1'
		});

		expect(dispatched[0]).toMatchObject({
			props: {id: 'story-1', name: 'Lighthouse 1'}
		});
	});

	it('never touches art: one GET, no asset calls', async () => {
		const {client, dispatched} = fakeServer();

		await checkoutStory({
			client,
			dispatch: action => dispatched.push(action as StoriesAction),
			stories: [],
			storyId: 'story-1'
		});

		expect(Object.keys(client)).toEqual(['getStory']);
	});
});
