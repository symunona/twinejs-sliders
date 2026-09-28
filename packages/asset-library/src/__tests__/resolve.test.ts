/**
 * @jest-environment node
 */
import {Resolver} from '../resolve';
import {
	AssetRecord,
	BindingRecord,
	CharacterRecord,
	CollectionRecord
} from '../types';

const envelope = {rev: 1, deleted: false, by: 'ana', at: ''};

function collection(id: string, name = id): CollectionRecord {
	return {...envelope, id, type: 'collection', name, kind: 'shared'};
}

function asset(
	id: string,
	coll: string,
	name: string,
	deleted = false
): AssetRecord {
	return {
		...envelope,
		id,
		type: 'asset',
		collection: coll,
		name,
		blob: 'x',
		deleted
	};
}

function character(id: string, coll: string, charId: string): CharacterRecord {
	return {...envelope, id, type: 'character', collection: coll, charId};
}

const binding: BindingRecord = {
	...envelope,
	id: 'S',
	type: 'binding',
	own: 'own',
	collections: ['tavern', 'fantasy']
};

function resolver(extra: AssetRecord[] = [], chars: CharacterRecord[] = []) {
	return new Resolver({
		collections: [
			collection('own', 'Story: S'),
			collection('tavern', 'tavern-set'),
			collection('fantasy'),
			collection('loose')
		],
		assets: [
			asset('t-night', 'tavern', 'night'),
			asset('f-night', 'fantasy', 'night'),
			asset('f-tree', 'fantasy', 'tree'),
			asset('l-rock', 'loose', 'rock'),
			asset('folder', 'tavern', 'props/stool'),
			...extra
		],
		characters: chars,
		binding
	});
}

describe('Resolver', () => {
	it('order = own, then attached as listed', () => {
		expect(
			resolver()
				.order()
				.map(c => c.id)
		).toEqual(['own', 'tavern', 'fantasy']);
	});

	it('first hit wins; later ones are shadowed', () => {
		const resolution = resolver().resolve('night')!;

		expect(resolution.hit.record.id).toBe('t-night');
		expect(resolution.shadowed.map(s => s.record.id)).toEqual(['f-night']);
	});

	it('own collection shadows attached ones', () => {
		expect(resolver([asset('mine', 'own', 'night')]).asset('night')!.id).toBe(
			'mine'
		);
	});

	it('qualified coll/name skips the order, reaching unattached collections too', () => {
		expect(resolver().asset('fantasy/night')!.id).toBe('f-night');
		expect(resolver().asset('loose/rock')!.id).toBe('l-rock');
		expect(resolver().asset('rock')).toBeUndefined();
	});

	it('a plain name containing / resolves as a name first', () => {
		expect(resolver().asset('props/stool')!.id).toBe('folder');
		expect(resolver().asset('tavern-set/props/stool')!.id).toBe('folder');
	});

	it('deleted assets do not resolve', () => {
		const r = new Resolver({
			collections: [collection('own')],
			assets: [asset('gone', 'own', 'lamp', true)],
			characters: [],
			binding: {...binding, collections: []}
		});

		expect(r.asset('lamp')).toBeUndefined();
	});

	it('characters resolve by charId', () => {
		const r = resolver([], [character('ch', 'fantasy', 'mira')]);

		expect(r.character('mira')!.id).toBe('ch');
		expect(r.asset('mira')).toBeUndefined();
	});

	it('no binding → nothing resolves unqualified', () => {
		const r = new Resolver({
			collections: [collection('tavern', 'tavern-set')],
			assets: [asset('a', 'tavern', 'night')],
			characters: []
		});

		expect(r.asset('night')).toBeUndefined();
		expect(r.asset('tavern-set/night')!.id).toBe('a');
	});

	describe('lint', () => {
		it('ambiguous across attached collections, with the qualified suggestion', () => {
			expect(resolver().lint(['night'])).toEqual([
				{
					ref: 'night',
					code: 'ambiguous',
					level: 'warning',
					collections: ['tavern-set', 'fantasy'],
					suggestion: 'tavern-set/night'
				}
			]);
		});

		it('missing is an error; qualified refs are not missing', () => {
			expect(resolver().lint(['nope', 'loose/rock', 'tree'])).toEqual([
				{ref: 'nope', code: 'missing', level: 'error', collections: []}
			]);
		});

		it('own shadowing attached is info, not ambiguity', () => {
			expect(resolver([asset('mine', 'own', 'night')]).lint(['night'])).toEqual(
				[
					{
						ref: 'night',
						code: 'shadowed',
						level: 'info',
						collections: ['Story: S', 'tavern-set', 'fantasy']
					}
				]
			);
		});
	});
});
