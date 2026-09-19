/**
 * The bubble keys that decide the SHAPE of a line rather than its position: `sizing:`,
 * `h:`, `anchor:`, `accent:`, and the scene-level `bubble:` block they are usually written
 * in.
 *
 * `as:` is deliberately not checked against a list — a story may invent a token and paint
 * it in its stylesheet — so the tests here are about the keys that change what the renderer
 * DOES, which are the ones a typo has to be caught in.
 */

import {parseScene} from '../parse-scene';

const BEAT = (body: string) => `beats:\n  - mira: ${body}`;

describe('bubble: on a beat', () => {
	it('takes sizing, w and h together', () => {
		const {scene, errors} = parseScene(
			BEAT('{say: "Hi.", bubble: {sizing: absolute, w: 0.5, h: 0.22}}')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			style: {sizing: 'absolute', w: 0.5, h: 0.22}
		});
	});

	it('takes a detached anchor', () => {
		const {scene, errors} = parseScene(
			BEAT('{say: "Hi.", bubble: {anchor: scene, at: [0.5, 0.2]}}')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			style: {anchor: 'scene', at: {x: 0.5, y: 0.2}}
		});
	});

	it('takes both colours', () => {
		const {scene, errors} = parseScene(
			BEAT('{say: "Hi.", bubble: {as: shard, bg: "#fff", accent: "#3fc1cd"}}')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			style: {as: 'shard', bg: '#fff', accent: '#3fc1cd'}
		});
	});

	it('refuses a sizing it does not know', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {sizing: fixed}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(errors[0].message).toContain('fixed');
	});

	it('refuses an anchor it does not know', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {anchor: stage}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
	});

	// Both are fractions of the stage, so the same rule catches the author who wrote pixels.
	it('refuses a height outside 0 to 1', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {h: 240}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].message).toContain('240');
	});

	it('offers a fix for a near-miss key', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {sizin: auto}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('sizing');
	});
});

describe('manual sizing and tail:', () => {
	it('takes sizing: manual with a box', () => {
		const {scene, errors} = parseScene(
			BEAT('{say: "Hi.", bubble: {sizing: manual, w: 0.3, h: 0.18}}')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			style: {sizing: 'manual', w: 0.3, h: 0.18}
		});
	});

	it('names manual in the hint when the sizing is a typo', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {sizing: manul}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-value');
		expect(errors[0].hint).toContain('manual');
	});

	it('takes a tail as a pair of stage fractions', () => {
		const {scene, errors} = parseScene(
			BEAT('{say: "Hi.", bubble: {tail: [0.8, 0.35]}}')
		);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			style: {tail: {x: 0.8, y: 0.35}}
		});
	});

	it('refuses a tail that is not a pair', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {tail: 0.8}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('bad-coordinate');
	});

	it('offers tail as a fix for a near-miss key', () => {
		const {errors} = parseScene(BEAT('{say: "Hi.", bubble: {tial: [0, 0]}}'));

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('tail');
	});
});

describe('scene-level bubble:', () => {
	it('is a whole style', () => {
		const {scene, errors} = parseScene(
			'bubble: {as: comic, font: "Bangers, cursive", sizing: absolute}\nbeats:\n  - mira: "Hi."'
		);

		expect(errors).toEqual([]);
		expect(scene.bubble).toEqual({
			as: 'comic',
			font: 'Bangers, cursive',
			sizing: 'absolute'
		});
	});

	it('takes the scalar short form, like a beat does', () => {
		const {scene, errors} = parseScene('bubble: thought');

		expect(errors).toEqual([]);
		expect(scene.bubble).toEqual({as: 'thought'});
	});

	it('does not touch the beats, which merge later and elsewhere', () => {
		const {scene} = parseScene(
			'bubble: {as: comic}\nbeats:\n  - mira: {say: "Hi.", as: yell}'
		);

		expect(scene.bubble).toEqual({as: 'comic'});
		expect(scene.beats[0]).toMatchObject({style: {as: 'yell'}});
	});

	it('reports a bad key inside it', () => {
		const {errors} = parseScene('bubble: {plase: top}');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].fix?.text).toBe('place');
	});
});
