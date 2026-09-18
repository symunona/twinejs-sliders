import {emptyStage} from '@sliders/scene-types';
import type {Scene, Stage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {diffStages} from '../diff-stages';

function scene(over: Partial<Scene> = {}): Scene {
	return {beats: [], entities: {}, links: {}, ...over};
}

function stageWith(music: Stage['music']): Stage {
	return {...emptyStage(), music};
}

describe('applyScene + music', () => {
	it('plays what the scene declares', () => {
		const out = applyScene(emptyStage(), scene({music: {amount: 0.5, id: 'rain'}}));

		expect(out.music).toEqual({amount: 0.5, id: 'rain'});
	});

	it('inherits the bed through from:', () => {
		const base = stageWith({amount: 1, id: 'rain'});
		const out = applyScene(base, scene({from: 'other'}));

		expect(out.music).toEqual({amount: 1, id: 'rain'});
	});

	it('silences an inherited bed with music: ~', () => {
		const base = stageWith({amount: 1, id: 'rain'});
		const out = applyScene(base, scene({from: 'other', music: null}));

		expect(out.music).toBeUndefined();
	});

	it('does not carry a bed into a snapshot', () => {
		// A snapshot is a complete statement of the stage, so an absent key is silence.
		// Nothing else would be previewable: the editor renders one passage and cannot know
		// what played before it.
		const base = stageWith({amount: 1, id: 'rain'});
		const out = applyScene(base, scene({id: 'somewhere'}));

		expect(out.music).toBeUndefined();
	});

	it('does not share the scene object with the stage', () => {
		const declared = {amount: 1, id: 'rain'};
		const out = applyScene(emptyStage(), scene({music: declared}));

		declared.amount = 0;
		expect(out.music).toEqual({amount: 1, id: 'rain'});
	});
});

describe('diffStages + music', () => {
	const musicOnly = (from: Stage, to: Stage) =>
		diffStages(from, to).filter(transition => transition.kind === 'music');

	it('emits nothing when the same track plays at the same volume', () => {
		// The whole reason every scene can declare its own bed: a chapter of passages under
		// one track must play as one unbroken take.
		const from = stageWith({amount: 0.4, id: 'rain'});
		const to = stageWith({amount: 0.4, id: 'rain'});

		expect(musicOnly(from, to)).toEqual([]);
	});

	it('emits a transition when the volume changes', () => {
		const from = stageWith({amount: 0.4, id: 'rain'});
		const to = stageWith({amount: 0.1, id: 'rain'});

		expect(musicOnly(from, to)).toEqual([
			{
				duration: 1.5,
				from: {amount: 0.4, id: 'rain'},
				kind: 'music',
				to: {amount: 0.1, id: 'rain'}
			}
		]);
	});

	it('emits a transition when the track changes', () => {
		const from = stageWith({amount: 1, id: 'rain'});
		const to = stageWith({amount: 1, id: 'storm'});

		expect(musicOnly(from, to)).toHaveLength(1);
	});

	it('emits a transition when the bed stops', () => {
		const out = musicOnly(stageWith({amount: 1, id: 'rain'}), emptyStage());

		expect(out).toHaveLength(1);
		expect(out[0].to).toBeUndefined();
	});

	it('emits nothing between two silent stages', () => {
		expect(musicOnly(emptyStage(), emptyStage())).toEqual([]);
	});
});
