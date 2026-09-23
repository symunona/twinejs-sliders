/**
 * `rot:` — a tilt in degrees, on an entity and on one step of a pose cycle.
 *
 * The interesting cases are the ones where absent and zero must stay distinguishable, and
 * the warning for a value past a whole turn, which is the only thing about a rotation that
 * an author can get wrong without the YAML being wrong.
 */

import {parseScene} from '../parse-scene';

const CAST = (body: string) => `cast:\n  mira: ${body}`;

describe('rot: on an entity', () => {
	it('takes a positive tilt', () => {
		const {scene, errors} = parseScene(CAST('{rot: 15}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.rot).toBe(15);
	});

	it('takes a negative tilt', () => {
		const {scene, errors} = parseScene(CAST('{rot: -8.5}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.rot).toBe(-8.5);
	});

	it('keeps an explicit zero, so a beat can undo a tilt', () => {
		const {scene, errors} = parseScene(CAST('{rot: 0}'));

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.rot).toBe(0);
	});

	it('leaves rot absent when the author never wrote one', () => {
		const {scene} = parseScene(CAST('{at: 0.3}'));

		expect(scene.entities.mira).not.toHaveProperty('rot');
	});

	it('refuses a value that is not a number', () => {
		const {errors} = parseScene(CAST('{rot: sideways}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toMatch(/rot must be a number/);
	});

	it('warns past a whole turn, and still takes the value', () => {
		const {scene, errors} = parseScene(CAST('{rot: 720}'));

		expect(scene.entities.mira?.rot).toBe(720);
		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
		expect(errors[0].message).toMatch(/draws the same as 0/);
	});

	it('says nothing about a degree short of a whole turn', () => {
		const {errors} = parseScene(CAST('{rot: 359}'));

		expect(errors).toEqual([]);
	});
});

describe('rot: on a beat', () => {
	it('patches the entity it names', () => {
		const {scene, errors} = parseScene(
			`cast:\n  mira: {at: 0}\nbeats:\n  - mira: {say: "Oof.", rot: 12}`
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({patch: {rot: 12}});
	});
});

describe('rot: on a pose step', () => {
	it('is accepted beside the other placement keys', () => {
		const {scene, errors} = parseScene(
			CAST('{pose: [{name: fall_1, rot: 20}, {name: fall_2, rot: 80}]}')
		);

		expect(errors).toEqual([]);
		expect(scene.entities.mira?.steps).toEqual([
			{name: 'fall_1', rot: 20},
			{name: 'fall_2', rot: 80}
		]);
	});

	it('warns past a whole turn there too', () => {
		const {errors} = parseScene(CAST('{pose: [{name: spin, rot: -400}]}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
	});
});
