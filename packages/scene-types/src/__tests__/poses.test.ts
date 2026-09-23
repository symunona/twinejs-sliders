import {
	mapPoseAssets,
	poseAssets,
	poseCover,
	poseHasSteps,
	upgradeCharacter,
	type Character
} from '../index';

const STEPS = {steps: [{asset: 'a_1', dur: 0.1}, {asset: 'a_2'}]};

describe('pose helpers', () => {
	it('lists a still as its one image and a stepped pose as every step', () => {
		expect(poseAssets({asset: 'a_9'})).toEqual(['a_9']);
		expect(poseAssets(STEPS)).toEqual(['a_1', 'a_2']);
		expect(poseAssets(undefined)).toEqual([]);
		expect(poseAssets({})).toEqual([]);
	});

	it('covers with the still or step one', () => {
		expect(poseCover({asset: 'a_9'})).toBe('a_9');
		expect(poseCover(STEPS)).toBe('a_1');
		expect(poseHasSteps(STEPS)).toBe(true);
		expect(poseHasSteps({asset: 'a_9'})).toBe(false);
	});

	it('maps every image, or gives up on the whole pose', () => {
		const map = new Map([
			['a_1', 'b_1'],
			['a_2', 'b_2']
		]);

		expect(mapPoseAssets(STEPS, id => map.get(id))).toEqual({
			steps: [{asset: 'b_1', dur: 0.1}, {asset: 'b_2'}]
		});
		expect(mapPoseAssets({asset: 'a_1', loop: true}, id => map.get(id))).toEqual({
			asset: 'b_1',
			loop: true
		});
		expect(mapPoseAssets(STEPS, id => (id === 'a_1' ? 'b_1' : undefined))).toBe(
			undefined
		);
	});
});

describe('upgradeCharacter', () => {
	const base = {
		id: 'mira',
		name: 'mira',
		origin: {x: 0.5, y: 1},
		size: {h: 1, w: 1},
		tags: []
	};

	it('renames frames to poses', () => {
		const old = {...base, frames: {idle: {asset: 'a_1'}}} as unknown as Character;
		const upgraded = upgradeCharacter(old);

		expect(upgraded.poses).toEqual({idle: {asset: 'a_1'}});
		expect(upgraded).not.toHaveProperty('frames');
	});

	it('is identity for today\'s shape', () => {
		const today = {...base, poses: {idle: {asset: 'a_1'}}} as Character;

		expect(upgradeCharacter(today)).toBe(today);
	});
});
