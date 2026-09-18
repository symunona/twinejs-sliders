/**
 * `bg:` — the long form that gives a backdrop motion, and the beat that cuts to another.
 *
 * The scalar form is covered by `parse-scene.test.ts`; everything here is what the map and
 * the beat key added.
 */

import {parseScene} from '../parse-scene';

function scene(text: string) {
	return parseScene(text);
}

describe('bg: long form', () => {
	it('reads id, fx and speed', () => {
		const {errors, scene: parsed} = scene(
			'id: cellar\nbg: {id: cellar-art, fx: parallax_left, speed: 20}\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.bg).toBe('cellar-art');
		expect(parsed.bgFx).toEqual({id: 'parallax_left', speed: 20});
	});

	it('leaves speed off when the author did not name one', () => {
		const {scene: parsed} = scene('bg: {id: hall, fx: circling}\nbeats: []\n');

		expect(parsed.bgFx).toEqual({id: 'circling'});
	});

	it('takes an unknown motion token, for a story stylesheet to paint', () => {
		const {errors, scene: parsed} = scene(
			'bg: {id: hall, fx: lava_glow}\nbeats: []\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.bgFx).toEqual({id: 'lava_glow'});
	});

	it('keeps a numeric-looking name as written', () => {
		const {scene: parsed} = scene('bg: {id: 04}\nbeats: []\n');

		expect(parsed.bg).toBe('04');
	});

	it('names sfx: as the wrong key, and says which is which', () => {
		const {errors} = scene('bg: {id: hall, sfx: parallax_left}\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].hint).toMatch(/spelled fx:/);
		expect(errors[0].hint).toMatch(/sfx: is a sound/);
	});

	it('suggests a near-miss key', () => {
		const {errors} = scene('bg: {id: hall, sped: 4}\nbeats: []\n');

		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].hint).toMatch(/speed/);
	});

	it('refuses a map with no id', () => {
		const {errors, scene: parsed} = scene('bg: {fx: circling}\nbeats: []\n');

		expect(errors[0].code).toBe('bad-value');
		expect(parsed.bg).toBeUndefined();
		expect(parsed.bgFx).toBeUndefined();
	});

	it('refuses a speed of zero or less', () => {
		const {errors, scene: parsed} = scene(
			'bg: {id: hall, fx: circling, speed: 0}\nbeats: []\n'
		);

		expect(errors[0].code).toBe('bad-value');
		expect(parsed.bgFx).toEqual({id: 'circling'});
	});

	it('warns when a speed has no motion to time', () => {
		const {errors} = scene('bg: {id: hall, speed: 4}\nbeats: []\n');

		expect(errors).toHaveLength(1);
		expect(errors[0].severity).toBe('warning');
	});

	it('reads bg: {id: ~} as no backdrop', () => {
		const {errors, scene: parsed} = scene('bg: {id: ~}\nbeats: []\n');

		expect(errors).toEqual([]);
		expect(parsed.bg).toBeNull();
	});
});

describe('bg: on a beat', () => {
	it('is a beat of its own', () => {
		const {errors, scene: parsed} = scene(
			'bg: hall\nbeats:\n  - bg: {id: cellar, fx: earthquake}\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.beats[0]).toEqual({
			bg: 'cellar',
			bgFx: {id: 'earthquake'},
			index: 0,
			kind: 'bg'
		});
	});

	it('takes the scalar form too, and `~` to clear', () => {
		const {scene: parsed} = scene('beats:\n  - bg: cellar\n  - bg: ~\n');

		expect(parsed.beats[0]).toMatchObject({bg: 'cellar', kind: 'bg'});
		expect(parsed.beats[1]).toMatchObject({bg: null, kind: 'bg'});
	});

	it('rides on a line of dialogue', () => {
		const {errors, scene: parsed} = scene(
			'cast: {mira: {}}\nbeats:\n  - mira: {say: "Down here.", bg: cellar}\n'
		);

		expect(errors).toEqual([]);
		expect(parsed.beats[0]).toMatchObject({
			bg: 'cellar',
			kind: 'say',
			text: 'Down here.'
		});
	});

	it('rides on a stage move', () => {
		const {scene: parsed} = scene(
			'cast: {mira: {}}\nbeats:\n  - mira: {at: 0.3, bg: {id: cellar, fx: circling}}\n'
		);

		expect(parsed.beats[0]).toMatchObject({
			bg: 'cellar',
			bgFx: {id: 'circling'},
			kind: 'set'
		});
	});

	it('rides on a box', () => {
		const {scene: parsed} = scene(
			'beats:\n  - box: {text: "Dark.", bg: cellar}\n'
		);

		expect(parsed.beats[0]).toMatchObject({bg: 'cellar', kind: 'box'});
	});

	it('points a speaker-only bg at the beat form instead', () => {
		const {errors, scene: parsed} = scene(
			'cast: {mira: {}}\nbeats:\n  - mira: {bg: cellar}\n'
		);

		expect(parsed.beats).toHaveLength(0);
		expect(errors[0].hint).toMatch(/- bg: cellar/);
	});

	it('refuses bg: inside cast:', () => {
		const {errors} = scene('cast: {mira: {bg: cellar}}\nbeats: []\n');

		expect(errors[0].code).toBe('unknown-key');
		expect(errors[0].hint).toMatch(/top of the scene or on a beat/);
	});
});
