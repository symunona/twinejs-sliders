import type {AssetMeta} from '@sliders/scene-types';
import {filterSprites, spriteCandidates} from '../sprite-candidates';

const asset = (over: Partial<AssetMeta> & {name: string}): AssetMeta => ({
	animated: false,
	bytes: 1,
	h: 1,
	hash: over.name,
	id: over.name,
	kind: 'object',
	mime: 'image/png',
	tags: [],
	w: 1,
	...over
});

describe('spriteCandidates', () => {
	it('offers any still picture, pack sprites first', () => {
		const out = spriteCandidates([
			asset({name: 'zebra'}),
			asset({kind: 'bg', name: 'alley'}),
			asset({name: 'p-dot', tags: ['particle-sprite']}),
			asset({animated: true, name: 'flag'}),
			asset({kind: 'sound', name: 'door'}),
			asset({kind: 'fx', name: 'fire', particles: {rate: 1}}),
			asset({name: 'mira-idle', ownerCharacter: 'mira'})
		]);

		expect(out.map(a => a.name)).toEqual(['p-dot', 'alley', 'zebra']);
	});

	it('filters by name or tag', () => {
		const all = [asset({name: 'lamp'}), asset({name: 'p-dot', tags: ['particle-sprite']})];

		expect(filterSprites(all, 'PARTICLE').map(a => a.name)).toEqual(['p-dot']);
		expect(filterSprites(all, ' ')).toHaveLength(2);
	});
});
