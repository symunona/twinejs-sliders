/**
 * The diff/apply pair, on its own.
 *
 * Pure both ways, so these are about the RULES rather than about sync: what a patch can
 * say, what it cannot, and the round trip that has to hold or a patch is a way to lose
 * text quietly.
 */

import {outgoingStory} from '../client';
import {
	applyPassageDiff,
	diffFromSnapshot,
	diffPassages,
	patchIsEmpty,
	snapshotStory,
	usableSnapshot
} from '../story-diff';
import {storyHash} from '../sync-record';
import {testPassage, testStory} from '../test-fixtures';
import type {Passage, Story} from '../../../stories';
import type {StoryPatch} from '../server.types';

function story(passages: Partial<Passage>[], rest: Partial<Story> = {}): Story {
	return testStory({
		passages: passages.map(props => testPassage('story-1', props)),
		...rest
	});
}

/** `applyPassageDiff` after `diffPassages`, with the diff asserted to exist. */
function roundTrip(base: Story, next: Story): Story {
	const patch = diffPassages(base, next);

	expect(patch).toBeDefined();

	return applyPassageDiff(base, patch as StoryPatch);
}

describe('snapshotStory', () => {
	it('carries the story hash the record compares against', () => {
		const base = story([{id: 'p1'}]);

		expect(snapshotStory(base).hash).toBe(storyHash(base));
	});

	it('describes one entry per passage and no `passages` key', () => {
		const snapshot = snapshotStory(story([{id: 'p1'}, {id: 'p2'}]));

		expect(Object.keys(snapshot.passages).sort()).toEqual(['p1', 'p2']);
		expect(snapshot.story).not.toHaveProperty('passages');
	});

	it('describes exactly the top-level fields that travel', () => {
		const base = story([{id: 'p1'}]);
		const sent = {...(outgoingStory(base) as unknown as Record<string, unknown>)};

		delete sent.passages;

		expect(Object.keys(snapshotStory(base).story).sort()).toEqual(
			Object.keys(sent).sort()
		);
	});

	it('does not hash local view state — it is never sent', () => {
		const base = story([{id: 'p1'}]);
		const viewed: Story = {...base, selected: true, snapToGrid: true, zoom: 0.4};

		expect(snapshotStory(viewed).story).toEqual(snapshotStory(base).story);
	});

	/**
	 * `lastUpdate` is a `Date`, and the stringify `storyHash` uses turns every object
	 * with no own enumerable keys into `{}` — so a `Date` hashed that way is the same
	 * `Date` as every other. It is a field that travels, so it has to hash as its value.
	 */
	it('tells two different lastUpdate values apart', () => {
		const early = story([{id: 'p1'}], {
			lastUpdate: new Date('2026-01-01T00:00:00.000Z')
		});
		const late = story([{id: 'p1'}], {
			lastUpdate: new Date('2026-06-01T00:00:00.000Z')
		});

		expect(snapshotStory(early).story.lastUpdate).not.toBe(
			snapshotStory(late).story.lastUpdate
		);
	});
});

describe('what a diff says', () => {
	it('is empty between a story and itself', () => {
		const base = story([{id: 'p1'}, {id: 'p2', name: 'Cellar'}]);

		expect(patchIsEmpty(diffPassages(base, base) as StoryPatch)).toBe(true);
	});

	it('sends one passage when one passage changed', () => {
		const base = story([
			{id: 'p1', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'}
		]);
		const next = story([
			{id: 'p1', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'rewritten'}
		]);
		const patch = diffPassages(base, next) as StoryPatch;

		expect(patch.passages?.changed?.map(p => p.id)).toEqual(['p2']);
		expect(patch.passages?.removed).toBeUndefined();
		expect(patch.story).toBeUndefined();
	});

	it('names a new passage as changed, not as anything else', () => {
		const base = story([{id: 'p1'}]);
		const next = story([{id: 'p1'}, {id: 'p2', name: 'Cellar'}]);

		expect(
			(diffPassages(base, next) as StoryPatch).passages?.changed?.map(p => p.id)
		).toEqual(['p2']);
	});

	it('names a deleted passage as removed', () => {
		const base = story([{id: 'p1'}, {id: 'p2', name: 'Cellar'}]);
		const next = story([{id: 'p1'}]);

		expect((diffPassages(base, next) as StoryPatch).passages).toEqual({
			removed: ['p2']
		});
	});

	it('sends only the top-level fields that moved', () => {
		const base = story([{id: 'p1'}]);
		const next: Story = {...base, name: 'Cellar Door'};

		expect((diffPassages(base, next) as StoryPatch).story).toEqual({
			name: 'Cellar Door'
		});
	});

	it('never sends `passages` in the story half — the server refuses it', () => {
		const base = story([{id: 'p1', text: 'one'}]);
		const next = story([{id: 'p1', text: 'two'}], {name: 'Renamed'});

		expect((diffPassages(base, next) as StoryPatch).story).not.toHaveProperty(
			'passages'
		);
	});

	/**
	 * A patch has no "unset this" and the server folds keys in rather than replacing the
	 * object, so a vanished field cannot be said. No required `Story` field can vanish
	 * today; the guard is for the first optional one, and the answer is a whole PUT
	 * rather than a value that silently never changes again.
	 */
	it('refuses to describe a top-level field that disappeared', () => {
		const base = snapshotStory(story([{id: 'p1'}]));
		const next = story([{id: 'p1'}]);

		delete (next as unknown as Record<string, unknown>).stylesheet;

		expect(diffFromSnapshot(base, next)).toBeUndefined();
	});

	it('is small — the whole reason the route exists', () => {
		const passages = Array.from({length: 20}, (_, i) => ({
			id: `p${i}`,
			name: `Room ${i}`,
			text: 'x'.repeat(4000)
		}));
		const base = story(passages);
		const next = story(
			passages.map((p, i) => (i === 7 ? {...p, text: 'y'.repeat(4000)} : p))
		);
		const whole = JSON.stringify(outgoingStory(next)).length;
		const patch = JSON.stringify(diffPassages(base, next)).length;

		expect(whole).toBeGreaterThan(64 * 1024);
		expect(patch).toBeLessThan(whole / 10);
	});
});

describe('the round trip', () => {
	const base = story([
		{id: 'p1', name: 'Harbour', text: 'one'},
		{id: 'p2', name: 'Cellar', text: 'two'},
		{id: 'p3', name: 'Alley', text: 'three'}
	]);

	it.each([
		['nothing changed', base],
		['one passage rewritten', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'rewritten'},
			{id: 'p3', name: 'Alley', text: 'three'}
		])],
		['a passage added', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'},
			{id: 'p3', name: 'Alley', text: 'three'},
			{id: 'p4', name: 'Vault', text: 'four'}
		])],
		['a passage removed', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p3', name: 'Alley', text: 'three'}
		])],
		['everything removed', story([])],
		['moved on the map', story([
			{id: 'p1', name: 'Harbour', text: 'one', left: 400, top: 250},
			{id: 'p2', name: 'Cellar', text: 'two'},
			{id: 'p3', name: 'Alley', text: 'three'}
		])],
		['the story renamed and restyled', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'},
			{id: 'p3', name: 'Alley', text: 'three'}
		], {name: 'Cellar Door', stylesheet: 'body {}', tags: ['draft']})],
		['tag colours changed', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'},
			{id: 'p3', name: 'Alley', text: 'three'}
		], {tagColors: {draft: 'red'}})],
		['a later edit time', story([
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'},
			{id: 'p3', name: 'Alley', text: 'three'}
		], {lastUpdate: new Date('2026-09-20T12:00:00.000Z')})],
		['all of it at once', story([
			{id: 'p2', name: 'Cellar', text: 'rewritten'},
			{id: 'p4', name: 'Vault', text: 'four'}
		], {name: 'Cellar Door', startPassage: 'p4'})]
	])('survives %s', (_label, next) => {
		expect(roundTrip(base, next)).toEqual(next);
	});

	it('holds for a story with no passages as the base', () => {
		const empty = story([]);
		const next = story([{id: 'p1'}]);

		expect(roundTrip(empty, next)).toEqual(next);
	});

	/**
	 * The one thing the round trip does NOT preserve, stated rather than discovered.
	 * `patchPassages` in Go replaces a passage where it stands and appends a new one, so
	 * reordering the array cannot be expressed — and does not need to be: array order is
	 * not meaningful to the player, `storyHash` sorts by id before hashing, and
	 * reordering on every autosave would make every patch look like a change to every
	 * passage.
	 */
	it('keeps the base order rather than the new one, and every passage', () => {
		const shuffled = story([
			{id: 'p3', name: 'Alley', text: 'three'},
			{id: 'p1', name: 'Harbour', text: 'one'},
			{id: 'p2', name: 'Cellar', text: 'two'}
		]);
		const result = roundTrip(base, shuffled);

		expect(result.passages.map(p => p.id)).toEqual(['p1', 'p2', 'p3']);
		expect(storyHash(result)).toBe(storyHash(shuffled));
	});
});

describe('applyPassageDiff follows the server rule for rule', () => {
	const base = story([
		{id: 'p1', name: 'Harbour'},
		{id: 'p2', name: 'Cellar'}
	]);

	it('replaces a changed passage where it stands', () => {
		const result = applyPassageDiff(base, {
			passages: {changed: [testPassage('story-1', {id: 'p1', text: 'new'})]}
		});

		expect(result.passages.map(p => p.id)).toEqual(['p1', 'p2']);
		expect(result.passages[0].text).toBe('new');
	});

	it('appends one it has never seen', () => {
		const result = applyPassageDiff(base, {
			passages: {changed: [testPassage('story-1', {id: 'p9', name: 'Vault'})]}
		});

		expect(result.passages.map(p => p.id)).toEqual(['p1', 'p2', 'p9']);
	});

	it('removes before it changes, so a patch doing both is unambiguous', () => {
		const result = applyPassageDiff(base, {
			passages: {
				changed: [testPassage('story-1', {id: 'p2', text: 'back again'})],
				removed: ['p2']
			}
		});

		expect(result.passages.map(p => p.id)).toEqual(['p1', 'p2']);
		expect(result.passages[1].text).toBe('back again');
	});

	it('shrugs at a removal naming a passage that is already gone', () => {
		const result = applyPassageDiff(base, {
			passages: {removed: ['p2', 'nobody']}
		});

		expect(result.passages.map(p => p.id)).toEqual(['p1']);
	});

	it('leaves the base alone', () => {
		const before = JSON.stringify(base);

		applyPassageDiff(base, {
			passages: {
				changed: [testPassage('story-1', {id: 'p1', text: 'new'})],
				removed: ['p2']
			},
			story: {name: 'Other'}
		});

		expect(JSON.stringify(base)).toBe(before);
	});

	it('refuses `passages` in the story half', () => {
		expect(() =>
			applyPassageDiff(base, {
				story: {passages: []} as unknown as StoryPatch['story']
			})
		).toThrow(/patch.story may not carry/);
	});

	it('is the identity for an empty patch', () => {
		expect(applyPassageDiff(base, {})).toEqual(base);
	});
});

describe('usableSnapshot', () => {
	const base = story([{id: 'p1'}]);
	const snapshot = snapshotStory(base);

	it('hands back a snapshot that still describes what was pushed', () => {
		expect(usableSnapshot(snapshot, snapshot.hash)).toBe(snapshot);
	});

	/**
	 * A pull, a checkout, a publish and a resolve all write `pushedHash` and know nothing
	 * about snapshots. This comparison is what keeps them from leaving a stale base
	 * behind — the cost of being wrong is a passage silently removed on the server.
	 */
	it('refuses one describing some other state', () => {
		expect(usableSnapshot(snapshot, 'written by a pull')).toBeUndefined();
	});

	it('refuses a missing one', () => {
		expect(usableSnapshot(undefined, snapshot.hash)).toBeUndefined();
	});
});
