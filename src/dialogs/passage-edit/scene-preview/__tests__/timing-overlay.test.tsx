import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {applyScene, runBeats, sceneTimeline} from '@sliders/scene-core';
import {parseScene} from '@sliders/scene-schema';
import {emptyStage} from '@sliders/scene-types';
import {timingLayout} from '../timing-layout';
import {TimingOverlay} from '../timing-overlay';

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

function layout(autoAdvanceSec = 3) {
	const {scene} = parseScene(SCENE);
	const states = runBeats(applyScene(emptyStage(), scene), scene.beats);

	return timingLayout(sceneTimeline(states, scene.beats, {autoAdvanceSec, readerSec: 3}), [
		'mira',
		'joren'
	]);
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
