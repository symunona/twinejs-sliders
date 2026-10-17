/**
 * The player's loading, end to end over the real plan and queue: what is fetched before
 * the page shows, in what order the rest follows, the boot screen when the opening scene
 * has sound, and the stop when a click outruns the art.
 */

import {
	assets,
	characters,
	passages as fixturePassages,
	sceneOf as fixtureSceneOf,
	urls
} from '../__fixtures__/preload-story';

jest.mock('../../logger', () => ({
	createLoggers: () => ({log: () => undefined, warn: () => undefined})
}));
jest.mock('../../story', () => {
	const {passages} = jest.requireActual('../__fixtures__/preload-story');

	return {
		passageNamed: (name: string) =>
			passages
				.filter((p: {name: string}) => p.name.toLowerCase() === name.toLowerCase())
				.map((p: {name: string; text: string}) => ({name: p.name, source: p.text}))[0],
		passages: () =>
			passages.map((p: {name: string; text: string}) => ({
				name: p.name,
				source: p.text
			}))
	};
});
jest.mock('../history', () => ({currentPassage: () => 'Start'}));
jest.mock('../scene-graph', () => ({
	sceneOf: (name: string) => jest.requireActual('../__fixtures__/preload-story').sceneOf(name)
}));

const routed: {source?: (url: string, key: string) => Promise<string>} = {};

jest.mock('../assets', () => {
	const fixture = jest.requireActual('../__fixtures__/preload-story');

	return {
		manifestArt: () => ({
			assets: fixture.assets,
			characters: fixture.characters,
			urls: fixture.urls
		}),
		routeUrls: (source: (url: string, key: string) => Promise<string>) => {
			routed.source = source;
		}
	};
});

import {
	autoplayAllowed,
	pendingFor,
	preloadArt,
	preloading,
	whenRevealed
} from '../preload';

/** fetch() that answers when the test releases a url. */
const downloads = new Map<string, () => void>();
const fetched: string[] = [];

function release(name: string): Promise<void> {
	const url = `https://art.test/${name}`;
	const done = downloads.get(url);

	if (!done) {
		throw new Error(`${name} was never fetched (fetched: ${fetched.join(', ')})`);
	}

	downloads.delete(url);
	done();
	return flush();
}

async function flush(): Promise<void> {
	for (let i = 0; i < 10; i++) {
		await new Promise(resolve => setTimeout(resolve, 0));
	}
}

const names = () => fetched.map(url => url.replace('https://art.test/', ''));

function setAutoplayPolicy(policy: string | undefined): void {
	Object.defineProperty(navigator, 'getAutoplayPolicy', {
		configurable: true,
		value: policy === undefined ? undefined : () => policy
	});
}

beforeAll(() => {
	// Kept as fixture imports so the mocks and the assertions read the same story.
	expect(fixturePassages.length).toBeGreaterThan(0);
	expect(fixtureSceneOf('Start')).toBeDefined();
	expect(assets.length + characters.length).toBeGreaterThan(0);
	expect(Object.keys(urls).length).toBeGreaterThan(0);
});

beforeEach(() => {
	downloads.clear();
	fetched.length = 0;
	document.body.innerHTML = '';
	document.documentElement.className = '';
	setAutoplayPolicy('allowed');
	(globalThis as {fetch?: unknown}).fetch = jest.fn(
		(url: string) =>
			new Promise(resolve => {
				fetched.push(url);
				downloads.set(url, () =>
					resolve({
						arrayBuffer: async () => new ArrayBuffer(8),
						body: null,
						headers: {get: () => null},
						ok: true
					})
				);
			})
	);
	URL.createObjectURL = jest.fn(() => `blob:${fetched.length}`);
	// jsdom implements no media playback; the probe's teardown would log per test.
	jest.spyOn(HTMLMediaElement.prototype, 'pause').mockImplementation(() => undefined);
	jest.spyOn(HTMLMediaElement.prototype, 'load').mockImplementation(() => undefined);
	window.requestAnimationFrame = (cb: FrameRequestCallback) =>
		window.setTimeout(() => cb(0), 0);
});

/** Run the opening up to and past the reveal, the browser allowing sound. */
async function openStory(): Promise<void> {
	preloadArt();
	await flush();
	await release('hall');
	await release('theme');
	await release('mira-idle');
	await whenRevealed();
	await flush();
}

describe('player preload', () => {
	it('fetches only the opening scene before the page shows', async () => {
		preloadArt();
		await flush();

		expect(preloading()).toBe(true);
		expect(document.querySelector('.sliders-preload')).not.toBeNull();
		expect(names()).toEqual(['hall', 'theme', 'mira-idle']);

		await release('hall');
		await release('theme');
		expect(preloading()).toBe(true);
		// Tier 1 waits for the reveal even with slots free.
		expect(names()).toEqual(['hall', 'theme', 'mira-idle']);

		await release('mira-idle');
		await whenRevealed();
		expect(preloading()).toBe(false);
		expect(document.querySelector('.sliders-preload')).toBeNull();
	});

	it('then fetches the rest nearest first', async () => {
		await openStory();

		expect(names().slice(3)).toEqual(['forest', 'lamp', 'secret', 'cave', 'unused']);
	});

	it('moves art a stage asks for to the front', async () => {
		preloadArt();
		await flush();

		const cave = routed.source!('https://art.test/cave', 'cave');

		await flush();
		expect(names()).toEqual(['hall', 'theme', 'mira-idle', 'cave']);
		await release('cave');
		await expect(cave).resolves.toMatch(/^blob:/);
	});

	it('holds a click until its passage art is down, blocking every other link', async () => {
		await openStory();
		await release('forest');
		await release('lamp');

		const orphan = document.createElement('passage-link');
		const other = document.createElement('passage-link');
		const went: string[] = [];

		orphan.setAttribute('to', 'Orphan');
		other.setAttribute('to', 'A');
		orphan.addEventListener('click', () => went.push('Orphan'));
		other.addEventListener('click', () => went.push('A'));
		document.body.append(orphan, other);

		expect(pendingFor('Orphan')).toEqual(['https://art.test/secret']);
		expect(pendingFor('A')).toEqual([]);

		orphan.click();
		expect(went).toEqual([]);
		expect(document.documentElement.classList.contains('sliders-nav-wait')).toBe(true);
		expect(orphan.classList.contains('sliders-link-loading')).toBe(true);
		expect(orphan.getAttribute('aria-busy')).toBe('true');

		other.click();
		expect(went).toEqual([]);

		await release('secret');
		expect(went).toEqual(['Orphan']);
		expect(document.documentElement.classList.contains('sliders-nav-wait')).toBe(false);
		expect(orphan.classList.contains('sliders-link-loading')).toBe(false);

		other.click();
		expect(went).toEqual(['Orphan', 'A']);
	});

	it('goes straight through when the art is already down', async () => {
		await openStory();
		await release('forest');

		const link = document.createElement('passage-link');
		let went = 0;

		link.setAttribute('to', 'A');
		link.addEventListener('click', () => went++);
		document.body.append(link);
		link.click();
		expect(went).toBe(1);
	});

	describe('boot screen (opening scene has music)', () => {
		it('skips the click when the browser allows sound', async () => {
			setAutoplayPolicy('allowed');
			await openStory();

			expect(autoplayAllowed()).toBe(true);
			expect(document.querySelector('.sliders-boot')).toBeNull();
		});

		it('waits for a click when the browser blocks sound', async () => {
			setAutoplayPolicy('allowed-muted');
			preloadArt();
			await flush();

			const button = document.querySelector<HTMLButtonElement>('.sliders-boot__play');

			expect(button?.disabled).toBe(true);
			await release('hall');
			await release('theme');
			await release('mira-idle');

			expect(button?.disabled).toBe(false);
			expect(preloading()).toBe(true);
			expect(names()).toEqual(['hall', 'theme', 'mira-idle']);

			button!.click();
			await whenRevealed();
			expect(preloading()).toBe(false);
			expect(autoplayAllowed()).toBe(false);
			expect(document.querySelector('.sliders-boot')).toBeNull();
		});

		it('asks for the click when the probe itself throws', async () => {
			setAutoplayPolicy(undefined);
			jest
				.spyOn(HTMLMediaElement.prototype, 'play')
				.mockImplementation(() => {
					throw new DOMException('nope', 'NotAllowedError');
				});
			preloadArt();
			await flush();
			await release('hall');
			await release('theme');
			await release('mira-idle');

			const button = document.querySelector<HTMLButtonElement>('.sliders-boot__play');

			expect(button?.disabled).toBe(false);
			button!.click();
			await whenRevealed();
			expect(preloading()).toBe(false);
		});
	});
});
