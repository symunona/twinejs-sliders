import {CharacterPose} from '@sliders/scene-types';
import {
	appendSteps,
	moveStep,
	removeStep,
	setPoseFps,
	setStepDur,
	setStepFit,
	stepFit,
	stepFitToAll,
	stepsOf
} from '../pose-steps';

const fit = {offset: {x: 0.1, y: -0.2}, scale: 1};

function walk(): CharacterPose {
	return {
		anchors: {bubble: {x: 0.5, y: 0.1}},
		loop: false,
		steps: [{asset: 'a'}, {asset: 'b', dur: 0.2}, {asset: 'c', fit}]
	};
}

describe('pose steps', () => {
	it('reorders', () => {
		expect(stepsOf(moveStep(walk(), 0, 2)).map(step => step.asset)).toEqual([
			'b',
			'c',
			'a'
		]);
		expect(moveStep(walk(), 0, 5)).toEqual(walk());
	});

	it('removes, collapsing to a still at one left', () => {
		const two = removeStep(walk(), 1);

		expect(two.steps!.map(step => step.asset)).toEqual(['a', 'c']);

		const one = removeStep(two, 0);

		expect(one).toEqual({anchors: walk().anchors, asset: 'c', fit});
		expect(removeStep(one, 0)).toBe(one);
	});

	it('turns a still into steps when images are added', () => {
		expect(appendSteps({asset: 'a', fit}, ['b'])).toEqual({
			fit,
			steps: [{asset: 'a'}, {asset: 'b'}]
		});
	});

	it('sets holds, per step and per pose', () => {
		expect(setStepDur(walk(), 0, 0.5).steps![0].dur).toBe(0.5);
		expect(setStepDur(walk(), 1, undefined).steps![1].dur).toBeUndefined();
		expect(setPoseFps(walk(), 4).steps!.map(step => step.dur)).toEqual([
			0.25, 0.25, 0.25
		]);
		// 10 fps is the default hold, stored as absent.
		expect(setPoseFps(walk(), 10).steps!.every(step => step.dur === undefined)).toBe(
			true
		);
	});

	it('keeps per-step fits, identity stored as absent', () => {
		const pose = setStepFit(walk(), 0, fit);

		expect(pose.steps![0].fit).toEqual(fit);
		expect(setStepFit(pose, 0, {offset: {x: 0, y: 0}, scale: 1}).steps![0].fit).toBe(
			undefined
		);
		expect(stepFit({...walk(), fit: {offset: {x: 1, y: 1}, scale: 2}}, 0)).toEqual({
			offset: {x: 1, y: 1},
			scale: 2
		});
		expect(stepFit(walk(), 2)).toBe(fit);
		expect(stepFitToAll(walk(), 2).steps!.every(step => step.fit?.offset.x === 0.1)).toBe(
			true
		);
	});
});
