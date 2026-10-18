/**
 * The "waiting for a click" cue: one element over the stage box, shown on the host's say.
 * jsdom runs no CSS, so the animation is the browser's job; the hooks are pinned here.
 */

import {DomRenderer} from '../dom-renderer';
import {createStubResolver} from '../stub-resolver';

function makeMount(width = 1600, height = 1200): HTMLElement {
	const el = document.createElement('div');

	Object.defineProperty(el, 'clientWidth', {value: width, configurable: true});
	Object.defineProperty(el, 'clientHeight', {value: height, configurable: true});
	document.body.appendChild(el);

	return el;
}

async function mounted() {
	const mount = makeMount();
	const renderer = new DomRenderer();

	await renderer.mount(mount, createStubResolver());

	return {mount, renderer};
}

function cue(mount: HTMLElement) {
	return mount.querySelector<HTMLElement>('.sliders-wait-cue');
}

describe('DomRenderer wait cue', () => {
	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('is there but hidden until the host says it waits', async () => {
		const {mount} = await mounted();

		expect(cue(mount)).not.toBeNull();
		expect(cue(mount)!.dataset.shown).toBeUndefined();
		expect(cue(mount)!.querySelector('svg circle')).not.toBeNull();
	});

	it('shows and hides on setWaitingForClick', async () => {
		const {mount, renderer} = await mounted();

		renderer.setWaitingForClick(true);
		expect(cue(mount)!.dataset.shown).toBe('true');
		renderer.setWaitingForClick(false);
		expect(cue(mount)!.dataset.shown).toBeUndefined();
	});

	it('sits over the stage box, not the letterbox', async () => {
		// 1600x1200 letterboxes a 16:9 stage to 1600x900, 150 px down.
		const {mount, renderer} = await mounted();
		const box = renderer.stageBox();

		expect(cue(mount)!.style.top).toBe(`${box.top}px`);
		expect(cue(mount)!.style.height).toBe(`${box.height}px`);
		expect(box.top).toBeGreaterThan(0);
	});

	it('is outside the clipping box, so the dialogue layer cannot bury it', async () => {
		const {mount} = await mounted();

		expect(cue(mount)!.closest('.sliders-stage-box')).toBeNull();
	});

	it('remembers a wait asked for before the mount', async () => {
		const mount = makeMount();
		const renderer = new DomRenderer();

		renderer.setWaitingForClick(true);
		await renderer.mount(mount, createStubResolver());

		expect(cue(mount)!.dataset.shown).toBe('true');
	});
});
