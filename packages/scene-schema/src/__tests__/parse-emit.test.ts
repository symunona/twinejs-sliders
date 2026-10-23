/**
 * `emit:` — a particle emitter's settings, per entity. Same rules as `grade:`.
 */

import {parseScene} from '../parse-scene';

const PROP = (body: string) => `props:\n  fire: ${body}`;

describe('emit: on an entity', () => {
	it('takes a map of emitter settings', () => {
		const {scene, errors} = parseScene(
			PROP("{at: 0, emit: {rate: 80, color: '#ff8800', blend: normal}}")
		);

		expect(errors).toEqual([]);
		expect(scene.entities.fire?.emit).toEqual({
			blend: 'normal',
			color: '#ff8800',
			rate: 80
		});
	});

	it('clamps out of range with a warning', () => {
		const {scene, errors} = parseScene(PROP('{emit: {rate: 5000}}'));

		expect(scene.entities.fire?.emit).toEqual({rate: 400});
		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
	});

	it('warns on an unknown key and a bad colour, keeps the rest', () => {
		const {scene, errors} = parseScene(
			PROP("{emit: {rates: 5, color: red, life: 2}}")
		);

		expect(scene.entities.fire?.emit).toEqual({life: 2});
		expect(errors.map(error => error.code)).toEqual(['unknown-key', 'bad-value']);
	});

	it('keeps emit: ~ as a null, so a beat can clear it', () => {
		const {scene, errors} = parseScene(
			`${PROP('{emit: {rate: 5}}')}\nbeats:\n  - fire: {emit: ~}`
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({patch: {emit: null}});
	});
});
