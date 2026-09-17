import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {Beat} from '@sliders/scene-types';
import {AUTO_ADVANCE_MS, beatHoldMs} from '../beat-hold';
import {BeatTimeline, holdTimes} from '../beat-timeline';

function say(index: number, dur?: number): Beat {
	return {
		index,
		kind: 'say',
		text: 'hi',
		who: 'mira',
		...(dur === undefined ? {} : {dur})
	};
}

describe('beatHoldMs()', () => {
	it('falls back to the auto-advance default', () => {
		expect(beatHoldMs(undefined)).toBe(AUTO_ADVANCE_MS);
		expect(beatHoldMs(say(0))).toBe(AUTO_ADVANCE_MS);
	});

	it('takes a beat at its own word', () => {
		expect(beatHoldMs(say(0, 0.8))).toBe(800);
		expect(beatHoldMs(say(0, 0))).toBe(0);
	});

	// The standing defect this fixed: editor playback used to be a flat 3s and ignored the
	// one timing primitive the language already had.
	it('honours a wait beat', () => {
		expect(beatHoldMs({index: 0, kind: 'wait', seconds: 1.5})).toBe(1500);
	});

	it('prefers an explicit dur on a wait beat', () => {
		expect(beatHoldMs({dur: 0.2, index: 0, kind: 'wait', seconds: 1.5})).toBe(
			200
		);
	});
});

describe('holdTimes()', () => {
	// One more than the beats: state 0 was produced by nothing.
	it('starts with the opening state', () => {
		expect(holdTimes([say(0, 0.8), say(1, 2)])).toEqual([
			AUTO_ADVANCE_MS,
			800,
			2000
		]);
	});

	it('is empty-ish for a scene with no beats', () => {
		expect(holdTimes([])).toEqual([AUTO_ADVANCE_MS]);
	});
});

describe('<BeatTimeline>', () => {
	function renderStrip(beats: Beat[], beat = 0) {
		const onBeatChange = jest.fn();

		render(
			<BeatTimeline beat={beat} beats={beats} onBeatChange={onBeatChange} />
		);

		return onBeatChange;
	}

	// Two markers say nothing the chevrons do not.
	it('draws nothing for a scene that barely has beats', () => {
		renderStrip([]);
		expect(screen.queryByTestId('scene-preview-timeline')).toBeNull();

		renderStrip([say(0)]);
		expect(screen.queryByTestId('scene-preview-timeline')).toBeNull();
	});

	it('draws one marker per state', () => {
		renderStrip([say(0), say(1), say(2)]);
		// Three beats, four states.
		expect(screen.getAllByRole('button')).toHaveLength(4);
	});

	it('marks where the scrubber is', () => {
		renderStrip([say(0), say(1), say(2)], 2);

		const marks = screen.getAllByRole('button');

		expect(marks[2]).toHaveAttribute('data-current');
		expect(marks[0]).not.toHaveAttribute('data-current');
	});

	it('scrubs to the marker that was clicked', () => {
		const onBeatChange = renderStrip([say(0), say(1), say(2)]);

		fireEvent.click(screen.getAllByRole('button')[3]);
		expect(onBeatChange).toHaveBeenCalledWith(3);
	});

	// The whole reason the strip exists: a held beat takes more room than a snap.
	it('spaces the gaps by how long each beat holds', () => {
		const {container} = render(
			<BeatTimeline
				beat={0}
				beats={[say(0, 0.5), say(1, 4)]}
				onBeatChange={jest.fn()}
			/>
		);
		const gaps = [
			...container.querySelectorAll<HTMLElement>('.scene-preview-timeline-gap')
		].map(gap => gap.style.flexGrow);

		// Gap n is the hold of state n - 1: the default, then beats[0]'s 0.5s.
		expect(gaps).toEqual([String(AUTO_ADVANCE_MS), '500']);
	});

	// A run of `dur: 0` beats would otherwise stack into one unclickable dot. The floor is
	// CSS `min-width`; flex-grow only has to stay non-negative for it to apply.
	it('never asks for a negative or zero grow', () => {
		const {container} = render(
			<BeatTimeline
				beat={0}
				beats={[say(0, 0), say(1, 0), say(2, 0)]}
				onBeatChange={jest.fn()}
			/>
		);

		for (const gap of container.querySelectorAll<HTMLElement>(
			'.scene-preview-timeline-gap'
		)) {
			expect(Number(gap.style.flexGrow)).toBeGreaterThan(0);
		}
	});
});
