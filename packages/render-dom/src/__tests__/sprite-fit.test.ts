/**
 * The sprite box is sized from the character's manifest, not from the frame that happens to
 * be showing. A frame with a different aspect used to be stretched to fill it; it is now box
 * fitted (`object-fit: contain`) and pinned by `object-position` at the entity's origin, so a
 * wider-than-manifest frame ends up shorter but still standing on the floor.
 *
 * jsdom does no layout, so what is pinned here is the CSS the renderer writes — the fit
 * itself is the browser's job.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
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

async function mounted(options?: Parameters<typeof createStubResolver>[0]) {
	const mount = makeMount();
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver(options));

	return {mount, renderer};
}

function imgOf(mount: HTMLElement, id: string): HTMLImageElement {
	const el = mount.querySelector(`.sliders-entity[data-entity-id='${id}'] img`);

	return el as HTMLImageElement;
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('sprite fit', () => {
	it('box fits the frame instead of stretching it', () => {
		expect(RENDER_DOM_CSS).toContain('object-fit: contain;');
		// The one exception is a sprite the author squeezed on purpose (`stretch:`).
		expect(
			RENDER_DOM_CSS.replace(
				/\.sliders-entity\[data-stretch\][^{]*\{\s*object-fit: fill;\s*\}/,
				''
			)
		).not.toContain('object-fit: fill;');
	});

	it('fills the box when the author stretched the sprite', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', stretch: {x: 1.5, y: 1}})]),
			[]
		);

		const el = mount.querySelector<HTMLElement>('[data-entity-id="mira"]')!;

		expect(el.dataset.stretch).toBe('1.5 1');
	});

	it('pins the frame at the entity origin — bottom centre by default', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		expect(imgOf(mount, 'mira').style.objectPosition).toBe('50% 100%');
	});

	it('follows a character whose origin is not its feet', async () => {
		const {mount, renderer} = await mounted({
			characters: {mira: {origin: {x: 0.25, y: 0.5}}}
		});

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		expect(imgOf(mount, 'mira').style.objectPosition).toBe('25% 50%');
	});
});

describe('stretch:, motion: and the zoomed-out view', () => {
	it('stretches the box on one axis and leaves the other alone', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		const plain = renderer.rectOf('mira')!;

		await renderer.apply(
			stage([entity({id: 'mira', stretch: {x: 2, y: 1}})]),
			[]
		);

		const wide = renderer.rectOf('mira')!;

		expect(wide.width).toBeCloseTo(plain.width * 2, 5);
		expect(wide.height).toBeCloseTo(plain.height, 5);
	});

	it('hands motion: to the art as a data attribute and a speed', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', motion: {id: 'parallax_left', speed: 7}})]),
			[]
		);

		const art = mount.querySelector<HTMLElement>(
			"[data-entity-id='mira'] > .sliders-entity-art"
		)!;

		expect(art.dataset.motion).toBe('parallax_left');
		expect(art.style.getPropertyValue('--sliders-motion-speed')).toBe('7s');

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		expect(art.dataset.motion).toBeUndefined();
	});

	it('adds a trailing copy for a scroll, and drops it when the scroll stops', async () => {
		const {mount, renderer} = await mounted();
		const tiles = () =>
			mount.querySelectorAll("[data-entity-id='mira'] > .sliders-entity-art-tile");

		await renderer.apply(
			stage([entity({id: 'mira', motion: {id: 'scroll_infinite_left'}})]),
			[]
		);
		expect(tiles()).toHaveLength(1);

		await renderer.apply(stage([entity({id: 'mira'})]), []);
		expect(tiles()).toHaveLength(0);
	});

	it('draws the stage smaller and stops clipping it when zoomed out', async () => {
		const {mount, renderer} = await mounted();
		const full = renderer.stageBox();

		renderer.setViewScale(0.5);

		const half = renderer.stageBox();

		expect(half.width).toBeCloseTo(full.width / 2, 5);
		expect(half.left + half.width / 2).toBeCloseTo(full.left + full.width / 2, 5);
		expect(
			mount.querySelector<HTMLElement>('.sliders-root')!.dataset.overscan
		).toBe('true');

		renderer.setViewScale(1);

		expect(renderer.stageBox()).toEqual(full);
		expect(
			mount.querySelector<HTMLElement>('.sliders-root')!.dataset.overscan
		).toBeUndefined();
	});
});
