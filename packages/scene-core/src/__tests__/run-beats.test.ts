import {emptyStage} from '@sliders/scene-types';
import type {Beat, Stage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {collectMarks, runBeats} from '../run-beats';

function startStage(): Stage {
	return applyScene(emptyStage(), {
		beats: [],
		entities: {
			mira: {at: {x: -0.4, y: 0}, frame: 'idle', kind: 'cast', ref: 'mira'}
		},
		links: {}
	});
}

const BEATS: Beat[] = [
	{index: 0, kind: 'say', text: 'One.', who: 'mira'},
	{index: 1, kind: 'set', patch: {at: {x: 0.2, y: 0}}, who: 'mira'},
	{index: 2, kind: 'mark', name: 'tense'},
	{
		index: 3,
		kind: 'say',
		patch: {frame: 'angry'},
		text: 'Two.',
		who: 'mira'
	},
	{index: 4, kind: 'fx', fx: {amount: 0.4, id: 'rain'}},
	{index: 5, kind: 'wait', seconds: 0.5}
];

describe('runBeats', () => {
	it('returns one more state than there are beats', () => {
		expect(runBeats(startStage(), BEATS)).toHaveLength(BEATS.length + 1);
	});

	it('makes S0 the stage before any beat runs', () => {
		const start = startStage();

		expect(runBeats(start, BEATS)[0]).toEqual(start);
	});

	it('applies a set beat', () => {
		const states = runBeats(startStage(), BEATS);

		expect(states[1].entities.mira.at).toEqual({x: -0.4, y: 0});
		expect(states[2].entities.mira.at).toEqual({x: 0.2, y: 0});
	});

	it('applies a say beat patch and keeps the rest of the entity', () => {
		const states = runBeats(startStage(), BEATS);

		expect(states[4].entities.mira).toMatchObject({
			at: {x: 0.2, y: 0},
			frame: 'angry'
		});
	});

	it('leaves the stage alone for say without a patch, box, wait and mark', () => {
		const states = runBeats(startStage(), BEATS);

		expect(states[1]).toEqual(states[0]);
		expect(states[3]).toEqual(states[2]);
		expect(states[6]).toEqual(states[5]);
	});

	it('adds fx', () => {
		const states = runBeats(startStage(), BEATS);

		expect(states[4].fx).toEqual([]);
		expect(states[5].fx).toEqual([{amount: 0.4, id: 'rain'}]);
	});

	it('updates an fx that is already running rather than duplicating it', () => {
		const states = runBeats(startStage(), [
			{fx: {amount: 0.2, id: 'rain'}, index: 0, kind: 'fx'},
			{fx: {amount: 0.9, id: 'rain'}, index: 1, kind: 'fx'}
		]);

		expect(states[2].fx).toEqual([{amount: 0.9, id: 'rain'}]);
	});

	it('ignores a patch aimed at somebody who is not on stage', () => {
		const states = runBeats(startStage(), [
			{index: 0, kind: 'set', patch: {at: {x: 1, y: 1}}, who: 'ghost'}
		]);

		expect(states[1]).toEqual(states[0]);
		expect(states[1].entities.ghost).toBeUndefined();
	});

	it('gives every state its own objects, so later beats cannot rewrite history', () => {
		const states = runBeats(startStage(), BEATS);

		expect(states[0].entities.mira).not.toBe(states[6].entities.mira);
		expect(states[0].entities.mira.at).toEqual({x: -0.4, y: 0});
	});

	it('never mutates the stage it was handed', () => {
		const start = startStage();
		const before = JSON.stringify(start);

		runBeats(start, BEATS);
		expect(JSON.stringify(start)).toBe(before);
	});

	it('returns just S0 when there are no beats', () => {
		expect(runBeats(startStage(), [])).toHaveLength(1);
	});
});

describe('collectMarks', () => {
	it('maps a mark to the state it names', () => {
		const marks = collectMarks(BEATS);
		const states = runBeats(startStage(), BEATS);

		expect(marks.get('tense')).toBe(3);
		// The mark itself changes nothing, so the state it names is the one it sits on.
		expect(states[3]).toEqual(states[2]);
		expect(states[marks.get('tense') as number].entities.mira.at).toEqual({
			x: 0.2,
			y: 0
		});
	});

	it('is empty when there are no marks', () => {
		expect(collectMarks([{index: 0, kind: 'wait', seconds: 1}]).size).toBe(0);
	});
});
