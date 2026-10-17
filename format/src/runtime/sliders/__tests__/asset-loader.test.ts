import {AssetLoader} from '../asset-loader';

/** A fetch whose downloads finish when the test says so. */
function harness(concurrency = 2) {
	const pending = new Map<string, {ok: () => void; fail: () => void}>();
	const started: string[] = [];
	const loader = new AssetLoader({
		concurrency,
		fetch: entry =>
			new Promise<string>((resolve, reject) => {
				started.push(entry.label);
				pending.set(entry.label, {
					fail: () => reject(new Error('HTTP 404')),
					ok: () => resolve(`blob:${entry.label}`)
				});
			}),
		now: () => 0
	});
	const finish = async (label: string, fail = false) => {
		const download = pending.get(label)!;

		pending.delete(label);
		fail ? download.fail() : download.ok();
		await new Promise(resolve => setTimeout(resolve, 0));
	};

	return {finish, loader, started};
}

describe('asset loader', () => {
	it('downloads tier by tier and holds closed tiers back', async () => {
		const {finish, loader, started} = harness(2);

		loader.add('u/t1', {label: 't1', tier: 1});
		loader.add('u/a', {label: 'a', tier: 0});
		loader.add('u/b', {label: 'b', tier: 0});
		loader.add('u/c', {label: 'c', tier: 0});
		expect(started).toEqual(['a', 'b']);

		await finish('a');
		expect(started).toEqual(['a', 'b', 'c']);

		await finish('b');
		await finish('c');
		// Tier 0 done, tier 1 still closed.
		expect(started).toEqual(['a', 'b', 'c']);
		expect(loader.events.map(e => e.type)).toContain('tier-done');

		loader.open(Infinity);
		expect(started).toEqual(['a', 'b', 'c', 't1']);
	});

	it('moves a needed url to the front, closed tier or not', async () => {
		const {finish, loader, started} = harness(1);

		loader.add('u/a', {label: 'a', tier: 0});
		loader.add('u/b', {label: 'b', tier: 0});
		loader.add('u/deep', {label: 'deep', tier: 4});

		const got = loader.need('u/deep', 'click Cave');

		await finish('a');
		expect(started).toEqual(['a', 'deep']);
		await finish('deep');
		await expect(got).resolves.toBe('blob:deep');
		expect(loader.entries.get('u/deep')?.urgentBy).toBe('click Cave');
	});

	it('answers with the remote url when a download fails', async () => {
		const {finish, loader} = harness(1);

		loader.add('u/a', {label: 'a', tier: 0});

		const got = loader.need('u/a', 'render a');

		await finish('a', true);
		await expect(got).resolves.toBe('u/a');
		expect(loader.entries.get('u/a')?.state).toBe('failed');
		expect(loader.isSettled('u/a')).toBe(true);
	});

	it('keeps the lowest tier a url is filed under', () => {
		const {loader} = harness(0);

		loader.add('u/hall', {label: 'hall', passage: 'B', tier: 1});
		loader.add('u/hall', {label: 'hall', passage: 'Start', tier: 0});

		expect(loader.entries.get('u/hall')).toMatchObject({
			passages: ['B', 'Start'],
			tier: 0
		});
	});

	it('takes an unplanned url as tier 0 and fetches it once', async () => {
		const {finish, loader, started} = harness(2);
		const one = loader.need('u/x', 'render x');
		const two = loader.need('u/x', 'render x');

		await finish('u/x');
		await expect(Promise.all([one, two])).resolves.toEqual([
			'blob:u/x',
			'blob:u/x'
		]);
		expect(started).toEqual(['u/x']);
	});
});
