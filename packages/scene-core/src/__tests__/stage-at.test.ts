import {parseScene} from '@sliders/scene-schema';
import {emptyStage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {beatTransitions} from '../beat-timing';
import {resolveStage} from '../resolve-stage';
import {runBeats} from '../run-beats';
import {easeAt, stageAt} from '../stage-at';

function at(text: string, beat: number, t: number) {
	const {errors, scene} = parseScene(text);

	expect(errors.filter(e => e.severity !== 'warning')).toEqual([]);

	const states = runBeats(applyScene(emptyStage(), scene), scene.beats);
	const before = resolveStage(states[beat]);
	const after = resolveStage(states[beat + 1]);

	return stageAt(
		before,
		after,
		beatTransitions(states[beat], states[beat + 1], scene.beats[beat]),
		t
	);
}

const CAST = 'cast:\n  mira: {at: 0}\n  joren: {at: 0.5}\nbeats:\n';

describe('easeAt', () => {
	it('linear, ends, keywords and cubic-bezier', () => {
		expect(easeAt('linear', 0.25)).toBe(0.25);
		expect(easeAt('cubic-bezier(0, 0, 0.58, 1)', 0)).toBeCloseTo(0);
		expect(easeAt('cubic-bezier(0, 0, 0.58, 1)', 1)).toBeCloseTo(1);
		// ease-out is ahead of linear in the middle.
		expect(easeAt('cubic-bezier(0, 0, 0.58, 1)', 0.5)).toBeGreaterThan(0.6);
		expect(easeAt('ease-in', 0.5)).toBeLessThan(0.4);
		expect(easeAt('cubic-bezier(0.34, 1.56, 0.64, 1)', 0.6)).toBeGreaterThan(1);
	});

	it('linear() stops, spread evenly', () => {
		expect(easeAt('linear(0, 0.5, 0.9, 1, 0.92, 1)', 0.2)).toBeCloseTo(0.5);
		expect(easeAt('linear(0, 0.5, 0.9, 1, 0.92, 1)', 0.1)).toBeCloseTo(0.25);
		expect(easeAt('linear(0, 1 50%, 1)', 0.25)).toBeCloseTo(0.5);
	});

	it('unknown is linear, x clamped', () => {
		expect(easeAt('steps(4)', 0.3)).toBe(0.3);
		expect(easeAt('linear', 2)).toBe(1);
	});
});

describe('stageAt', () => {
	it('a move halfway, on its own curve and clock', () => {
		const text = `${CAST}  - mira: {at: 1, dur: 2, ease: linear}\n`;

		expect(at(text, 0, 0).entities.mira.at.x).toBeCloseTo(0);
		expect(at(text, 0, 1).entities.mira.at.x).toBeCloseTo(0.5);
		expect(at(text, 0, 2).entities.mira.at.x).toBeCloseTo(1);
		// Past the end it stays at the end.
		expect(at(text, 0, 5).entities.mira.at.x).toBeCloseTo(1);
		// Joren did not move.
		expect(at(text, 0, 1).entities.joren.at.x).toBeCloseTo(0.5);
	});

	it('per-entity timing: one done, one halfway', () => {
		const text = `${CAST}  - mira: {at: 1, dur: 1, ease: linear}\n    joren: {at: 1.5, dur: 4, ease: linear}\n`;
		const half = at(text, 0, 2);

		expect(half.entities.mira.at.x).toBeCloseTo(1);
		expect(half.entities.joren.at.x).toBeCloseTo(1);
	});

	it('scale and rot interpolate', () => {
		const text = `${CAST}  - mira: {scale: 2, rot: 90, dur: 1, ease: linear}\n`;
		const mid = at(text, 0, 0.5).entities.mira;

		expect(mid.scale).toBeCloseTo(1.5);
		expect(mid.rot).toBeCloseTo(45);
	});

	it('pose and flip switch at the midpoint', () => {
		const text = `${CAST}  - mira: {pose: wave, flip: true, dur: 1}\n`;

		expect(at(text, 0, 0.4).entities.mira.pose).not.toBe('wave');
		expect(at(text, 0, 0.6).entities.mira.pose).toBe('wave');
		expect(at(text, 0, 0.4).entities.mira.flip).toBe(false);
		expect(at(text, 0, 0.6).entities.mira.flip).toBe(true);
	});

	it('enter fades in, exit fades out and is gone at the end', () => {
		const lamp = {
			at: {x: 0, y: 0},
			flip: false,
			id: 'lamp',
			kind: 'prop' as const,
			opacity: 1,
			ref: 'lamp',
			scale: 1
		};
		const empty = emptyStage();
		const lit = {...emptyStage(), entities: {lamp}};
		const enter = [{duration: 1, ease: 'linear', entityId: 'lamp', kind: 'enter' as const}];
		const exit = [{duration: 1, ease: 'linear', entityId: 'lamp', kind: 'exit' as const}];

		expect(stageAt(empty, lit, enter, 0.5).entities.lamp.opacity).toBeCloseTo(0.5);
		expect(stageAt(lit, empty, exit, 0.25).entities.lamp.opacity).toBeCloseTo(0.75);
		expect(stageAt(lit, empty, exit, 1).entities.lamp).toBeUndefined();
	});
});
