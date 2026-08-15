/**
 * `measure()` is the method that makes a 3D renderer possible later (spec 02), so it gets the
 * arithmetic pinned down here rather than left to the harness.
 *
 * jsdom does no layout, but it does not need to: every number `measure()` returns is derived
 * from the stage box, the manifest and the entity — never from a measured element.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

/** jsdom reports 0 for every box, so the mount's size is declared outright. */
function makeMount(width: number, height: number): HTMLElement {
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

function stage(entities: StageEntity[], patch: Partial<Stage> = {}): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(entities.map(e => [e.id, e])),
		fx: [],
		...patch
	};
}

// mira: 512x1024, origin {0.5, 1}, bubble anchor {0.62, 0.18} (see stub-resolver).
// In a 1600x900 box: height 810, width 405, feet on the scene point.
const SPRITE_W = 405;
const SPRITE_H = 810;

async function mounted(width = 1600, height = 900) {
	const mount = makeMount(width, height);
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

afterEach(() => {
	document.body.replaceChildren();
});

describe('measure', () => {
	it('resolves an anchor against the sprite standing on its scene point', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		const feet = renderer.measure('mira', 'origin');

		expect(feet).toEqual({x: 800, y: 450});

		const bubble = renderer.measure('mira', 'bubble');
		const left = 800 - 0.5 * SPRITE_W;
		const top = 450 - SPRITE_H;

		expect(bubble!.x).toBeCloseTo(left + 0.62 * SPRITE_W, 6);
		expect(bubble!.y).toBeCloseTo(top + 0.18 * SPRITE_H, 6);
	});

	it('tracks x: -0.4 to the left of centre', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: -0.4, y: -1}})]), []);

		expect(renderer.measure('mira', 'origin')!.x).toBeCloseTo(800 - 0.4 * 800, 6);
		// y is UP: -1 is the bottom edge of the box.
		expect(renderer.measure('mira', 'origin')!.y).toBeCloseTo(900, 6);
	});

	it('mirrors the anchor when the entity is flipped', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		const unflipped = renderer.measure('mira', 'bubble')!;

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}, flip: true})]),
			[]
		);

		const flipped = renderer.measure('mira', 'bubble')!;

		// The feet are the origin, so they do not move...
		expect(renderer.measure('mira', 'origin')!.x).toBeCloseTo(800, 6);
		// ...and the bubble anchor lands the same distance the other side of them.
		expect(flipped.x).toBeCloseTo(800 - (unflipped.x - 800), 6);
		expect(flipped.y).toBeCloseTo(unflipped.y, 6);
		expect(flipped.x).not.toBeCloseTo(unflipped.x, 3);
	});

	it('reports positions relative to the mount, including the letterbox bars', async () => {
		// 1600x1000 leaves 50px bars top and bottom.
		const {renderer} = await mounted(1600, 1000);

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		expect(renderer.measure('mira', 'origin')).toEqual({x: 800, y: 500});
	});

	it('applies the camera, so bubbles follow a zoom or a pan', async () => {
		const {renderer} = await mounted();
		const at = {x: 0.5, y: 0};

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0.5, y: 0}})], {
				camera: {at, zoom: 2}
			}),
			[]
		);

		// The entity sits where the camera is looking, so a zoom about the centre leaves it
		// pinned to the centre of the box.
		expect(renderer.measure('mira', 'origin')!.x).toBeCloseTo(800, 6);

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}})], {
				camera: {at: {x: 0, y: 0}, zoom: 2}
			}),
			[]
		);

		const bubble = renderer.measure('mira', 'bubble')!;
		const unzoomedX = 800 - 0.5 * SPRITE_W + 0.62 * SPRITE_W;

		expect(bubble.x).toBeCloseTo(800 + 2 * (unzoomedX - 800), 6);
	});

	it('uses each character\'s own anchors', async () => {
		const {renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'mira', ref: 'mira', at: {x: 0, y: 0}}),
				entity({id: 'joren', ref: 'joren', at: {x: 0, y: 0}})
			]),
			[]
		);

		// joren's manifest puts the bubble anchor at x 0.38, mira's at 0.62.
		expect(renderer.measure('mira', 'bubble')!.x).toBeGreaterThan(800);
		expect(renderer.measure('joren', 'bubble')!.x).toBeLessThan(800);
	});

	it('still measures an entity drawn as a placeholder', async () => {
		const {mount} = await mounted();
		const renderer = new DomRenderer();

		await renderer.mount(mount, createStubResolver({missing: ['ghost']}));
		await renderer.apply(
			stage([entity({id: 'ghost', ref: 'ghost', at: {x: 0, y: 0}})]),
			[]
		);

		// No manifest, so the default anchors stand in — a bubble must never be homeless.
		expect(renderer.measure('ghost', 'bubble')).not.toBeNull();
		expect(renderer.measure('ghost', 'origin')).toEqual({x: 800, y: 450});
	});

	it('returns null for an unknown entity or an unknown anchor', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		expect(renderer.measure('nobody', 'bubble')).toBeNull();
		expect(renderer.measure('mira', 'left-earring')).toBeNull();
	});

	it('follows a resize without being re-applied', async () => {
		const mount = makeMount(1600, 900);
		const renderer = new DomRenderer();

		await renderer.mount(mount, createStubResolver());
		await renderer.apply(stage([entity({id: 'mira', at: {x: 0.5, y: 0}})]), []);

		expect(renderer.measure('mira', 'origin')).toEqual({x: 1200, y: 450});

		Object.defineProperty(mount, 'clientWidth', {value: 800, configurable: true});
		Object.defineProperty(mount, 'clientHeight', {value: 450, configurable: true});
		window.dispatchEvent(new Event('resize'));

		expect(renderer.measure('mira', 'origin')).toEqual({x: 600, y: 225});
	});

	it('follows a scaled entity — the feet stay put, the bubble rides up', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		const bubble = renderer.measure('mira', 'bubble')!;

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}, scale: 2})]),
			[]
		);

		// The origin is the feet, so it does not move however big the sprite gets.
		expect(renderer.measure('mira', 'origin')).toEqual({x: 800, y: 450});

		const scaled = renderer.measure('mira', 'bubble')!;

		// Every anchor is a frame fraction, so it moves twice as far from the origin.
		expect(scaled.x - 800).toBeCloseTo(2 * (bubble.x - 800), 6);
		expect(scaled.y - 450).toBeCloseTo(2 * (bubble.y - 450), 6);
	});

	it('returns null after destroy instead of throwing', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);
		renderer.destroy();

		expect(renderer.measure('mira', 'bubble')).toBeNull();
	});
});

describe('rectOf', () => {
	// mira stands on the scene point with a 0.5/1 origin, so at {0, 0} the rect hangs
	// upward from the centre of a 1600x900 box.
	const NATURAL = {
		left: 800 - SPRITE_W / 2,
		top: 450 - SPRITE_H,
		width: SPRITE_W,
		height: SPRITE_H
	};

	it('reports the sprite rect in MOUNT px under an identity camera', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		expect(renderer.rectOf('mira')).toEqual(NATURAL);
	});

	it('agrees with measure(): the origin anchor lands inside the rect', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: -0.4, y: -0.85}})]), []);

		const rect = renderer.rectOf('mira')!;
		const feet = renderer.measure('mira', 'origin')!;

		expect(rect.left + 0.5 * rect.width).toBeCloseTo(feet.x, 6);
		expect(rect.top + rect.height).toBeCloseTo(feet.y, 6);
	});

	it('includes the letterbox bars', async () => {
		// 1600x1000 leaves 50px bars top and bottom.
		const {renderer} = await mounted(1600, 1000);

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		// The box is still 1600x900, so the sprite keeps its size and only shifts down 50.
		expect(renderer.rectOf('mira')!.top).toBeCloseTo(50 + 450 - SPRITE_H, 6);
		expect(renderer.rectOf('mira')!.height).toBeCloseTo(SPRITE_H, 6);
	});

	it('moves with a pan and does not resize', async () => {
		const {renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}})], {
				camera: {at: {x: 0.5, y: 0}, zoom: 1}
			}),
			[]
		);

		const rect = renderer.rectOf('mira')!;

		expect(rect.left).toBeCloseTo(NATURAL.left - 0.5 * 800, 6);
		expect(rect.width).toBeCloseTo(NATURAL.width, 6);
		expect(rect.height).toBeCloseTo(NATURAL.height, 6);
	});

	it('scales width and height with the camera zoom, not just position', async () => {
		const {renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}})], {
				camera: {at: {x: 0, y: 0}, zoom: 2}
			}),
			[]
		);

		const rect = renderer.rectOf('mira')!;

		// Zoom is about the centre of the box, which is where the feet are.
		expect(rect.width).toBeCloseTo(2 * SPRITE_W, 6);
		expect(rect.height).toBeCloseTo(2 * SPRITE_H, 6);
		expect(rect.left).toBeCloseTo(800 - SPRITE_W, 6);
		expect(rect.top).toBeCloseTo(450 - 2 * SPRITE_H, 6);
	});

	it('grows about the feet for a scaled entity', async () => {
		const {renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: 0, y: 0}, scale: 1.5})]),
			[]
		);

		const rect = renderer.rectOf('mira')!;

		expect(rect.width).toBeCloseTo(1.5 * SPRITE_W, 6);
		expect(rect.height).toBeCloseTo(1.5 * SPRITE_H, 6);
		expect(rect.top + rect.height).toBeCloseTo(450, 6);
		expect(rect.left + rect.width / 2).toBeCloseTo(800, 6);
	});

	it('does not move for a flip — the sprite mirrors inside the same box', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: -0.4, y: 0}})]), []);

		const unflipped = renderer.rectOf('mira');

		await renderer.apply(
			stage([entity({id: 'mira', at: {x: -0.4, y: 0}, flip: true})]),
			[]
		);

		expect(renderer.rectOf('mira')).toEqual(unflipped);
	});

	it('returns null for an unknown id', async () => {
		const {renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		expect(renderer.rectOf('nobody')).toBeNull();
	});
});

describe('reconciliation', () => {
	it('keeps the same element across applies — never remounts', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0, y: 0}})]), []);

		const first = mount.querySelector('[data-entity-id="mira"]');
		const firstImg = first?.querySelector('img');

		await renderer.apply(stage([entity({id: 'mira', at: {x: 0.5, y: 0}})]), []);

		const second = mount.querySelector('[data-entity-id="mira"]');

		expect(second).toBe(first);
		// Same frame, same asset: the <img> must survive or an animated webp would restart.
		expect(second?.querySelector('img')).toBe(firstImg);
	});

	it('creates entrants and removes departures', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([entity({id: 'mira'}), entity({id: 'joren', ref: 'joren'})]),
			[]
		);

		expect(mount.querySelectorAll('.sliders-entity')).toHaveLength(2);

		await renderer.apply(stage([entity({id: 'mira'})]), []);

		expect(mount.querySelectorAll('.sliders-entity')).toHaveLength(1);
		expect(renderer.measure('joren', 'bubble')).toBeNull();
	});

	it('labels a missing asset instead of blanking or throwing', async () => {
		const mount = makeMount(1600, 900);
		const renderer = new DomRenderer();

		await renderer.mount(
			mount,
			createStubResolver({missing: ['a_mira_idle', 'tavern/night']})
		);
		await renderer.apply(
			stage([entity({id: 'mira'})], {bg: 'tavern/night'}),
			[]
		);

		const placeholders = [...mount.querySelectorAll('.sliders-placeholder')];

		expect(placeholders).toHaveLength(2);
		expect(placeholders.map(p => (p as HTMLElement).dataset.assetId).sort()).toEqual([
			'a_mira_idle',
			'tavern/night'
		]);
		expect(placeholders[0].textContent).toContain('tavern/night');
	});

	it('survives a resolver that throws', async () => {
		const mount = makeMount(1600, 900);
		const renderer = new DomRenderer();

		await renderer.mount(mount, {
			url: async () => {
				throw new Error('store offline');
			},
			meta: async () => {
				throw new Error('store offline');
			},
			character: async () => {
				throw new Error('store offline');
			}
		});

		await expect(
			renderer.apply(stage([entity({id: 'mira'})]), [])
		).resolves.toBeUndefined();
		expect(mount.querySelectorAll('.sliders-placeholder')).toHaveLength(1);
	});

	it('exposes the layer and z hooks the stage asked for', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage([
				entity({id: 'far', at: {x: 0, y: 0.5}}),
				entity({id: 'near', at: {x: 0, y: -0.5}}),
				entity({id: 'behind', layer: 'back'})
			]),
			[]
		);

		const el = (id: string) =>
			mount.querySelector(`[data-entity-id="${id}"]`) as HTMLElement;

		expect(el('behind').dataset.layer).toBe('back');
		expect(el('behind').parentElement?.dataset.layer).toBe('back');
		expect(Number(el('near').style.zIndex)).toBeGreaterThan(
			Number(el('far').style.zIndex)
		);
	});
});
