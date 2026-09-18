/**
 * `easeTransitions` — the sibling of `timeTransitions`.
 *
 * What is pinned here is the precedence rule, because it is the whole of the design: a
 * beat's `ease:` wins per KIND over the scene's, and a kind nobody named carries no token
 * at all, so the renderer supplies `DEFAULT_EASES` at draw time rather than the differ
 * stamping it into every transition nobody wrote.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {DEFAULT_EASES, EASE_KINDS, cssEase, easeValue} from '@sliders/scene-types';
import {diffStages, easeTransitions, timeTransitions} from '../diff-stages';

function entity(patch: Partial<StageEntity> & {id: string}): StageEntity {
	return {
		kind: 'cast',
		ref: patch.id,
		at: {x: 0, y: -0.85},
		flip: false,
		opacity: 1,
		scale: 1,
		...patch
	};
}

function stage(...list: StageEntity[]): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(list.map(one => [one.id, one])),
		fx: []
	};
}

const before = stage(entity({id: 'mira'}));
const after = stage(entity({id: 'mira', at: {x: 0.4, y: -0.85}, scale: 2}));

function easedBy(kind: string, list: ReturnType<typeof diffStages>) {
	return list.find(t => t.kind === kind)?.ease;
}

describe('easeTransitions()', () => {
	it('hands an untouched list straight back', () => {
		const moved = diffStages(before, after);

		expect(easeTransitions(moved, undefined)).toBe(moved);
		expect(easeTransitions(moved, undefined, undefined)).toBe(moved);
	});

	it('gives every kind the scalar the beat named', () => {
		const eased = easeTransitions(diffStages(before, after), 'back_out');

		expect(eased.length).toBeGreaterThan(1);
		expect(eased.every(t => t.ease === 'back_out')).toBe(true);
	});

	it('gives a map form only the kinds it names', () => {
		const eased = easeTransitions(diffStages(before, after), {
			move: 'back_out'
		});

		expect(easedBy('move', eased)).toBe('back_out');
		// Absent, not defaulted: "nobody chose" and "the author chose linear" must stay
		// distinguishable, and the renderer is where the default belongs.
		expect(easedBy('scale', eased)).toBeUndefined();
	});

	it('falls through to the scene per kind, not as a whole', () => {
		const eased = easeTransitions(
			diffStages(before, after),
			{move: 'back_out'},
			'ease_in_out'
		);

		expect(easedBy('move', eased)).toBe('back_out');
		expect(easedBy('scale', eased)).toBe('ease_in_out');
	});

	it('lets a beat scalar beat a scene map outright', () => {
		const eased = easeTransitions(diffStages(before, after), 'linear', {
			move: 'back_out'
		});

		expect(eased.every(t => t.ease === 'linear')).toBe(true);
	});

	it('does not mutate the list it was given', () => {
		const moved = diffStages(before, after);

		easeTransitions(moved, 'back_out');

		expect(moved.every(t => t.ease === undefined)).toBe(true);
	});

	it('chains after timeTransitions without disturbing the durations', () => {
		const chained = easeTransitions(
			timeTransitions(diffStages(before, after), 0.8),
			'back_out'
		);

		expect(chained.every(t => t.duration === 0.8)).toBe(true);
		expect(chained.every(t => t.ease === 'back_out')).toBe(true);
	});

	it('keeps a token it does not recognise — the renderer decides, not the differ', () => {
		const eased = easeTransitions(diffStages(before, after), 'nonsense');

		expect(easedBy('move', eased)).toBe('nonsense');
	});
});

describe('the ease vocabulary', () => {
	it('has a default for every transition kind', () => {
		for (const kind of EASE_KINDS) {
			expect(DEFAULT_EASES[kind]).toBeDefined();
			expect(cssEase(undefined, kind)).toBeTruthy();
		}
	});

	it('resolves a preset name to CSS and passes a raw function through', () => {
		expect(easeValue('back_out')).toBe('cubic-bezier(0.34, 1.56, 0.64, 1)');
		expect(easeValue('cubic-bezier(0.1, 0, 0.9, 1)')).toBe(
			'cubic-bezier(0.1, 0, 0.9, 1)'
		);
		expect(easeValue('steps(4, end)')).toBe('steps(4, end)');
		expect(easeValue('ease-in-out')).toBe('ease-in-out');
	});

	it('refuses a word it does not know, and is not fooled by Object.prototype', () => {
		expect(easeValue('whoosh')).toBeUndefined();
		expect(easeValue('constructor')).toBeUndefined();
		expect(easeValue('toString')).toBeUndefined();
		expect(easeValue(undefined)).toBeUndefined();
	});

	it('falls back to the kind default rather than writing nonsense into CSS', () => {
		expect(cssEase('whoosh', 'move')).toBe(cssEase(undefined, 'move'));
		expect(cssEase('back_out', 'move')).toBe(
			'cubic-bezier(0.34, 1.56, 0.64, 1)'
		);
	});
});
