/**
 * The three-way merge, on its own.
 *
 * Half of these are about what it REFUSES. A merge that silently drops somebody's
 * passage is data loss, and it is the quiet kind: both authors keep working, the badge
 * stays green, and the missing room turns up days later. So every refusal here has a
 * test, and the disjoint case has one that counts passages rather than trusting a hash.
 */

import type {Passage, Story} from '../../../stories';
import {snapshotStory} from '../story-diff';
import {mergeStories} from '../story-merge';
import {testPassage, testStory} from '../test-fixtures';

function story(passages: Partial<Passage>[], rest: Partial<Story> = {}): Story {
	return testStory({
		passages: passages.map(props => testPassage('story-1', props)),
		...rest
	});
}

const BASE = story([
	{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
	{id: 'p2', name: 'Cellar', text: 'it is dark'}
]);

function merge(mine: Story, theirs: Story, base: Story = BASE) {
	return mergeStories({base: snapshotStory(base), mine, theirs});
}

/** The same, with no record of what the two sides started from. */
function mergeWithoutBase(mine: Story, theirs: Story) {
	return mergeStories({base: undefined, mine, theirs});
}

/** The result's passages as `id: text`, which is what "did anybody get dropped" means. */
function textOf(story: Story): Record<string, string> {
	return Object.fromEntries(story.passages.map(p => [p.id, p.text]));
}

describe('different passages', () => {
	it('keeps both edits', () => {
		const mine = story([
			{id: 'p1', name: 'Harbour', text: 'MINE'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'THEIRS'}
		]);
		const result = merge(mine, theirs);

		expect(result.merged).toBe(true);
		expect(textOf((result as {story: Story}).story)).toEqual({
			p1: 'MINE',
			p2: 'THEIRS'
		});
	});

	it('keeps a passage each side added', () => {
		const mine = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'},
			{id: 'p3', name: 'Alley', text: 'mine'}
		]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'},
			{id: 'p4', name: 'Vault', text: 'theirs'}
		]);
		const result = merge(mine, theirs);

		expect(result.merged).toBe(true);
		expect(
			Object.keys(textOf((result as {story: Story}).story)).sort()
		).toEqual(['p1', 'p2', 'p3', 'p4']);
	});

	it('honours a deletion on one side and an edit on the other', () => {
		const mine = story([{id: 'p1', name: 'Harbour', text: 'the lamp is lit'}]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'THEIRS'}
		]);

		// I removed p2; they edited it. That IS both sides touching p2.
		expect(merge(mine, theirs).merged).toBe(false);
	});

	it('honours a deletion neither side argued with', () => {
		const mine = story([{id: 'p1', name: 'Harbour', text: 'the lamp is lit'}]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'THEIRS'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const result = merge(mine, theirs);

		expect(result.merged).toBe(true);
		expect(textOf((result as {story: Story}).story)).toEqual({p1: 'THEIRS'});
	});

	it('is fine with both sides deleting the same passage', () => {
		const gone = story([{id: 'p1', name: 'Harbour', text: 'the lamp is lit'}]);
		const result = merge(
			story([{id: 'p1', name: 'Harbour', text: 'MINE'}]),
			gone
		);

		expect(result.merged).toBe(true);
		expect(textOf((result as {story: Story}).story)).toEqual({p1: 'MINE'});
	});

	it('takes my view of the map, not the server’s', () => {
		const mine: Story = {
			...story([
				{id: 'p1', name: 'Harbour', text: 'MINE'},
				{id: 'p2', name: 'Cellar', text: 'it is dark'}
			]),
			snapToGrid: true,
			zoom: 0.4
		};
		const theirs: Story = {
			...story([
				{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
				{id: 'p2', name: 'Cellar', text: 'THEIRS'}
			]),
			snapToGrid: false,
			zoom: 1
		};
		const result = merge(mine, theirs) as {merged: true; story: Story};

		expect(result.story.zoom).toBe(0.4);
		expect(result.story.snapToGrid).toBe(true);
	});

	it('takes the later edit time without calling it a disagreement', () => {
		const mine = story(
			[
				{id: 'p1', name: 'Harbour', text: 'MINE'},
				{id: 'p2', name: 'Cellar', text: 'it is dark'}
			],
			{lastUpdate: new Date('2026-09-20T10:00:00.000Z')}
		);
		const theirs = story(
			[
				{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
				{id: 'p2', name: 'Cellar', text: 'THEIRS'}
			],
			{lastUpdate: new Date('2026-09-20T11:00:00.000Z')}
		);
		const result = merge(mine, theirs) as {merged: true; story: Story};

		expect(result.merged).toBe(true);
		expect(result.story.lastUpdate).toEqual(
			new Date('2026-09-20T11:00:00.000Z')
		);
	});
});

describe('what it refuses', () => {
	it('refuses without a base — there is no way to tell an add from a delete', () => {
		const mine = story([{id: 'p1', name: 'Harbour', text: 'MINE'}]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const result = mergeWithoutBase(mine, theirs);

		expect(result).toMatchObject({merged: false});
		expect((result as {reason: string}).reason).toMatch(/no base/);
	});

	it('refuses when both sides edited the same passage', () => {
		const mine = story([
			{id: 'p1', name: 'Harbour', text: 'MINE'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'THEIRS'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const result = merge(mine, theirs);

		expect(result).toMatchObject({merged: false});
		expect((result as {reason: string}).reason).toMatch(/p1/);
	});

	it('refuses when both sides renamed the story', () => {
		const mine = story(
			[
				{id: 'p1', name: 'Harbour', text: 'MINE'},
				{id: 'p2', name: 'Cellar', text: 'it is dark'}
			],
			{name: 'Mine'}
		);
		const theirs = story(
			[
				{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
				{id: 'p2', name: 'Cellar', text: 'THEIRS'}
			],
			{name: 'Theirs'}
		);

		expect(merge(mine, theirs)).toMatchObject({merged: false});
	});

	it('is fine when both sides made the SAME top-level change', () => {
		const mine = story(
			[
				{id: 'p1', name: 'Harbour', text: 'MINE'},
				{id: 'p2', name: 'Cellar', text: 'it is dark'}
			],
			{name: 'Agreed'}
		);
		const theirs = story(
			[
				{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
				{id: 'p2', name: 'Cellar', text: 'THEIRS'}
			],
			{name: 'Agreed'}
		);

		expect(merge(mine, theirs)).toMatchObject({merged: true});
	});

	it('lets one side change the stylesheet while the other writes', () => {
		const mine = story([
			{id: 'p1', name: 'Harbour', text: 'MINE'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'}
		]);
		const theirs = story(
			[
				{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
				{id: 'p2', name: 'Cellar', text: 'it is dark'}
			],
			{stylesheet: 'body {color: red}'}
		);
		const result = merge(mine, theirs) as {merged: true; story: Story};

		expect(result.merged).toBe(true);
		expect(result.story.stylesheet).toBe('body {color: red}');
		expect(textOf(result.story).p1).toBe('MINE');
	});

	/**
	 * Disjoint BY ID and broken in the result. Passage names are what links resolve
	 * against and `matchPassageName` takes the first, so a merge that leaves two rooms
	 * called Vault points half the story's links at the wrong one — silently. A conflict
	 * dialog is the better outcome.
	 */
	it('refuses when the result would hold two passages of one name', () => {
		const mine = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'},
			{id: 'p3', name: 'Vault', text: 'mine'}
		]);
		const theirs = story([
			{id: 'p1', name: 'Harbour', text: 'the lamp is lit'},
			{id: 'p2', name: 'Cellar', text: 'it is dark'},
			{id: 'p4', name: 'vault', text: 'theirs'}
		]);
		const result = merge(mine, theirs);

		expect(result).toMatchObject({merged: false});
		expect((result as {reason: string}).reason).toMatch(/two passages/);
	});
});

describe('nothing is lost', () => {
	/**
	 * The counting test. Every id either side holds after the merge has to be in the
	 * result with the text its owner gave it — asserted by walking both sides rather
	 * than by comparing one hash, because a hash that matches the wrong story matches
	 * silently.
	 */
	it('keeps every passage both sides kept, with its own text', () => {
		const base = story([
			{id: 'a', name: 'A', text: 'a0'},
			{id: 'b', name: 'B', text: 'b0'},
			{id: 'c', name: 'C', text: 'c0'},
			{id: 'd', name: 'D', text: 'd0'}
		]);
		const mine = story([
			{id: 'a', name: 'A', text: 'a-mine'},
			{id: 'b', name: 'B', text: 'b0'},
			{id: 'c', name: 'C', text: 'c0'},
			{id: 'e', name: 'E', text: 'e-mine'}
		]);
		const theirs = story([
			{id: 'a', name: 'A', text: 'a0'},
			{id: 'b', name: 'B', text: 'b-theirs'},
			{id: 'c', name: 'C', text: 'c0'},
			{id: 'd', name: 'D', text: 'd0'},
			{id: 'f', name: 'F', text: 'f-theirs'}
		]);
		// `base` here, not the module-level one — these four passages are the shared
		// starting point for this scenario.
		const result = merge(mine, theirs, base) as {merged: true; story: Story};

		expect(result).toMatchObject({merged: true});
		expect(textOf(result.story)).toEqual({
			a: 'a-mine',
			b: 'b-theirs',
			c: 'c0',
			// I deleted d and they did not touch it.
			e: 'e-mine',
			f: 'f-theirs'
		});
	});
});
