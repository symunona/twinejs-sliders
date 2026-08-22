import {
	hasPersistableChange,
	reconcileDecision,
	type ReconcileInput
} from '../use-server-sync';
import {storyWithText, testPassage, testStory} from '../test-fixtures';

/** One case per row of spec 11's "Connect / refresh" table. */
describe('reconcileDecision', () => {
	const server = {deleted: false, rev: 43};

	function decide(input: ReconcileInput) {
		return reconcileDecision(input);
	}

	it('no local copy, present on the server -> ghost', () => {
		expect(decide({server})).toBe('ghost');
	});

	it('sync off, present on the server -> nothing', () => {
		expect(decide({local: {dirty: true, rev: 0, sync: false}, server})).toBe(
			'none'
		);
	});

	it('synced, clean and behind -> pull', () => {
		expect(decide({local: {dirty: false, rev: 42, sync: true}, server})).toBe(
			'pull'
		);
	});

	it('synced, dirty and behind -> conflict', () => {
		expect(decide({local: {dirty: true, rev: 42, sync: true}, server})).toBe(
			'conflict'
		);
	});

	it('synced, server holds a tombstone -> gone', () => {
		expect(
			decide({
				local: {dirty: false, rev: 43, sync: true},
				server: {deleted: true, rev: 44}
			})
		).toBe('gone');
	});

	it('synced, absent from the server entirely -> gone', () => {
		expect(decide({local: {dirty: false, rev: 43, sync: true}})).toBe('gone');
	});

	it('synced, dirty and up to date -> push', () => {
		expect(decide({local: {dirty: true, rev: 43, sync: true}, server})).toBe(
			'push'
		);
	});

	it('synced, clean and up to date -> nothing', () => {
		expect(decide({local: {dirty: false, rev: 43, sync: true}, server})).toBe(
			'none'
		);
	});

	it('no local copy and a tombstone is not a ghost', () => {
		expect(decide({server: {deleted: true, rev: 44}})).toBe('none');
	});

	it('local only, nothing on the server -> nothing', () => {
		expect(decide({local: {dirty: true, rev: 0, sync: false}})).toBe('none');
	});
});

describe('hasPersistableChange', () => {
	it('is false for the same object', () => {
		const story = testStory();

		expect(hasPersistableChange(story, story)).toBe(false);
	});

	it('ignores selecting the story or a passage', () => {
		const before = testStory();

		expect(
			hasPersistableChange(before, {...before, selected: !before.selected})
		).toBe(false);
		expect(
			hasPersistableChange(before, {
				...before,
				passages: [testPassage('story-1', {highlighted: true})]
			})
		).toBe(false);
	});

	it('ignores lastUpdate moving on its own', () => {
		const before = testStory();

		expect(
			hasPersistableChange(before, {
				...before,
				lastUpdate: new Date('2031-01-01T00:00:00Z')
			})
		).toBe(false);
	});

	it('sees passage text', () => {
		expect(
			hasPersistableChange(storyWithText('s', 'one'), storyWithText('s', 'two'))
		).toBe(true);
	});

	it('sees a story rename', () => {
		const before = testStory();

		expect(hasPersistableChange(before, {...before, name: 'Cliff'})).toBe(true);
	});

	it('sees a passage appearing or disappearing', () => {
		const before = testStory();

		expect(hasPersistableChange(before, {...before, passages: []})).toBe(true);
		expect(
			hasPersistableChange(before, {
				...before,
				passages: [
					...before.passages,
					testPassage('story-1', {id: 'p2', name: 'Cliff'})
				]
			})
		).toBe(true);
	});

	it('sees a passage replaced by a different one of the same count', () => {
		const before = testStory();

		expect(
			hasPersistableChange(before, {
				...before,
				passages: [testPassage('story-1', {id: 'p9', name: 'Cliff'})]
			})
		).toBe(true);
	});
});
