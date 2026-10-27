/**
 * The measuring grid (`guides`): the editor's lines, in percent of the stage box, riding
 * the camera. jsdom runs no CSS, so what is pinned is the lines and the transform.
 */

import type {Stage} from '@sliders/scene-types';
import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

function makeMount(width = 1600, height = 900): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

function stage(over: Partial<Stage> = {}): Stage {
	return {camera: {at: {x: 0, y: 0}, zoom: 1}, entities: {}, fx: [], ...over};
}

async function mounted(guides?: boolean) {
	const mount = makeMount();
	const renderer = new DomRenderer({guides});

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

function lines(mount: HTMLElement, selector = '') {
	return Array.from(
		mount.querySelectorAll<HTMLElement>(`.sliders-guides .sliders-grid-line${selector}`)
	);
}

describe('DomRenderer grid', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('is off unless asked for, and setGuides flips it', async () => {
		const {mount, renderer} = await mounted();
		const root = mount.querySelector<HTMLElement>('.sliders-root')!;

		expect(root.dataset.guides).toBe('false');
		renderer.setGuides(true);
		expect(root.dataset.guides).toBe('true');
	});

	it('draws sixths, thirds, the centre axes and the floor', async () => {
		const {mount} = await mounted(true);

		expect(lines(mount, '.x')).toHaveLength(13);
		// 13 steps plus the floor.
		expect(lines(mount, '.y')).toHaveLength(14);
		const thirds = lines(mount, '.x[data-kind="third"]');

		expect(thirds).toHaveLength(2);
		expect(parseFloat(thirds[0].style.left)).toBeCloseTo(100 / 3);
		expect(parseFloat(thirds[1].style.left)).toBeCloseTo(200 / 3);
		expect(lines(mount, '[data-kind="centre"]').map(l => l.dataset.scene)).toEqual([
			'0',
			'0'
		]);

		const floor = lines(mount, '[data-kind="baseline"]');

		expect(floor).toHaveLength(1);
		// y = -0.85 is 92.5% down the box.
		expect(parseFloat(floor[0].style.top)).toBeCloseTo(92.5);
	});

	it('follows the camera, with the same transition', async () => {
		const {mount, renderer} = await mounted(true);

		await renderer.apply(stage({camera: {at: {x: 0.2, y: 0}, zoom: 1.5}}), [
			{kind: 'camera', duration: 0.5}
		]);

		const camera = mount.querySelector<HTMLElement>('.sliders-camera')!;
		const grid = mount.querySelector<HTMLElement>('.sliders-guides')!;

		expect(grid.style.transform).not.toBe('');
		expect(grid.style.transform).toBe(camera.style.transform);
		expect(grid.style.transitionDuration).toBe(camera.style.transitionDuration);
		expect(grid.style.transitionTimingFunction).toBe(
			camera.style.transitionTimingFunction
		);
	});
});
