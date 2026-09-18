/**
 * The backdrop's motion through the merge, and the beats that change a backdrop.
 *
 * The rule under test both places: the motion is read off `bg`, never off its own absence,
 * so naming a backdrop always states its motion in full.
 */

import {emptyStage} from '@sliders/scene-types';
import type {Scene, Stage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {runBeats} from '../run-beats';

function scene(over: Partial<Scene> = {}): Scene {
	return {beats: [], entities: {}, links: {}, ...over};
}

function stageWith(over: Partial<Stage> = {}): Stage {
	return {...emptyStage(), ...over};
}

describe('applyScene bg motion', () => {
	it('carries a declared motion onto the stage', () => {
		const out = applyScene(emptyStage(), scene({bg: 'hall', bgFx: {id: 'circling', speed: 9}}));

		expect(out.bg).toBe('hall');
		expect(out.bgFx).toEqual({id: 'circling', speed: 9});
	});

	it('copies rather than shares the motion', () => {
		const source = scene({bg: 'hall', bgFx: {id: 'circling'}});
		const out = applyScene(emptyStage(), source);

		out.bgFx!.id = 'earthquake';
		expect(source.bgFx).toEqual({id: 'circling'});
	});

	it('inherits the motion when a patch names no backdrop at all', () => {
		const base = stageWith({bg: 'hall', bgFx: {id: 'circling'}});
		const out = applyScene(base, scene({from: 'hall'}));

		expect(out.bgFx).toEqual({id: 'circling'});
	});

	it('STOPS an inherited motion when a patch names a backdrop without one', () => {
		const base = stageWith({bg: 'hall', bgFx: {id: 'circling'}});
		const out = applyScene(base, scene({bg: 'cellar', from: 'hall'}));

		expect(out.bg).toBe('cellar');
		expect(out.bgFx).toBeUndefined();
	});

	it('clears the motion with the backdrop on bg: ~', () => {
		const base = stageWith({bg: 'hall', bgFx: {id: 'circling'}});
		const out = applyScene(base, scene({bg: null, from: 'hall'}));

		expect(out.bg).toBeUndefined();
		expect(out.bgFx).toBeUndefined();
	});

	it('leaves an inherited motion alone for an id:-derived backdrop', () => {
		// The scene asked for nothing: `id:` is a guess at the art, not a statement about
		// how it moves.
		const base = stageWith({bg: 'hall', bgFx: {id: 'circling'}});
		const out = applyScene(base, scene({from: 'hall', id: 'hall-later'}));

		expect(out.bgFx).toEqual({id: 'circling'});
	});
});

describe('runBeats bg', () => {
	it('changes the backdrop from that beat on', () => {
		const states = runBeats(stageWith({bg: 'hall'}), [
			{index: 0, kind: 'wait', seconds: 1},
			{bg: 'cellar', index: 1, kind: 'bg'},
			{index: 2, kind: 'wait', seconds: 1}
		]);

		expect(states.map(one => one.bg)).toEqual([
			'hall',
			'hall',
			'cellar',
			'cellar'
		]);
	});

	it('carries the motion, and replaces it on the next cut', () => {
		const states = runBeats(stageWith({bg: 'hall'}), [
			{bg: 'cellar', bgFx: {id: 'earthquake'}, index: 0, kind: 'bg'},
			{bg: 'street', index: 1, kind: 'bg'}
		]);

		expect(states[1].bgFx).toEqual({id: 'earthquake'});
		expect(states[2].bgFx).toBeUndefined();
	});

	it('takes the backdrop away on bg: ~', () => {
		const states = runBeats(stageWith({bg: 'hall', bgFx: {id: 'circling'}}), [
			{bg: null, index: 0, kind: 'bg'}
		]);

		expect(states[1].bg).toBeUndefined();
		expect(states[1].bgFx).toBeUndefined();
	});

	it('clears bgImplicit: a beat asks for its backdrop out loud', () => {
		const states = runBeats(stageWith({bg: 'hall', bgImplicit: true}), [
			{bg: 'cellar', index: 0, kind: 'bg'}
		]);

		expect(states[1].bgImplicit).toBeUndefined();
	});

	it('applies a bg riding on a line of dialogue', () => {
		const states = runBeats(stageWith({bg: 'hall'}), [
			{bg: 'cellar', index: 0, kind: 'say', text: 'Down here.', who: 'mira'}
		]);

		expect(states[1].bg).toBe('cellar');
	});

	it('leaves the backdrop alone on a beat that names none', () => {
		const states = runBeats(stageWith({bg: 'hall', bgFx: {id: 'circling'}}), [
			{index: 0, kind: 'say', text: 'Hello.', who: 'mira'}
		]);

		expect(states[1].bg).toBe('hall');
		expect(states[1].bgFx).toEqual({id: 'circling'});
	});
});
