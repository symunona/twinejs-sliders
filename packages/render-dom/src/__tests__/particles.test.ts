/**
 * The particle simulation (pure) and the renderer hosting an emitter.
 *
 * Pixels are not provable under jest (`.claude/TRAPS.md`): what is pinned is the
 * simulation's numbers and the DOM the renderer builds. The draw is checked in a browser.
 */

import {EMIT_DEFAULTS, type EmitParams, type Stage} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {PARTICLE_STRIDE, ParticleSim, MAX_PARTICLES} from '../particles';
import {createStubResolver} from '../stub-resolver';

const P = (over: Partial<EmitParams> = {}): EmitParams => ({...EMIT_DEFAULTS, ...over});

describe('ParticleSim', () => {
	it('emits rate per second', () => {
		const sim = new ParticleSim(1);

		sim.step(1, P({life: 8, rate: 30}));
		expect(sim.count).toBe(30);
	});

	it('emits a low rate over time instead of never', () => {
		const sim = new ParticleSim(1);
		const params = P({life: 8, rate: 0.5});

		sim.step(1, params);
		expect(sim.count).toBe(0);
		sim.step(1, params);
		expect(sim.count).toBe(1);
	});

	it('lets every particle die once the rate is 0', () => {
		const sim = new ParticleSim(1);

		sim.step(1, P({life: 0.5, rate: 40}));
		expect(sim.count).toBeGreaterThan(0);
		sim.step(2, P({life: 0.5, rate: 0}));
		expect(sim.count).toBe(0);
	});

	it('moves along angle: 0 is up, 90 is right', () => {
		const up = new ParticleSim(3);

		up.step(0.5, P({angle: 0, area: 0, gravity: 0, life: 8, rate: 20, spread: 0}));

		for (let i = 0; i < up.count; i++) {
			expect(up.position(i).y).toBeLessThan(0);
			expect(Math.abs(up.position(i).x)).toBeLessThan(1e-6);
		}

		const right = new ParticleSim(3);

		right.step(0.5, P({angle: 90, area: 0, gravity: 0, life: 8, rate: 20, spread: 0}));
		expect(right.position(0).x).toBeGreaterThan(0);
		expect(Math.abs(right.position(0).y)).toBeLessThan(1e-6);
	});

	it('is seeded: the same seed gives the same field', () => {
		const a = new ParticleSim(7);
		const b = new ParticleSim(7);

		a.step(1, P());
		b.step(1, P());
		expect(a.fill(P(), 100, 0, 0)).toEqual(b.fill(P(), 100, 0, 0));
	});

	it('caps the field', () => {
		const sim = new ParticleSim(1);

		sim.step(10, P({life: 8, rate: 400}));
		expect(sim.count).toBeLessThanOrEqual(MAX_PARTICLES);
		expect(sim.count).toBeGreaterThan(MAX_PARTICLES * 0.95);
	});

	it('packs pixels, premultiplied', () => {
		const sim = new ParticleSim(1);
		const params = P({area: 0, color: '#ff0000', colorEnd: '#ff0000', fade: 0, gravity: 0, rate: 10, speed: 0});

		sim.step(0.5, params);

		const out = sim.fill(params, 200, 50, 60);

		expect(out[0]).toBeCloseTo(50);
		expect(out[1]).toBeCloseTo(60);
		expect(out[2]).toBeGreaterThan(0);
		// red, premultiplied by alpha; green and blue nothing.
		expect(out[4]).toBeCloseTo(out[7]);
		expect(out[5]).toBe(0);
		expect(out.length).toBeGreaterThanOrEqual(sim.count * PARTICLE_STRIDE);
	});
});

describe('DomRenderer with an emitter', () => {
	function makeMount(): HTMLElement {
		const el = document.createElement('div');

		Object.defineProperty(el, 'clientWidth', {configurable: true, value: 1600});
		Object.defineProperty(el, 'clientHeight', {configurable: true, value: 900});
		document.body.appendChild(el);

		return el;
	}

	function stage(emit?: Partial<EmitParams>): Stage {
		return {
			camera: {at: {x: 0, y: 0}, zoom: 1},
			entities: {
				fire: {
					at: {x: 0, y: 0},
					emit,
					flip: false,
					id: 'fire',
					kind: 'prop',
					opacity: 1,
					ref: 'fire',
					scale: 1
				}
			},
			fx: []
		};
	}

	beforeEach(() => {
		document.head.innerHTML = '';
		document.body.innerHTML = '';
	});

	it('draws a canvas over the art, sized by the emitter box', async () => {
		const mount = makeMount();
		const renderer = new DomRenderer();

		await renderer.mount(
			mount,
			createStubResolver({
				assets: {fire: {h: 64, particles: {box: {h: 400, w: 100}, rate: 10}, w: 64}}
			})
		);
		await renderer.apply(stage(), []);

		const box = mount.querySelector<HTMLElement>(".sliders-entity[data-entity-id='fire']")!;
		const art = box.querySelector<HTMLElement>('.sliders-entity-art')!;
		const canvas = art.querySelector('canvas.sliders-particles');

		expect(canvas).not.toBeNull();
		expect(art.dataset.particles).toBe('');
		// The box, not the 64px sprite: 4:1 tall.
		expect(parseFloat(box.style.height) / parseFloat(box.style.width)).toBeCloseTo(4);

		// A scene override keeps the same canvas: the field is not restarted.
		await renderer.apply(stage({rate: 0}), []);
		expect(art.querySelector('canvas.sliders-particles')).toBe(canvas);

		renderer.destroy();
	});

	it('draws no canvas for an ordinary prop', async () => {
		const mount = makeMount();
		const renderer = new DomRenderer();

		await renderer.mount(mount, createStubResolver());
		await renderer.apply(stage(), []);
		expect(mount.querySelector('canvas.sliders-particles')).toBeNull();
		renderer.destroy();
	});
});
