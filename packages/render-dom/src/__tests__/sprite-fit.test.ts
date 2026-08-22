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
		layer: 'mid',
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
		expect(RENDER_DOM_CSS).not.toContain('object-fit: fill;');
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
