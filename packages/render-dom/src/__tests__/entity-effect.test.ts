/**
 * An asset's effect, drawn by the renderer.
 *
 * jsdom does no layout and composites nothing, so what is pinned here is the DOM the renderer
 * builds and the CSS it writes — the tear itself is the browser's job, and is verified in one
 * (see `docs/sliders/14-asset-effects.md`).
 */

import type {GlitchEffect, Stage, StageEntity} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {GLITCH_DEFAULTS, effectClass} from '../effects';
import {createStubResolver} from '../stub-resolver';

const GLITCH: GlitchEffect = {...GLITCH_DEFAULTS};

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

async function mounted(options?: Parameters<typeof createStubResolver>[0]) {
	const mount = makeMount();
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver(options));

	return {mount, renderer};
}

function boxOf(mount: HTMLElement, id: string): HTMLElement {
	return mount.querySelector(
		`.sliders-entity[data-entity-id='${id}']`
	) as HTMLElement;
}

function fxOf(mount: HTMLElement, id: string): HTMLElement | null {
	return boxOf(mount, id)?.querySelector('.sliders-fx') ?? null;
}

describe('entity effects', () => {
	beforeEach(() => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	it('builds no overlay for an asset with no effect', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		expect(fxOf(mount, 'lamp')).toBeNull();
	});

	it('builds the overlay inside the sprite box, after the image', async () => {
		// Inside, so it inherits the box's position, rotation, mirror and opacity rather than
		// needing a second copy of all four. After the <img>, so the layers blend against the
		// picture instead of hiding under it.
		const {mount, renderer} = await mounted({
			assets: {lamp: {effect: GLITCH}}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);

		const box = boxOf(mount, 'lamp');
		const fx = fxOf(mount, 'lamp')!;

		expect(fx).not.toBeNull();
		expect(fx.parentElement).toBe(box);
		expect(Array.from(box.children).indexOf(fx)).toBeGreaterThan(
			Array.from(box.children).findIndex(child => child.tagName === 'IMG')
		);
		expect(fx.className).toContain(effectClass(GLITCH));
		expect(fx.querySelectorAll('.sliders-fx-layer').length).toBeGreaterThan(0);
	});

	it('injects the shared stylesheet and the channel filters on mount', async () => {
		await mounted();

		expect(document.getElementById('sliders-fx-styles')).not.toBeNull();
		expect(document.getElementById('sliders-fx-chan-a')).not.toBeNull();
	});

	it('points the layers at the same image the sprite is showing', async () => {
		const {mount, renderer} = await mounted({
			assets: {lamp: {effect: GLITCH}}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);

		const img = boxOf(mount, 'lamp').querySelector('img') as HTMLImageElement;

		for (const layer of Array.from(
			fxOf(mount, 'lamp')!.querySelectorAll('img')
		)) {
			expect(layer.getAttribute('src')).toBe(img.getAttribute('src'));
		}
	});

	it('survives a frame swap, which clears the sprite box', async () => {
		// `setContent` calls `replaceChildren()` whenever the asset changes. An overlay left
		// to look after itself would disappear on the first pose change and never come back.
		const {mount, renderer} = await mounted({
			assets: {lamp: {effect: GLITCH}, lantern: {effect: GLITCH}}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		await renderer.apply(stage([entity({id: 'lamp', ref: 'lantern'})]), []);

		expect(fxOf(mount, 'lamp')).not.toBeNull();
		expect(
			fxOf(mount, 'lamp')!.querySelectorAll('.sliders-fx-layer').length
		).toBeGreaterThan(0);
	});

	it('takes the overlay away when the asset stops carrying an effect', async () => {
		const {mount, renderer} = await mounted({
			assets: {lamp: {effect: GLITCH}, plain: {}}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		expect(fxOf(mount, 'lamp')).not.toBeNull();

		await renderer.apply(stage([entity({id: 'lamp', ref: 'plain'})]), []);
		expect(fxOf(mount, 'lamp')).toBeNull();
	});

	it('builds nothing for an effect whose every knob is at zero', async () => {
		const {mount, renderer} = await mounted({
			assets: {
				lamp: {
					effect: {...GLITCH, amount: 0, noise: 0, scanlines: 0, split: 0}
				}
			}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);
		expect(fxOf(mount, 'lamp')).toBeNull();
	});

	it('builds nothing behind a placeholder, which has no pixels to tear', async () => {
		const {mount, renderer} = await mounted({
			assets: {ghost: {effect: GLITCH}},
			missing: ['ghost']
		});

		await renderer.apply(stage([entity({id: 'ghost'})]), []);
		expect(fxOf(mount, 'ghost')).toBeNull();
	});

	it('lets a plane cover, the way its own picture does', async () => {
		const {mount, renderer} = await mounted({
			assets: {sky: {effect: GLITCH}}
		});

		await renderer.apply(
			stage([entity({id: 'sky', fit: 'cover', kind: 'prop'})]),
			[]
		);

		expect(fxOf(mount, 'sky')!.dataset.fxFit).toBe('cover');
	});

	it('copies the sprite registration point onto the layers', async () => {
		const {mount, renderer} = await mounted({
			assets: {lamp: {effect: GLITCH, w: 400, h: 200}}
		});

		await renderer.apply(stage([entity({id: 'lamp'})]), []);

		const img = boxOf(mount, 'lamp').querySelector('img') as HTMLImageElement;
		const layer = fxOf(mount, 'lamp')!.querySelector('img') as HTMLImageElement;

		expect(layer.style.objectPosition).toBe(img.style.objectPosition);
	});
});
