/**
 * `fit:` — an entity drawn as a full-bleed plane instead of a positioned sprite.
 *
 * What is pinned here is that a plane goes nowhere near `spriteRect`: no pixel width, no
 * `translate3d`, no origin pin. That is the feature — a plane is the stage box, so a
 * backdrop can sit INSIDE the entity stack with cast in front of it, which `bg:` (one
 * layer, outside the stack) cannot do.
 *
 * And that z still interleaves. A plane is an ordinary entity in the one z space; if it
 * did not sort against sprites there would be no reason to have it.
 *
 * jsdom does no layout, so the CSS the renderer writes is the contract; the drawing is the
 * browser's job.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {FIT_Z} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';
import {RENDER_DOM_CSS} from '../styles';

function makeMount(width = 1600, height = 900): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

function entity(patch: Partial<StageEntity> & {id: string}): StageEntity {
	return {
		kind: 'prop',
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

function elOf(mount: HTMLElement, id: string): HTMLElement {
	return mount.querySelector(
		`.sliders-entity[data-entity-id='${id}']`
	) as HTMLElement;
}

function imgOf(mount: HTMLElement, id: string): HTMLImageElement {
	return mount.querySelector(
		`.sliders-entity[data-entity-id='${id}'] img`
	) as HTMLImageElement;
}

/** Draw order as the browser would read it: ids sorted by the z-index written on them. */
function drawOrder(mount: HTMLElement): string[] {
	return [...mount.querySelectorAll('.sliders-entity')]
		.map(el => ({
			id: (el as HTMLElement).dataset.entityId as string,
			z: Number((el as HTMLElement).style.zIndex)
		}))
		.sort((a, b) => a.z - b.z)
		.map(item => item.id);
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('a fit: entity', () => {
	it('fills the stage box instead of taking a sprite rect', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'wall', fit: 'cover'})]), []);

		const style = elOf(mount, 'wall').style;

		expect(style.width).toBe('100%');
		expect(style.height).toBe('100%');
		// No spriteRect: the transform carries the mirror and nothing else.
		expect(style.transform).toBe('scaleX(1)');
		expect(style.transform).not.toContain('translate3d');
		expect(style.transformOrigin).toBe('50% 50%');
	});

	it('marks itself with data-fit, and drops it again when it stops being one', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'wall', fit: 'contain'})]), []);
		expect(elOf(mount, 'wall').dataset.fit).toBe('contain');

		// Reconciled, not rebuilt: the same element has to forget it was a plane, or
		// `[data-fit]` keeps the sprite stretched across the stage.
		await renderer.apply(stage([entity({id: 'wall'})]), []);
		expect(elOf(mount, 'wall').dataset.fit).toBeUndefined();
		expect(elOf(mount, 'wall').style.transform).toContain('translate3d');
	});

	it('fits and centres the picture rather than pinning it at the sprite origin', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'wall', fit: 'cover'})]), []);

		expect(imgOf(mount, 'wall').style.objectFit).toBe('cover');
		expect(imgOf(mount, 'wall').style.objectPosition).toBe('50% 50%');
	});

	it('hands the picture back to the stylesheet when the plane becomes a sprite', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'wall', fit: 'cover'})]), []);
		await renderer.apply(stage([entity({id: 'wall'})]), []);

		expect(imgOf(mount, 'wall').style.objectFit).toBe('');
		expect(imgOf(mount, 'wall').style.objectPosition).toBe('50% 100%');
	});

	it('still honours opacity and flip', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'wall', fit: 'cover', flip: true, opacity: 0.4})]),
			[]
		);

		expect(elOf(mount, 'wall').style.transform).toBe('scaleX(-1)');
		expect(elOf(mount, 'wall').style.opacity).toBe('0.4');
	});

	it('reports the whole stage as its rect', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'wall', fit: 'cover'})]), []);

		const box = renderer.stageBox();
		const rect = renderer.rectOf('wall');

		expect(rect).toMatchObject({width: box.width, height: box.height});
		expect(mount).toBeTruthy();
	});

	it('carries the full-bleed rules in the stylesheet as well', () => {
		expect(RENDER_DOM_CSS).toContain(".sliders-entity[data-fit='cover'] > img");
		expect(RENDER_DOM_CSS).toContain(".sliders-entity[data-fit='contain'] > img");
	});
});

describe('z with planes in it', () => {
	it('interleaves planes and sprites in one space', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'neon', fit: 'cover', z: -2}),
				entity({id: 'wall', fit: 'cover', z: 1}),
				// Derived z for a character standing at y = -0.3 lands in 0..1, so she is
				// in front of the gif and behind the wall cutout.
				entity({id: 'mira', kind: 'cast', at: {x: -0.3, y: -0.3}})
			]),
			[]
		);

		expect(drawOrder(mount)).toEqual(['neon', 'mira', 'wall']);
	});

	it('sinks a plane with no z of its own behind the derived range', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				// Declared FIRST and standing where a sprite's derived z would be highest:
				// only the seed can put it behind her.
				entity({id: 'sky', fit: 'cover'}),
				entity({id: 'mira', kind: 'cast', at: {x: 0, y: -1}})
			]),
			[]
		);

		expect(drawOrder(mount)).toEqual(['sky', 'mira']);
		expect(FIT_Z).toBeLessThan(0);
	});

	// A hand-built stage does not go through the parser, so the seed has to exist in the
	// renderer too — this is the case where the two could drift.
	it('uses the same seed the parser writes, without one in the stage', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'plane', fit: 'cover'}),
				entity({id: 'seeded', z: FIT_Z}),
				entity({id: 'behind', z: FIT_Z - 1})
			]),
			[]
		);

		// Tied at FIT_Z, so author order breaks it — the same rule everything else uses.
		expect(drawOrder(mount)).toEqual(['behind', 'plane', 'seeded']);
	});
});
