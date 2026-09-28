/**
 * @jest-environment node
 */
import {merge3, sameContent} from '../merge';
import {AssetRecord} from '../types';

function asset(fields: Partial<AssetRecord> = {}, rev = 1): AssetRecord {
	return {
		id: 'a',
		type: 'asset',
		rev,
		deleted: false,
		by: 'ana',
		at: '2026-09-28T00:00:00Z',
		collection: 'c',
		name: 'night',
		blob: 'b0',
		tags: ['bar', 'night'],
		recipe: {},
		...fields
	};
}

describe('merge3: top-level fields', () => {
	const base = asset();

	it('only remote changed → remote', () => {
		const {merged, conflicts} = merge3(base, base, asset({name: 'tavern'}, 2));

		expect(conflicts).toEqual([]);
		expect(merged.name).toBe('tavern');
	});

	it('only local changed → local', () => {
		const {merged, conflicts} = merge3(
			base,
			asset({name: 'mine'}),
			asset({}, 2)
		);

		expect(conflicts).toEqual([]);
		expect(merged.name).toBe('mine');
	});

	it('both changed to the same value → no conflict', () => {
		const {conflicts, merged} = merge3(
			base,
			asset({blob: 'b1'}),
			asset({blob: 'b1'}, 2)
		);

		expect(conflicts).toEqual([]);
		expect(merged.blob).toBe('b1');
	});

	it('both changed differently → conflict, merged holds theirs', () => {
		const {merged, conflicts} = merge3(
			base,
			asset({blob: 'mine'}),
			asset({blob: 'theirs'}, 2)
		);

		expect(conflicts).toEqual(['blob']);
		expect(merged.blob).toBe('theirs');
	});

	it('envelope comes from remote', () => {
		const remote = asset({}, 5);
		const {merged} = merge3(base, asset({name: 'x'}), {...remote, by: 'bo'});

		expect(merged).toMatchObject({rev: 5, by: 'bo'});
	});

	it('disjoint fields both survive', () => {
		const {merged, conflicts} = merge3(
			base,
			asset({name: 'renamed'}),
			asset({blob: 'repainted'}, 2)
		);

		expect(conflicts).toEqual([]);
		expect(merged).toMatchObject({name: 'renamed', blob: 'repainted'});
	});

	it('a field added on one side travels (no whitelist)', () => {
		const {merged} = merge3(base, asset({futureField: {x: 1}}), asset({}, 2));

		expect(merged.futureField).toEqual({x: 1});
	});

	it('a field removed on one side is removed', () => {
		const withKind = asset({kind: 'bg'});
		const {merged, conflicts} = merge3(
			withKind,
			asset({kind: undefined}),
			asset({kind: 'bg'}, 2)
		);

		expect(conflicts).toEqual([]);
		expect('kind' in merged).toBe(false);
	});
});

describe('merge3: recipe per key', () => {
	it('edits vs mask → both, no conflict', () => {
		const base = asset({recipe: {effect: {kind: 'glitch'} as never}});
		const {merged, conflicts} = merge3(
			base,
			asset({
				recipe: {effect: {kind: 'glitch'} as never, edits: {crop: 1} as never}
			}),
			asset(
				{
					recipe: {
						effect: {kind: 'glitch'} as never,
						mask: {shapes: []} as never
					}
				},
				2
			)
		);

		expect(conflicts).toEqual([]);
		expect(merged.recipe).toEqual({
			effect: {kind: 'glitch'},
			edits: {crop: 1},
			mask: {shapes: []}
		});
	});

	it('same key both sides → conflict named recipe.<key>', () => {
		const {conflicts} = merge3(
			asset(),
			asset({recipe: {effect: {amount: 1}} as never}),
			asset({recipe: {effect: {amount: 2}} as never}, 2)
		);

		expect(conflicts).toEqual(['recipe.effect']);
	});

	it('sidecars merge per kind too', () => {
		const {merged, conflicts} = merge3(
			asset(),
			asset({sidecars: {src: 's1'}}),
			asset({sidecars: {cutout: 'c1'}}, 2)
		);

		expect(conflicts).toEqual([]);
		expect(merged.sidecars).toEqual({src: 's1', cutout: 'c1'});
	});
});

describe('merge3: tags as sets', () => {
	it('union of adds, both removes applied', () => {
		const base = asset({tags: ['bar', 'night', 'old']});
		const {merged, conflicts} = merge3(
			base,
			asset({tags: ['bar', 'night', 'wet']}), // -old +wet
			asset({tags: ['night', 'old', 'loud']}, 2) // -bar +loud
		);

		expect(conflicts).toEqual([]);
		expect([...((merged.tags as string[]) ?? [])].sort()).toEqual([
			'loud',
			'night',
			'wet'
		]);
	});
});

describe('merge3: delete vs edit', () => {
	const base = asset();

	it('remote deleted, local edited → conflict on deleted', () => {
		const {conflicts, merged} = merge3(
			base,
			asset({tags: ['x']}),
			asset({deleted: true}, 2)
		);

		expect(conflicts).toEqual(['deleted']);
		expect(merged.deleted).toBe(true);
	});

	it('local deleted, remote edited → conflict on deleted', () => {
		const {conflicts} = merge3(
			base,
			asset({deleted: true}),
			asset({name: 'z'}, 2)
		);

		expect(conflicts).toEqual(['deleted']);
	});

	it('remote deleted, local untouched → delete', () => {
		const {conflicts, merged} = merge3(base, base, asset({deleted: true}, 2));

		expect(conflicts).toEqual([]);
		expect(merged.deleted).toBe(true);
	});

	it('both deleted → no conflict', () => {
		const {conflicts} = merge3(
			base,
			asset({deleted: true}),
			asset({deleted: true}, 2)
		);

		expect(conflicts).toEqual([]);
	});
});

describe('merge3 without a base', () => {
	it('identical content → no conflict (a create the server already holds)', () => {
		const local = asset({}, 0);
		const {conflicts, merged} = merge3(undefined, local, asset({}, 1));

		expect(conflicts).toEqual([]);
		expect(sameContent(merged, local)).toBe(true);
	});

	it('any difference is a conflict', () => {
		expect(
			merge3(undefined, asset({name: 'a'}, 0), asset({name: 'b'})).conflicts
		).toEqual(['name']);
	});
});

describe('sameContent', () => {
	it('ignores rev/by/at and key order', () => {
		const a = asset({}, 1);
		const b = {...asset({}, 9), by: 'bo', at: 'later'};
		const reordered = JSON.parse(JSON.stringify(b, Object.keys(b).reverse()));

		expect(sameContent(a, reordered)).toBe(true);
		expect(sameContent(a, asset({name: 'other'}))).toBe(false);
	});
});
