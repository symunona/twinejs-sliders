/**
 * `rot` on screen: the CSS the renderer writes, and what `measure()` then reports.
 *
 * Two things are pinned here and nothing else is interesting. ORDER — the mirror has to come
 * last in the transform string so it is applied to the sprite first, which is what makes a
 * positive `rot` lean the same way whichever direction the character faces. And `measure()`
 * — bubbles are placed by it, so an anchor that ignored the tilt would leave every speech
 * bubble hanging off an upright shoulder the sprite no longer has.
 *
 * jsdom does no layout, so the transform string is the contract; the drawing is the
 * browser's job.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {rotatePoint} from '../coords';
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
		at: {x: 0, y: 0},
		flip: false,
		opacity: 1,
		scale: 1,
		...patch
	};
}

function stage(entities: StageEntity[]): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(entities.map(e => [e.id, e])),
		fx: []
	};
}

async function mounted() {
	const mount = makeMount();
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

function transformOf(mount: HTMLElement, id: string): string {
	const el = mount.querySelector(
		`.sliders-entity[data-entity-id='${id}']`
	) as HTMLElement;

	return el.style.transform;
}

describe('rotatePoint', () => {
	it('turns clockwise in screen space, where y grows downwards', () => {
		const out = rotatePoint({x: 10, y: 0}, {x: 0, y: 0}, 90);

		expect(out.x).toBeCloseTo(0);
		expect(out.y).toBeCloseTo(10);
	});

	it('is the identity for no rotation', () => {
		const p = {x: 3, y: 7};

		expect(rotatePoint(p, {x: 0, y: 0}, 0)).toBe(p);
	});
});

describe('the transform the renderer writes', () => {
	it('leaves rotate() out entirely when there is no tilt', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira'})]), []);
		expect(transformOf(mount, 'mira')).not.toMatch(/rotate/);
		renderer.destroy();
	});

	it('puts rotate() between the translate and the mirror', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', rot: 15})]), []);
		expect(transformOf(mount, 'mira')).toMatch(
			/^translate3d\(.+\) rotate\(15deg\) scaleX\(1\)$/
		);
		renderer.destroy();
	});

	it('keeps the mirror last for a flipped sprite, so the lean does not reverse', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', flip: true, rot: 15})]),
			[]
		);
		expect(transformOf(mount, 'mira')).toMatch(
			/ rotate\(15deg\) scaleX\(-1\)$/
		);
		renderer.destroy();
	});

	it('takes a negative tilt', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', rot: -20})]), []);
		expect(transformOf(mount, 'mira')).toMatch(/rotate\(-20deg\)/);
		renderer.destroy();
	});
});

describe('measure() under a tilt', () => {
	it('turns the anchor about the origin, so a bubble follows the shoulder', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		const upright = renderer.measure('mira', 'bubble');

		await renderer.apply(stage([entity({id: 'mira', rot: 90})]), []);

		const turned = renderer.measure('mira', 'bubble');

		expect(upright).not.toBeNull();
		expect(turned).not.toBeNull();
		// The origin is the pivot, so it is the one point a rotation cannot move — and a
		// bubble anchor sits above it, so a quarter turn has to move the anchor.
		expect(turned!.x).not.toBeCloseTo(upright!.x);
		renderer.destroy();
	});

	it('reports the same point as before when the tilt is zero', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		const upright = renderer.measure('mira', 'bubble');

		await renderer.apply(stage([entity({id: 'mira', rot: 0})]), []);
		expect(renderer.measure('mira', 'bubble')).toEqual(upright);
		renderer.destroy();
	});
});
