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
			<BeatTimeline
				beat={beat}
				beats={beats}
				labels={false}
				onBeatChange={onBeatChange}
			/>
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
				labels={false}
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
				labels={false}
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

describe('<BeatTimeline> labels', () => {
	/**
	 * jsdom lays nothing out, so the measure pass would see every marker at x 0 and every
	 * label 0px wide. Faked from `data-state` instead: markers 100px apart, labels 40px.
	 */
	function fakeGeometry() {
		const left = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			'offsetLeft'
		);
		const width = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			'offsetWidth'
		);
		const client = Object.getOwnPropertyDescriptor(
			HTMLElement.prototype,
			'clientWidth'
		);

		Object.defineProperty(HTMLElement.prototype, 'clientWidth', {
			configurable: true,
			get: () => 400
		});

		Object.defineProperty(HTMLElement.prototype, 'offsetLeft', {
			configurable: true,
			get(this: HTMLElement) {
				return Number(this.getAttribute('data-state') ?? 0) * 100;
			}
		});
		Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
			configurable: true,
			get(this: HTMLElement) {
				return this.classList.contains('scene-preview-timeline-mark') ? 8 : 40;
			}
		});

		// `clientWidth` lives on Element, not HTMLElement, so the override above shadows it
		// rather than replacing it and there is nothing to put back.
		return () => {
			Object.defineProperty(HTMLElement.prototype, 'offsetLeft', left!);
			Object.defineProperty(HTMLElement.prototype, 'offsetWidth', width!);

			if (client) {
				Object.defineProperty(HTMLElement.prototype, 'clientWidth', client);
			} else {
				delete (HTMLElement.prototype as unknown as Record<string, unknown>)
					.clientWidth;
			}
		};
	}

	let restore: () => void;

	beforeEach(() => {
		restore = fakeGeometry();
		jest
			.spyOn(HTMLElement.prototype, 'getBoundingClientRect')
			.mockReturnValue({left: 0, width: 400} as DOMRect);
	});

	afterEach(() => {
		restore();
		jest.restoreAllMocks();
	});

	function renderLabelled(beats: Beat[], beat = 0) {
		const onBeatChange = jest.fn();
		const {container} = render(
			<BeatTimeline
				beat={beat}
				beats={beats}
				labels
				onBeatChange={onBeatChange}
			/>
		);

		return {container, onBeatChange};
	}

	it('names every beat it can place', () => {
		const {container} = renderLabelled([say(0), say(1), say(2)]);
		const placed = [
			...container.querySelectorAll('.scene-preview-timeline-label.placed')
		];

		// State 0 plus one per beat, and at 100px apart nothing has to be dropped.
		expect(placed).toHaveLength(4);
		// State 0 is the arrival, not a beat, so it has a name and nothing else.
		// i18n is not initialised in unit tests, so a translated string is its own key.
		expect(placed[0].textContent).toBe(
			'dialogs.passageEdit.scenePreview.timelineLabelArrival'
		);
		expect(
			placed
				.slice(1)
				.map(
					label =>
						label.querySelector('.scene-preview-timeline-label-who')
							?.textContent
				)
		).toEqual(['mira', 'mira', 'mira']);
	});

	// What the author is actually looking for on the strip: which line is this.
	it('shows the spoken line, and the duration beside it', () => {
		const {container} = renderLabelled([say(0), say(1, 0.4)]);
		const labels = [
			...container.querySelectorAll('.scene-preview-timeline-label')
		];

		expect(
			labels[1].querySelector('.scene-preview-timeline-label-text')?.textContent
		).toBe('hi');
		expect(labels[1].querySelector('.scene-preview-timeline-label-dur')).toBe(
			null
		);
		expect(
			labels[2].querySelector('.scene-preview-timeline-label-dur')?.textContent
		).toBe('0.4s');
	});

	// `wait` IS a duration, so it says so once rather than twice.
	it('labels a wait beat with its own seconds', () => {
		const {container} = renderLabelled([
			say(0),
			{index: 1, kind: 'wait', seconds: 1.5}
		]);
		const label = [
			...container.querySelectorAll('.scene-preview-timeline-label')
		][2];

		expect(
			label.querySelector('.scene-preview-timeline-label-who')?.textContent
		).toBe('wait');
		expect(
			label.querySelector('.scene-preview-timeline-label-dur')?.textContent
		).toBe('1.5s');
	});

	it('draws no labels when it is collapsed', () => {
		const {container} = render(
			<BeatTimeline
				beat={0}
				beats={[say(0), say(1), say(2)]}
				labels={false}
				onBeatChange={jest.fn()}
			/>
		);

		expect(
			container.querySelector('.scene-preview-timeline-label')
		).toBeNull();
	});

	// Nearest wins: never nothing, and never a hunt for an 8px dot.
	it('highlights the marker nearest the pointer', () => {
		const {container} = renderLabelled([say(0), say(1), say(2)]);
		const strip = screen.getByTestId('scene-preview-timeline');

		// Anchors sit at 4, 104, 204, 304 (offsetLeft + half an 8px dot).
		fireEvent.pointerMove(strip, {clientX: 260});
		expect(
			container.querySelector('.scene-preview-timeline-mark[data-hovered]')
		).toHaveAttribute('data-state', '3');

		// Squarely between two markers still lights one of them.
		fireEvent.pointerMove(strip, {clientX: 154});
		expect(
			container.querySelector('.scene-preview-timeline-mark[data-hovered]')
		).toBeTruthy();

		fireEvent.pointerLeave(strip);
		expect(
			container.querySelector('.scene-preview-timeline-mark[data-hovered]')
		).toBeNull();
	});

	it('scrubs to the nearest marker when the strip is clicked off a dot', () => {
		const {onBeatChange} = renderLabelled([say(0), say(1), say(2)]);

		fireEvent.click(screen.getByTestId('scene-preview-timeline'), {
			clientX: 190
		});
		expect(onBeatChange).toHaveBeenCalledWith(2);
	});

	// The scrubber's own label is placed first, so it can never be bumped down.
	it('keeps the current beat label on the top row', () => {
		const {container} = renderLabelled([say(0), say(1), say(2)], 2);
		const current = container.querySelector<HTMLElement>(
			'.scene-preview-timeline-label[data-current]'
		);

		expect(current).toHaveClass('placed');
		expect(current!.style.top).toBe('5px');
	});
});
