/**
 * The curve has to reach the element, which in CSS means `transition-timing-function`
 * written next to every `transition-duration` the renderer already writes.
 *
 * jsdom runs no animations, so what is pinned here is the property the renderer set — the
 * movement itself is the browser's job, exactly as in `bg-fx.test.ts`. The value asserted
 * is always the CSS, never the author's token: `cssEase` is the one place a name becomes a
 * curve, and a test that repeated the bezier by hand would be a second source for it.
 */

import type {Stage, StageEntity, Transition} from '@sliders/scene-types';
import {cssEase} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

function makeMount(width = 1600, height = 900): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

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

function stage(over: Partial<Stage> = {}, ...list: StageEntity[]): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(list.map(one => [one.id, one])),
		fx: [],
		...over
	};
}

async function mounted() {
	const mount = makeMount();
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

function spriteOf(mount: HTMLElement, id = 'mira'): HTMLElement {
	return mount.querySelector(`[data-entity-id="${id}"]`) as HTMLElement;
}

function timing(el: HTMLElement): string {
	return el.style.transitionTimingFunction;
}

const MOVE: Transition = {kind: 'move', entityId: 'mira', duration: 0.6};

afterEach(() => {
	document.body.innerHTML = '';
});

describe('ease reaches the sprite', () => {
	it('writes the CSS for the token the transition carries', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), []);
		await renderer.apply(
			stage({}, entity({id: 'mira', at: {x: 0.4, y: -0.85}})),
			[{...MOVE, ease: 'back_out'}]
		);

		expect(timing(spriteOf(mount))).toBe(cssEase('back_out', 'move'));
		expect(timing(spriteOf(mount))).toContain('1.56');
	});

	it('falls back to the kind default when the beat named nothing', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), []);
		await renderer.apply(
			stage({}, entity({id: 'mira', at: {x: 0.4, y: -0.85}})),
			[MOVE]
		);

		expect(timing(spriteOf(mount))).toBe(cssEase(undefined, 'move'));
	});

	it('falls back rather than writing a token CSS cannot parse', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), []);
		await renderer.apply(
			stage({}, entity({id: 'mira', at: {x: 0.4, y: -0.85}})),
			[{...MOVE, ease: 'whoosh'}]
		);

		expect(timing(spriteOf(mount))).toBe(cssEase(undefined, 'move'));
	});

	it('takes the curve from the LONGEST of the kinds sharing the element', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), []);
		// One element, one transition-duration and one timing function: a 0.2s move and a
		// 0.9s scale must not produce a 0.9s movement on the move's curve.
		await renderer.apply(
			stage({}, entity({id: 'mira', at: {x: 0.4, y: -0.85}, scale: 2})),
			[
				{kind: 'move', entityId: 'mira', duration: 0.2, ease: 'linear'},
				{kind: 'scale', entityId: 'mira', duration: 0.9, ease: 'back_out'}
			]
		);

		const sprite = spriteOf(mount);

		expect(sprite.style.transitionDuration).toBe('0.9s');
		expect(timing(sprite)).toBe(cssEase('back_out', 'scale'));
	});

	it('uses the entity-wide token when the transition names no entity', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), []);
		await renderer.apply(
			stage({}, entity({id: 'mira', at: {x: 0.4, y: -0.85}})),
			[{kind: 'move', duration: 0.6, ease: 'anticipate'}]
		);

		expect(timing(spriteOf(mount))).toBe(cssEase('anticipate', 'move'));
	});

	it('eases an entrance on its own kind default', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), [
			{kind: 'enter', entityId: 'mira', duration: 0.3}
		]);

		expect(timing(spriteOf(mount))).toBe(cssEase(undefined, 'enter'));
	});

	it('eases an entrance on the token the beat named', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({}, entity({id: 'mira'})), [
			{kind: 'enter', entityId: 'mira', duration: 0.3, ease: 'bounce_out'}
		]);

		expect(timing(spriteOf(mount))).toBe(cssEase('bounce_out', 'enter'));
		expect(timing(spriteOf(mount))).toContain('linear(');
	});
});

describe('ease reaches the camera and the backdrop', () => {
	it('writes the camera token on the camera element', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({camera: {at: {x: 0.2, y: 0}, zoom: 1.2}}), [
			{kind: 'camera', duration: 0.5, ease: 'anticipate'}
		]);

		const camera = mount.querySelector('.sliders-camera') as HTMLElement;

		expect(timing(camera)).toBe(cssEase('anticipate', 'camera'));
	});

	it('writes the backdrop token on the incoming image', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({bg: 'hall'}), [
			{kind: 'bg', duration: 0.5, ease: 'ease_in_out'}
		]);

		const img = mount.querySelector('img.sliders-bg') as HTMLElement;

		expect(timing(img)).toBe(cssEase('ease_in_out', 'bg'));
	});
});

describe('a pose step carries its own curve', () => {
	it('uses the step ease for a step that glides, and the beat ease otherwise', async () => {
		jest.useFakeTimers();

		try {
			const {mount, renderer} = await mounted();

			await renderer.apply(stage({}, entity({id: 'mira'})), []);
			await renderer.apply(
				stage(
					{},
					entity({
						id: 'mira',
						pose: 'step_a',
						steps: [
							{name: 'step_a', dur: 0.1, at: {x: 0.1, y: -0.85}, ease: 'linear'},
							{name: 'step_b', dur: 0.1, at: {x: 0.2, y: -0.85}, ease: 'back_out'}
						]
					})
				),
				[{...MOVE, ease: 'anticipate'}]
			);

			// Step 1 moves, so its own curve is the one on the element — narrower than the
			// beat's, which is what "narrowest wins" means here.
			expect(timing(spriteOf(mount))).toBe(cssEase('linear', 'move'));

			// A tick is the renderer's own clock, not a beat: the step's curve has to
			// survive it, because there is nobody else left to supply one.
			jest.advanceTimersByTime(100);

			expect(timing(spriteOf(mount))).toBe(cssEase('back_out', 'move'));
		} finally {
			jest.useRealTimers();
		}
	});

	it('snaps a step that moves nowhere, so its curve cannot matter', async () => {
		jest.useFakeTimers();

		try {
			const {mount, renderer} = await mounted();

			await renderer.apply(stage({}, entity({id: 'mira'})), []);
			await renderer.apply(
				stage(
					{},
					entity({
						id: 'mira',
						pose: 'blink_a',
						steps: [
							{name: 'blink_a', dur: 0.1},
							{name: 'blink_b', dur: 0.1}
						]
					})
				),
				[{...MOVE, ease: 'back_out'}]
			);

			jest.advanceTimersByTime(100);

			// A pose swap with no `at` is not travel. The beat's movement finished before
			// the tick, so re-timing the element on the beat's curve would animate a
			// position nothing is changing.
			expect(spriteOf(mount).style.transitionDuration).toBe('0s');
		} finally {
			jest.useRealTimers();
		}
	});
});
