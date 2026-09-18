/**
 * A backdrop's motion reaches the DOM as a data attribute plus a custom property, never as
 * a class or a hand-built animation — which is what lets an unknown token be a story
 * stylesheet's business rather than an error.
 *
 * jsdom runs no animations, so what is pinned here is what the renderer writes and what the
 * stylesheet keys on; the movement itself is the browser's job.
 */

import type {Stage} from '@sliders/scene-types';
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

function stage(over: Partial<Stage> = {}): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: {},
		fx: [],
		...over
	};
}

async function mounted(missing?: string[]) {
	const mount = makeMount();
	const renderer = new DomRenderer();

	// The stub invents art for any id asked of it, so the placeholder path needs ids
	// named as missing outright.
	await renderer.mount(mount, createStubResolver({missing}));

	return {mount, renderer};
}

function bgOf(mount: HTMLElement): HTMLImageElement {
	return mount.querySelector('img.sliders-bg') as HTMLImageElement;
}

function rootOf(mount: HTMLElement): HTMLElement {
	return mount.querySelector('.sliders-root') as HTMLElement;
}

afterEach(() => {
	document.body.innerHTML = '';
});

describe('backdrop motion', () => {
	it('writes the token on the image and on the root', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({bg: 'hall', bgFx: {id: 'parallax_left'}}), []);

		expect(bgOf(mount).dataset.bgFx).toBe('parallax_left');
		// On the root for the same reason `data-music` is: from outside, a running
		// animation on an <img> is otherwise unanswerable.
		expect(rootOf(mount).dataset.bgFx).toBe('parallax_left');
	});

	it('writes speed as a custom property, and leaves it unset without one', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(
			stage({bg: 'hall', bgFx: {id: 'circling', speed: 12}}),
			[]
		);
		expect(bgOf(mount).style.getPropertyValue('--sliders-bg-speed')).toBe('12s');

		await renderer.apply(stage({bg: 'hall', bgFx: {id: 'circling'}}), []);
		expect(bgOf(mount).style.getPropertyValue('--sliders-bg-speed')).toBe('');
	});

	it('takes a token the renderer has no rule for', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({bg: 'hall', bgFx: {id: 'lava_glow'}}), []);

		expect(bgOf(mount).dataset.bgFx).toBe('lava_glow');
	});

	it('drops the attribute when the motion stops', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({bg: 'hall', bgFx: {id: 'earthquake'}}), []);
		await renderer.apply(stage({bg: 'hall'}), []);

		expect(bgOf(mount).dataset.bgFx).toBeUndefined();
		expect(rootOf(mount).dataset.bgFx).toBeUndefined();
	});

	it('follows the backdrop onto a new image', async () => {
		const {mount, renderer} = await mounted();

		await renderer.apply(stage({bg: 'hall'}), []);
		// A swap builds a fresh <img>, which carries no animation of its own: the motion
		// has to be written again, which is why syncBgFx runs after syncBg every time.
		await renderer.apply(stage({bg: 'cellar', bgFx: {id: 'circling'}}), []);

		expect(bgOf(mount).dataset.bgFx).toBe('circling');
	});

	it('keeps ONE backdrop element across cuts, placeholders included', async () => {
		const {mount, renderer} = await mounted([
			'nope-one',
			'nope-two',
			'nope-three'
		]);
		const layer = () =>
			mount.querySelectorAll('.sliders-layer[data-layer=\'bg\'] > *').length;

		// Nothing resolves these, so each is the labelled placeholder — the case that used
		// to append and never remove, so a scene cutting between backdrops ended up with a
		// stack of `? bg` cards.
		await renderer.apply(stage({bg: 'nope-one'}), []);
		await renderer.apply(stage({bg: 'nope-two'}), []);
		await renderer.apply(stage({bg: 'nope-three'}), []);
		expect(layer()).toBe(1);
		expect(mount.textContent).toContain('nope-three');

		await renderer.apply(stage({}), []);
		expect(layer()).toBe(0);
	});

	it('has a rule and a keyframe for every preset it ships', () => {
		for (const id of [
			'parallax_left',
			'parallax_right',
			'parallax_up',
			'parallax_down',
			'earthquake',
			'circling'
		]) {
			expect(RENDER_DOM_CSS).toContain(`[data-bg-fx='${id}']`);
		}

		expect(RENDER_DOM_CSS).toContain('@keyframes sliders-bg-parallax-left');
		expect(RENDER_DOM_CSS).toContain('@keyframes sliders-bg-earthquake');
		expect(RENDER_DOM_CSS).toContain('@keyframes sliders-bg-circling');
		// Each preset names its own default, so `speed:` is genuinely optional.
		expect(RENDER_DOM_CSS).toContain('var(--sliders-bg-speed, 24s)');
		expect(RENDER_DOM_CSS).toContain('prefers-reduced-motion');
	});
});
