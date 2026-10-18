import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {applyScene, runBeats, sceneTimeline} from '@sliders/scene-core';
import {parseScene} from '@sliders/scene-schema';
import {emptyStage} from '@sliders/scene-types';
import {timingLayout} from '../timing-layout';
import {TimingOverlay, TIMING_COLUMN_PX} from '../timing-overlay';
import {GHOST_PREFIX, scrubStage} from '../timing-scrub';

const SCENE = [
	'bg: hall',
	'cast:',
	'  mira: {at: 0}',
	'  joren: {at: 0.5}',
	'beats:',
	'  - mira: {at: 0.3, dur: 2}',
	'    joren: {at: -0.3, pose: wave}',
	'  - mira: "Now!"',
	'    joren: "Now!"',
	'  - bg: cellar',
	'  - box: "Later."',
	''
].join('\n');

function compile(autoAdvanceSec = 3) {
	const {scene} = parseScene(SCENE);
	const states = runBeats(applyScene(emptyStage(), scene), scene.beats);

	return {states, timeline: sceneTimeline(states, scene.beats, {autoAdvanceSec, readerSec: 3})};
}

function layout(autoAdvanceSec = 3) {
	return timingLayout(compile(autoAdvanceSec).timeline, ['mira', 'joren']);
}

/** jsdom lays nothing out: give every track the same 850px box, 100px a second here. */
function stubTracks(container: HTMLElement) {
	for (const track of container.querySelectorAll<HTMLElement>('.timing-track')) {
		track.getBoundingClientRect = () => ({left: 0, width: 850} as DOMRect);
	}
}

describe('timingLayout', () => {
	it('one group per thing that moves, one row per kind, lines as say rows', () => {
		const {columns, groups} = layout();
		const byId = Object.fromEntries(groups.map(group => [group.id, group]));

		expect(groups.map(group => group.id)).toEqual(['stage', 'mira', 'joren', 'box']);
		expect(byId.mira.rows.map(row => row.kind)).toEqual(['say', 'move']);
		expect(byId.joren.rows.map(row => row.kind)).toEqual(['say', 'move', 'pose']);
		expect(byId.stage.rows.map(row => row.kind)).toEqual(['bg']);
		expect(byId.mira.rows[1].bars[0]).toMatchObject({beat: 0, duration: 2, start: 0});
		expect(columns.map(column => column.advance)).toEqual(['timer', 'auto', 'anim', 'reader']);
	});

	it('marks a click wait when the scene does not auto-advance', () => {
		expect(layout(0).columns[1].advance).toBe('reader');
	});
});

describe('<TimingOverlay>', () => {
	it('draws rows, edges and the mouse on click waits; picks a beat; closes', () => {
		const onBeatChange = jest.fn();
		const onClose = jest.fn();
		const {container} = render(
			<TimingOverlay beat={1} layout={layout(0)} onBeatChange={onBeatChange} onClose={onClose} />
		);

		expect(screen.getAllByTestId('timing-group')).toHaveLength(4);
		expect(container.querySelectorAll('.timing-header .timing-edge.advance-reader').length).toBe(2);
		expect(container.querySelectorAll('.timing-beat-mouse')).toHaveLength(2);
		expect(screen.getAllByText('Now!')).toHaveLength(2);

		fireEvent.click(screen.getAllByTestId('timing-beat')[2]);
		expect(onBeatChange).toHaveBeenCalledWith(3);

		fireEvent.keyDown(window, {key: 'Escape'});
		expect(onClose).toHaveBeenCalled();
	});
});

describe('<TimingOverlay> hover', () => {
	it('is sized to its beat columns', () => {
		const {container} = render(
			<TimingOverlay beat={1} layout={layout(0)} onBeatChange={jest.fn()} onClose={jest.fn()} />
		);
		const overlay = screen.getByTestId('timing-overlay');

		expect(overlay.style.getPropertyValue('--timing-beats')).toBe('4');
		expect(TIMING_COLUMN_PX).toBeGreaterThan(0);
		expect(container.querySelector('.timing-cursor')).toBeNull();
	});

	it('scrubs: x on a track is a moment of a beat, a bar names its entity, leave clears', () => {
		const onScrub = jest.fn();
		const {container} = render(
			<TimingOverlay
				beat={1}
				layout={layout(0)}
				onBeatChange={jest.fn()}
				onClose={jest.fn()}
				onScrub={onScrub}
			/>
		);

		stubTracks(container);

		// Total 8.5s over 850px. 100px = 1s = halfway through beat 0's 2s.
		fireEvent.mouseMove(container.querySelector('.timing-header .timing-track')!, {
			clientX: 100
		});
		expect(onScrub).toHaveBeenLastCalledWith({beat: 0, t: 1});
		expect(container.querySelector('.timing-cursor')).not.toBeNull();

		// 300px = 3s = 1s into beat 1.
		fireEvent.mouseMove(container.querySelector('.timing-header .timing-track')!, {
			clientX: 300
		});
		expect(onScrub).toHaveBeenLastCalledWith({beat: 1, t: 1});

		const bar = container.querySelector('[data-group="mira"] [data-kind="move"] .timing-bar')!;

		fireEvent.mouseMove(bar, {clientX: 50});
		expect(onScrub).toHaveBeenLastCalledWith({beat: 0, entity: 'mira', t: 0.5});
		expect(bar.classList.contains('hovered')).toBe(true);

		// The stage's own rows scrub without naming an entity.
		fireEvent.mouseMove(container.querySelector('[data-group="stage"] .timing-bar')!, {
			clientX: 560
		});
		expect(onScrub.mock.calls[onScrub.mock.calls.length - 1][0].entity).toBeUndefined();

		fireEvent.mouseOut(container.querySelector('.timing-overlay-body')!);
		expect(onScrub).toHaveBeenLastCalledWith(undefined);
		expect(container.querySelector('.timing-cursor')).toBeNull();
	});
});

describe('scrubStage', () => {
	it('draws the beat partway; a bar hover ghosts start and end', () => {
		const {states, timeline} = compile(0);
		const half = scrubStage(states, timeline.beats, {beat: 0, t: 1})!;
		const mira = half.entities.mira.at.x;

		// mira 0 -> 0.3 over 2s: strictly between at 1s.
		expect(mira).toBeGreaterThan(0);
		expect(mira).toBeLessThan(0.3);
		expect(Object.keys(half.entities).some(id => id.startsWith(GHOST_PREFIX))).toBe(false);

		const ghosted = scrubStage(states, timeline.beats, {beat: 0, entity: 'mira', t: 1})!;
		const from = ghosted.entities[`${GHOST_PREFIX}from-mira`];
		const to = ghosted.entities[`${GHOST_PREFIX}to-mira`];

		expect(from.at.x).toBeCloseTo(0);
		expect(to.at.x).toBeCloseTo(0.3);
		expect(from.opacity).toBeLessThan(1);
		expect(ghosted.entities.mira.opacity).toBe(1);
		expect(ghosted.entities.mira.at.x).toBeCloseTo(mira);
	});

	it('no ghosts for an entity the beat does not change', () => {
		const {states, timeline} = compile(0);
		const stage = scrubStage(states, timeline.beats, {beat: 1, entity: 'mira', t: 1})!;

		expect(Object.keys(stage.entities).some(id => id.startsWith(GHOST_PREFIX))).toBe(false);
	});
});
