import type {AssetResolver, MusicTrack, StageMusic} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {SoundDeck} from '../sound-deck';

/**
 * jsdom implements no playback at all — `play()` throws "not implemented" — so the element
 * is stubbed down to the four things the deck actually uses. Everything asserted here is
 * about WHICH element is asked to do WHAT, which is the whole of the deck's job.
 */
const played: HTMLAudioElement[] = [];
const paused: HTMLAudioElement[] = [];

beforeAll(() => {
	Object.defineProperty(HTMLMediaElement.prototype, 'play', {
		configurable: true,
		value(this: HTMLAudioElement) {
			played.push(this);
			return Promise.resolve();
		}
	});
	Object.defineProperty(HTMLMediaElement.prototype, 'pause', {
		configurable: true,
		value(this: HTMLAudioElement) {
			paused.push(this);
		}
	});
});

beforeEach(() => {
	played.length = 0;
	paused.length = 0;
});

function resolver(): AssetResolver {
	return {
		async character() {
			return undefined;
		},
		async meta() {
			return undefined;
		},
		async url(id: string) {
			return `blob:${id}`;
		}
	};
}

function deck(): SoundDeck {
	const made = new SoundDeck({doc: document});

	made.setResolver(resolver());
	made.setMuted(false);
	return made;
}

/** A resolved track, the way scene-core hands it over: every default filled in. */
function track(id: string, over: Partial<MusicTrack> = {}): MusicTrack {
	return {amount: 1, fade: 0, id, loop: true, ...over};
}

function main(id: string, over: Partial<MusicTrack> = {}): StageMusic {
	return {main: track(id, over)};
}

/** Lets every pending lookup land and the play() after it run. */
async function settle(): Promise<void> {
	for (let i = 0; i < 5; i++) {
		await Promise.resolve();
	}
}

describe('SoundDeck music', () => {
	it('plays a looping track', async () => {
		await deck().music(main('rain', {amount: 0.5}));

		expect(played).toHaveLength(1);
		expect(played[0].loop).toBe(true);
		expect(played[0].src).toBe('blob:rain');
		expect(played[0].volume).toBe(0.5);
	});

	it('does not restart the same track at the same volume', async () => {
		const under = deck();

		await under.music(main('rain'));
		await under.music(main('rain'));

		// The point of the whole design: every scene declares its music, and a passage change
		// under one track must not be audible.
		expect(played).toHaveLength(1);
		expect(paused).toHaveLength(0);
	});

	it('changes volume on the same track without restarting it', async () => {
		const under = deck();

		await under.music(main('rain'));
		await under.music(main('rain', {amount: 0.2}));

		expect(played).toHaveLength(1);
		expect(played[0].volume).toBe(0.2);
	});

	it('swaps to a different track under the same key', async () => {
		const under = deck();

		await under.music(main('rain'));
		await under.music(main('storm'));

		expect(played).toHaveLength(2);
		expect(played[1].src).toBe('blob:storm');
		expect(paused).toContain(played[0]);
	});

	it('stops everything when a scene asks for silence', async () => {
		const under = deck();

		await under.music({a: track('rain'), b: track('wind')});
		await under.music(undefined);

		expect(paused).toEqual(expect.arrayContaining(played));
		expect(under.held()).toEqual([]);
	});

	it('plays nothing while muted, and starts on unmute', async () => {
		const under = new SoundDeck({doc: document});

		under.setResolver(resolver());
		await under.music(main('rain'));
		expect(played).toHaveLength(0);

		under.setMuted(false);
		// The track was resolved and held, so unmuting starts it rather than waiting for the
		// next scene to declare it again.
		expect(played).toHaveLength(1);
	});
});

describe('SoundDeck tracks by key', () => {
	it('plays parallel tracks and diffs them by key', async () => {
		const under = deck();

		await under.music({drums: track('drum-loop'), mellow: track('x')});
		expect(played.map(el => el.src)).toEqual(['blob:drum-loop', 'blob:x']);

		// `drums` stays (same id), `mellow` goes, `wind` arrives.
		await under.music({drums: track('drum-loop'), wind: track('wind')});

		expect(played).toHaveLength(3);
		expect(played[2].src).toBe('blob:wind');
		expect(paused).toEqual([played[1]]);
		expect(under.held().map(held => held.key)).toEqual(['drums', 'wind']);
	});

	it('keeps the same id under a key even when it moves to another position', async () => {
		const under = deck();

		await under.music({a: track('one'), b: track('two')});
		await under.music({b: track('two'), a: track('one')});

		expect(played).toHaveLength(2);
		expect(paused).toHaveLength(0);
		expect(under.held().map(held => held.key)).toEqual(['b', 'a']);
	});

	it('restarts the same id when the take changes', async () => {
		const under = deck();

		await under.music(main('rain', {take: 0}));
		await under.music(main('rain', {take: 3}));

		expect(played).toHaveLength(2);
		expect(paused).toEqual([played[0]]);
	});

	it('does not restart the same take, nor a state that names none', async () => {
		const under = deck();

		await under.music(main('rain', {take: 3}));
		await under.music(main('rain', {take: 3}));
		// A scrub back to before the restart beat: no take, keep playing.
		await under.music(main('rain'));
		// And forward onto it again: still the take that is playing.
		await under.music(main('rain', {take: 3}));

		expect(played).toHaveLength(1);
	});

	it('newScene() makes a scene-top restart land again', async () => {
		const under = deck();

		await under.music(main('rain', {take: 0}));
		under.newScene();
		// Next passage, same track, no restart: carries.
		await under.music(main('rain'));
		expect(played).toHaveLength(1);

		under.newScene();
		// Next passage, `restart: true` at the top: take 0 again, but the held take was
		// forgotten, so it restarts.
		await under.music(main('rain', {take: 0}));
		expect(played).toHaveLength(2);
	});

	it('starts at `start:`', async () => {
		await deck().music(main('rain', {start: 2}));

		expect(played[0].currentTime).toBe(2);
	});

	it('drops a lookup that a newer change overtook', async () => {
		let release!: (url: string) => void;
		const under = new SoundDeck({doc: document});

		under.setResolver({
			...resolver(),
			url: (id: string) =>
				id === 'slow'
					? new Promise<string>(resolve => (release = resolve))
					: Promise.resolve(`blob:${id}`)
		});
		under.setMuted(false);

		const first = under.music(main('slow'));

		await under.music(main('fast'));
		release('blob:slow');
		await first;

		expect(played.map(el => el.src)).toEqual(['blob:fast']);
	});
});

describe('SoundDeck loop modes', () => {
	it('loop: false plays once and stays ended', async () => {
		const under = deck();

		await under.music(main('sting', {loop: false}));
		expect(played[0].loop).toBe(false);

		played[0].dispatchEvent(new Event('ended'));
		await under.music(main('sting', {loop: false}));

		// Re-applying the same state is the same request, not a new one.
		expect(played).toHaveLength(1);
		expect(under.held()[0].done).toBe(true);
	});

	it('loop: N rewinds and replays until N plays', async () => {
		const under = deck();

		await under.music(main('riff', {loop: 3, start: 1}));

		const el = played[0];

		expect(el.loop).toBe(false);

		el.currentTime = 9;
		el.dispatchEvent(new Event('ended'));
		expect(el.currentTime).toBe(1);
		el.dispatchEvent(new Event('ended'));
		expect(played).toHaveLength(3);
		el.dispatchEvent(new Event('ended'));

		// Third end = third play done. No fourth.
		expect(played).toHaveLength(3);
		expect(under.held()[0].done).toBe(true);
	});

	it('loop {from, to} jumps back to `from` when `to` is reached', async () => {
		jest.useFakeTimers();

		try {
			const under = deck();

			await under.music(main('theme', {loop: {from: 2, to: 14}}));

			const el = played[0];

			el.currentTime = 10;
			jest.advanceTimersByTime(30);
			expect(el.currentTime).toBe(10);

			el.currentTime = 14.01;
			jest.advanceTimersByTime(30);
			expect(el.currentTime).toBe(2);

			under.stop();
		} finally {
			jest.useRealTimers();
		}
	});

	it('loop {from} without `to` jumps back on ended', async () => {
		const under = deck();

		await under.music(main('theme', {loop: {from: 4}}));

		const el = played[0];

		el.dispatchEvent(new Event('ended'));
		expect(el.currentTime).toBe(4);
		expect(played).toHaveLength(2);
		expect(under.held()[0].done).toBe(false);
	});

	it('updates the loop mode live on the same take', async () => {
		const under = deck();

		await under.music(main('rain', {loop: true}));
		await under.music(main('rain', {loop: false}));

		expect(played).toHaveLength(1);
		expect(played[0].loop).toBe(false);
	});
});

describe('SoundDeck fades', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('fades a new track in over its own fade', async () => {
		const under = deck();

		await under.music(main('rain', {amount: 0.8, fade: 2}));

		const el = played[0];

		expect(el.volume).toBe(0);
		jest.advanceTimersByTime(1000);
		expect(el.volume).toBeCloseTo(0.4, 1);
		jest.advanceTimersByTime(1100);
		expect(el.volume).toBeCloseTo(0.8, 5);
	});

	it('fades a dropped track out over the OLD fade, then lets go', async () => {
		const under = deck();

		await under.music({rain: track('rain', {fade: 3})});
		// Let it fade all the way in first.
		jest.advanceTimersByTime(3100);
		await under.music({wind: track('wind', {fade: 0})});

		const rain = played[0];

		jest.advanceTimersByTime(1500);
		expect(rain.volume).toBeCloseTo(0.5, 1);
		expect(paused).not.toContain(rain);

		jest.advanceTimersByTime(1600);
		await settle();
		expect(paused).toContain(rain);
		expect(rain.hasAttribute('src')).toBe(false);
	});

	it('crossfades under one key with the NEW track’s fade', async () => {
		const under = deck();

		await under.music(main('rain', {fade: 0}));
		await under.music(main('storm', {fade: 1}));

		const [rain, storm] = played;

		jest.advanceTimersByTime(500);
		expect(rain.volume).toBeCloseTo(0.5, 1);
		expect(storm.volume).toBeCloseTo(0.5, 1);
		jest.advanceTimersByTime(600);
		await settle();
		expect(paused).toContain(rain);
		expect(storm.volume).toBeCloseTo(1, 5);
	});

	it('ramps a volume change on the same take', async () => {
		const under = deck();

		await under.music(main('rain', {amount: 1, fade: 0}));
		await under.music(main('rain', {amount: 0, fade: 1}));

		jest.advanceTimersByTime(500);
		expect(played[0].volume).toBeCloseTo(0.5, 1);
		jest.advanceTimersByTime(600);
		expect(played[0].volume).toBe(0);
		expect(played).toHaveLength(1);
	});

	it('a fade-out overtaking a fade-in ends silent, not half way', async () => {
		const under = deck();

		await under.music(main('rain', {fade: 2}));
		jest.advanceTimersByTime(1000);
		await under.music(undefined);
		jest.advanceTimersByTime(2100);
		await settle();

		expect(played[0].volume).toBe(0);
		expect(paused).toContain(played[0]);
	});
});

describe('DomRenderer with a shared deck', () => {
	function stage(music?: StageMusic) {
		return {
			camera: {at: {x: 0, y: 0}, zoom: 1},
			entities: {},
			fx: [],
			music
		} as never;
	}

	it('does not stop the deck on destroy, nor push its muted default', async () => {
		const shared = deck();
		const host = document.createElement('div');
		const renderer = new DomRenderer({deck: shared});

		await renderer.mount(host, resolver());
		await renderer.apply(stage(main('rain')));
		await settle();

		expect(shared.isMuted()).toBe(false);
		expect(played).toHaveLength(1);

		renderer.destroy();

		expect(paused).toHaveLength(0);
		expect(shared.held().map(held => held.id)).toEqual(['rain']);

		// The next passage's renderer, same track: carries, no restart.
		const next = new DomRenderer({deck: shared});

		await next.mount(host, resolver());
		await next.apply(stage(main('rain')));
		await settle();

		expect(played).toHaveLength(1);
		next.destroy();
	});

	it('writes every playing id to data-music, in key order', async () => {
		const host = document.createElement('div');
		const renderer = new DomRenderer({deck: deck()});

		await renderer.mount(host, resolver());
		await renderer.apply(stage({b: track('wind'), a: track('rain')}));

		expect(host.querySelector<HTMLElement>('[data-music]')?.dataset.music).toBe(
			'wind rain'
		);
		renderer.destroy();
	});

	it('an owned deck still stops on destroy', async () => {
		const host = document.createElement('div');
		const renderer = new DomRenderer();

		await renderer.mount(host, resolver());
		renderer.setMuted(false);
		await renderer.apply(stage(main('rain')));
		await settle();
		expect(played).toHaveLength(1);

		renderer.destroy();
		expect(paused).toContain(played[0]);
	});
});

describe('SoundDeck cue', () => {
	it('fires a one-shot, not looping', async () => {
		await deck().cue({amount: 1, id: 'door'});

		expect(played).toHaveLength(1);
		expect(played[0].loop).toBe(false);
	});

	it('lets one-shots overlap', async () => {
		const under = deck();

		await under.cue({amount: 1, id: 'step'});
		await under.cue({amount: 1, id: 'step'});

		expect(played).toHaveLength(2);
		expect(paused).toHaveLength(0);
	});

	it('fires nothing while muted', async () => {
		const under = new SoundDeck({doc: document});

		under.setResolver(resolver());
		await under.cue({amount: 1, id: 'door'});

		expect(played).toHaveLength(0);
	});

	it('does nothing when the name resolves to no asset', async () => {
		const under = new SoundDeck({doc: document});

		under.setResolver({
			async character() {
				return undefined;
			},
			async meta() {
				return undefined;
			},
			async url() {
				return undefined;
			}
		});
		under.setMuted(false);
		await under.cue({amount: 1, id: 'nope'});

		expect(played).toHaveLength(0);
	});
});

describe('SoundDeck stop', () => {
	it('silences the bed and every voice', async () => {
		const under = deck();

		await under.music(main('rain'));
		await under.cue({amount: 1, id: 'door'});
		under.stop();

		expect(paused).toHaveLength(2);
	});
});
