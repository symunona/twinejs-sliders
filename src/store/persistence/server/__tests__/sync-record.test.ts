import {
	SYNC_RECORDS_KEY,
	allSyncRecords,
	deleteSyncRecord,
	isStoryDirty,
	localSyncRecordStore,
	memorySyncRecordStore,
	resetSyncRecordsForTests,
	storyHash,
	syncRecord,
	updateSyncRecord
} from '../sync-record';
import type {Story} from '../../../stories';
import {storyDefaults} from '../../../stories/defaults';
import {incomingStory, outgoingStory} from '../client';
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

describe('the record store seam', () => {
	it('keeps two memory stores apart', () => {
		const a = memorySyncRecordStore();
		const b = memorySyncRecordStore();

		a.update('s1', {rev: 5});

		expect(a.get('s1').rev).toBe(5);
		expect(b.get('s1').rev).toBe(0);
		expect(window.localStorage.getItem(SYNC_RECORDS_KEY)).toBeNull();
	});

	it('mints a default record for a story it has never seen', () => {
		expect(memorySyncRecordStore().get('nope')).toEqual({
			pushedHash: '',
			rev: 0,
			state: 'idle',
			storyId: 'nope'
		});
	});

	it('does not let a caller mutate it through the seed or through all()', () => {
		const seed = {s1: {pushedHash: 'a', rev: 1, state: 'idle' as const, storyId: 's1'}};
		const store = memorySyncRecordStore(seed);

		delete (seed as Record<string, unknown>).s1;
		store.all().s2 = {pushedHash: '', rev: 9, state: 'idle', storyId: 's2'};

		expect(store.get('s1').rev).toBe(1);
		expect(store.all().s2).toBeUndefined();
	});

	it('removes a record', () => {
		const store = memorySyncRecordStore();

		store.update('s1', {rev: 1});
		store.remove('s1');

		expect(Object.keys(store.all())).toEqual([]);
	});

	it('reads and writes localStorage through the local store', () => {
		const store = localSyncRecordStore();

		store.update('s1', {rev: 3});
		resetSyncRecordsForTests();

		expect(store.get('s1').rev).toBe(3);
	});
});

describe('what counts as a change worth pushing', () => {
	it('ignores how this browser is looking at the map', () => {
		const story = testStory();

		// `zoom` and `snapToGrid` used to be hashed, so scrolling marked a story dirty
		// and any incoming edit then read as a conflict rather than a pull.
		expect(storyHash({...story, snapToGrid: !story.snapToGrid, zoom: 0.25})).toBe(
			storyHash(story)
		);
	});

	it('ignores selection, highlight and the clock', () => {
		const story = testStory();

		expect(
			storyHash({
				...story,
				lastUpdate: new Date('2030-06-01T00:00:00.000Z'),
				passages: [testPassage(story.id, {highlighted: true, selected: true})],
				selected: true
			})
		).toBe(storyHash(story));
	});

	it('still notices the things an author actually wrote', () => {
		const story = testStory();
		const changes: Partial<Story>[] = [
			{name: 'Other'},
			{script: 'x'},
			{startPassage: 'p2'},
			{stylesheet: 'body {}'},
			{storyFormatVersion: '9.9.9'},
			{tags: ['draft']},
			{tagColors: {draft: 'red'}},
			{passages: [testPassage(story.id, {text: 'different'})]},
			{passages: [testPassage(story.id, {left: 400})]},
			{passages: [testPassage(story.id, {name: 'Renamed'})]},
			{passages: [testPassage(story.id, {tags: ['end']})]}
		];

		for (const change of changes) {
			expect(storyHash({...story, ...change})).not.toBe(storyHash(story));
		}
	});
});

describe('view state never travels', () => {
	it('strips how this browser is looking at the map', () => {
		const sent = outgoingStory(
			testStory({selected: true, snapToGrid: true, sync: true, zoom: 0.25})
		) as Partial<Story>;

		expect(sent.zoom).toBeUndefined();
		expect(sent.snapToGrid).toBeUndefined();
		expect(sent.selected).toBeUndefined();
		expect(sent.sync).toBeUndefined();
		// The story itself is untouched.
		expect(sent.name).toBe('Lighthouse');
		expect(sent.passages).toHaveLength(1);
	});

	it('ignores the view props a server still holds from before the strip', () => {
		const story = testStory({snapToGrid: true, zoom: 0.25});
		const arrived = incomingStory({
			...story,
			lastUpdate: story.lastUpdate.toISOString()
		});

		expect(arrived.zoom).toBe(storyDefaults().zoom);
		expect(arrived.snapToGrid).toBe(storyDefaults().snapToGrid);
	});
});
