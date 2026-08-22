import {
	SYNC_RECORDS_KEY,
	allSyncRecords,
	deleteSyncRecord,
	isStoryDirty,
	resetSyncRecordsForTests,
	storyHash,
	syncRecord,
	updateSyncRecord
} from '../sync-record';
import {storyWithText, testPassage, testStory} from '../test-fixtures';

beforeEach(() => {
	window.localStorage.clear();
	resetSyncRecordsForTests();
});

describe('the sync side table', () => {
	it('round trips through localStorage under one key', () => {
		updateSyncRecord('story-1', {pushedHash: 'aaa', rev: 42});
		resetSyncRecordsForTests();

		expect(syncRecord('story-1')).toEqual({
			pushedHash: 'aaa',
			rev: 42,
			state: 'idle',
			storyId: 'story-1'
		});
		expect(
			JSON.parse(window.localStorage.getItem(SYNC_RECORDS_KEY) as string)
		).toHaveProperty('story-1');
	});

	it('keeps one object for every story', () => {
		updateSyncRecord('a', {rev: 1});
		updateSyncRecord('b', {rev: 2});

		expect(Object.keys(allSyncRecords()).sort()).toEqual(['a', 'b']);

		deleteSyncRecord('a');

		expect(Object.keys(allSyncRecords())).toEqual(['b']);
	});

	it('survives a corrupt table rather than failing a boot', () => {
		window.localStorage.setItem(SYNC_RECORDS_KEY, 'not json');
		resetSyncRecordsForTests();

		expect(allSyncRecords()).toEqual({});
	});
});

describe('storyHash', () => {
	it('ignores a lastUpdate-only change', () => {
		const before = testStory();
		const after = testStory({lastUpdate: new Date('2030-06-06T00:00:00Z')});

		expect(storyHash(after)).toBe(storyHash(before));
	});

	it('ignores selection and highlighting, story and passage alike', () => {
		const before = testStory();
		const after = testStory({
			passages: [testPassage('story-1', {highlighted: true, selected: true})],
			selected: true
		});

		expect(storyHash(after)).toBe(storyHash(before));
	});

	it('ignores the local-only sync flag', () => {
		expect(storyHash(testStory({sync: false}))).toBe(
			storyHash(testStory({sync: true}))
		);
	});

	it('ignores the order keys were written in', () => {
		const story = testStory();
		const reordered = JSON.parse(JSON.stringify(story));

		reordered.lastUpdate = story.lastUpdate;

		expect(storyHash({...reordered, zoom: 1, name: 'Lighthouse'})).toBe(
			storyHash(story)
		);
	});

	it('changes when passage text changes', () => {
		expect(storyHash(storyWithText('s', 'one'))).not.toBe(
			storyHash(storyWithText('s', 'two'))
		);
	});

	it('changes when a passage is added or removed', () => {
		const one = testStory();
		const two = testStory({
			passages: [
				testPassage('story-1'),
				testPassage('story-1', {id: 'p2', name: 'Cliff'})
			]
		});

		expect(storyHash(one)).not.toBe(storyHash(two));
	});
});

describe('isStoryDirty', () => {
	it('is true when nothing has ever been pushed', () => {
		expect(isStoryDirty(testStory())).toBe(true);
	});

	it('is false right after a push, and stays false when only lastUpdate moves', () => {
		const story = testStory();

		updateSyncRecord(story.id, {pushedHash: storyHash(story), rev: 1});

		expect(isStoryDirty(story)).toBe(false);
		expect(
			isStoryDirty({...story, lastUpdate: new Date('2031-01-01T00:00:00Z')})
		).toBe(false);
	});

	it('is true once a passage is edited', () => {
		const story = storyWithText('s', 'one');

		updateSyncRecord(story.id, {pushedHash: storyHash(story), rev: 1});

		expect(isStoryDirty(storyWithText('s', 'two'))).toBe(true);
	});
});
