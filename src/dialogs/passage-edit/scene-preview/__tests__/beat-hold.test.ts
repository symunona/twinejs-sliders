import type {Beat, Scene} from '@sliders/scene-types';
import {
	AUTO_ADVANCE_MS,
	beatHoldMs,
	beatWaitsForClick,
	sceneAutoAdvanceMs,
	sceneHoldMs
} from '../beat-hold';

function scene(autoAdvance?: number): Scene {
	return {beats: [], entities: {}, links: {}, ...(autoAdvance === undefined ? {} : {autoAdvance})};
}

function say(dur?: number): Beat {
	return {index: 0, kind: 'say', text: 'hi', who: 'mira', ...(dur === undefined ? {} : {dur})};
}

describe('sceneAutoAdvanceMs()', () => {
	it('is undefined when there is no scene', () => {
		expect(sceneAutoAdvanceMs(undefined)).toBeUndefined();
	});

	it('is undefined when the scene has no opinion', () => {
		expect(sceneAutoAdvanceMs(scene())).toBeUndefined();
	});

	it('takes the scene key, in ms', () => {
		expect(sceneAutoAdvanceMs(scene(1.5))).toBe(1500);
	});

	// Kept, not collapsed: zero is the author asking the reader to click. `sceneHoldMs`
	// is where it becomes a length.
	it('keeps wait-for-a-click as a zero', () => {
		expect(sceneAutoAdvanceMs(scene(0))).toBe(0);
	});
});

describe('sceneHoldMs()', () => {
	it('falls back to the standard beat with no scene or no opinion', () => {
		expect(sceneHoldMs(undefined)).toBe(AUTO_ADVANCE_MS);
		expect(sceneHoldMs(scene())).toBe(AUTO_ADVANCE_MS);
	});

	it('takes the scene key, in ms', () => {
		expect(sceneHoldMs(scene(1.5))).toBe(1500);
	});

	// A marker gap needs a length and "waits forever" has none, so the drawing and
	// scrubbing path takes the standard beat. The play timer reads the raw answer instead.
	it('gives wait-for-a-click a drawable length', () => {
		expect(sceneHoldMs(scene(0))).toBe(AUTO_ADVANCE_MS);
	});
});

describe('beatHoldMs() with a scene default', () => {
	it('uses the scene default for an untimed beat', () => {
		expect(beatHoldMs(say(), 1200)).toBe(1200);
		expect(beatHoldMs(undefined, 1200)).toBe(1200);
	});

	// The precedence the player runs: the beat the author timed wins over every default.
	it('lets the beat dur beat the scene default', () => {
		expect(beatHoldMs(say(0.2), 1200)).toBe(200);
		expect(beatHoldMs(say(0), 1200)).toBe(0);
	});

	it('lets wait: beat the scene default', () => {
		expect(beatHoldMs({index: 0, kind: 'wait', seconds: 2}, 1200)).toBe(2000);
	});
});

describe('beatWaitsForClick()', () => {
	it('waits on an untimed line when the scene asks for clicks', () => {
		expect(beatWaitsForClick(say(), 0)).toBe(true);
		expect(
			beatWaitsForClick({index: 0, kind: 'box', text: 'Night.'} as Beat, 0)
		).toBe(true);
	});

	it('does not wait when the line timed itself', () => {
		expect(beatWaitsForClick(say(2), 0)).toBe(false);
		expect(beatWaitsForClick(say(0), 0)).toBe(false);
	});

	it('does not wait when the scene has a pace or no opinion', () => {
		expect(beatWaitsForClick(say(), 1500)).toBe(false);
		expect(beatWaitsForClick(say(), undefined)).toBe(false);
	});

	it('never waits on the opening state or a stage move', () => {
		expect(beatWaitsForClick(undefined, 0)).toBe(false);
		expect(
			beatWaitsForClick(
				{index: 0, kind: 'set', patch: {}, who: 'mira'} as unknown as Beat,
				0
			)
		).toBe(false);
	});
});
