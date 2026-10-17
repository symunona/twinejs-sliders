import {buildPreloadPlan} from '../preload-plan';
import {assets, characters, passages, sceneOf, urls} from '../__fixtures__/preload-story';

const plan = (start?: string) =>
	buildPreloadPlan({assets, characters, passages, scenes: sceneOf, start, urls});

const labels = (tier: {assets: {label: string}[]}) => tier.assets.map(a => a.label);

describe('preload plan', () => {
	it('puts the opening scene first, then each link depth, then the rest', async () => {
		const {tiers} = await plan('Start');

		expect(tiers.map(t => t.passages)).toEqual([
			['Start'],
			['A', 'B'],
			['C'],
			['Orphan']
		]);
		expect(labels(tiers[0])).toEqual(['hall', 'theme', 'mira-idle']);
		// `hall` is B's too, but tier 0 already holds it.
		expect(labels(tiers[1])).toEqual(['forest', 'lamp']);
		// C draws only what A and Start already fetched.
		expect(labels(tiers[2])).toEqual([]);
		expect(tiers[3].unreached).toBe(true);
		expect(labels(tiers[3])).toEqual(['secret', 'cave', 'unused']);
	});

	it('lists every url exactly once', async () => {
		const all = (await plan('Start')).tiers.flatMap(t => t.assets.map(a => a.url));

		expect(new Set(all).size).toBe(all.length);
		expect(new Set(all)).toEqual(new Set(Object.values(urls)));
	});

	it('maps each passage to everything it draws, inherited art included', async () => {
		const {byPassage} = await plan('Start');

		expect(byPassage.get('C')).toEqual([
			'https://art.test/mira-idle',
			'https://art.test/forest'
		]);
		expect(byPassage.get('Orphan')).toEqual(['https://art.test/secret']);
	});

	it('roots the tree at a restored passage, case-insensitively', async () => {
		const {start, tiers} = await plan('a');

		expect(start).toBe('A');
		expect(labels(tiers[0])).toEqual(['forest']);
		expect(tiers[1].passages).toEqual(['C']);
	});

	it('knows which passages open with sound', async () => {
		const {sound} = await plan('Start');

		expect([...sound]).toEqual(['Start']);
	});
});
