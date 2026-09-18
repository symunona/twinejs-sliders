import type {AssetResolver} from '@sliders/scene-types';
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

describe('SoundDeck music', () => {
	it('plays the bed, looping', async () => {
		await deck().music({amount: 0.5, id: 'rain'});

		expect(played).toHaveLength(1);
		expect(played[0].loop).toBe(true);
		expect(played[0].src).toBe('blob:rain');
		expect(played[0].volume).toBe(0.5);
	});

	it('does not restart the same track at the same volume', async () => {
		const under = deck();

		await under.music({amount: 1, id: 'rain'});
		await under.music({amount: 1, id: 'rain'});

		// The point of the whole design: every scene declares its bed, and a passage change
		// under one track must not be audible.
		expect(played).toHaveLength(1);
		expect(paused).toHaveLength(0);
	});

	it('changes volume on the same track without restarting it', async () => {
		const under = deck();

		await under.music({amount: 1, id: 'rain'});
		await under.music({amount: 0.2, id: 'rain'});

		expect(played).toHaveLength(1);
		expect(played[0].volume).toBe(0.2);
	});

	it('swaps to a different track', async () => {
		const under = deck();

		await under.music({amount: 1, id: 'rain'});
		await under.music({amount: 1, id: 'storm'});

		expect(played).toHaveLength(2);
		expect(played[1].src).toBe('blob:storm');
		expect(paused).toContain(played[0]);
	});

	it('stops the bed when a scene asks for silence', async () => {
		const under = deck();

		await under.music({amount: 1, id: 'rain'});
		await under.music(undefined);

		expect(paused).toContain(played[0]);
	});

	it('plays nothing while muted, and starts on unmute', async () => {
		const under = new SoundDeck({doc: document});

		under.setResolver(resolver());
		await under.music({amount: 1, id: 'rain'});
		expect(played).toHaveLength(0);

		under.setMuted(false);
		// The bed was resolved and held, so unmuting starts it rather than waiting for the
		// next scene to declare it again.
		expect(played).toHaveLength(1);
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

		await under.music({amount: 1, id: 'rain'});
		await under.cue({amount: 1, id: 'door'});
		under.stop();

		expect(paused).toHaveLength(2);
	});
});
