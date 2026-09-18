/**
 * `frame:` written as a list is a cycle the renderer plays on its own clock.
 *
 * The clock is the point of these tests: a beat's `dur:` is how long the reader looks, a
 * step's `dur` is how fast the legs move, and the two must not be the same timer. Fake
 * timers stand in for the wall clock; what is asserted is the <img> the renderer has
 * pointed at, and the transform it wrote for a step that also moves.
 */

import type {Stage, StageEntity} from '@sliders/scene-types';
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
		at: {x: 0, y: -0.85},
		flip: false,
		opacity: 1,
		scale: 1,
		...patch
	};
}

function stage(...list: StageEntity[]): Stage {
	return {
		camera: {at: {x: 0, y: 0}, zoom: 1},
		entities: Object.fromEntries(list.map(one => [one.id, one])),
		fx: []
	};
}

/** Which asset the sprite is currently pointing at, as the stub names them. */
function shownAsset(mount: HTMLElement, id = 'mira'): string | undefined {
	const img = mount.querySelector<HTMLImageElement>(
		`[data-entity-id="${id}"] img:not(.sliders-ghost)`
	);

	// The stub encodes the asset id into the data URI it invents.
	return img?.src ? decodeURIComponent(img.src).match(/a_\w+/)?.[0] : undefined;
}

function transformOf(mount: HTMLElement, id = 'mira'): string {
	return (
		mount.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)?.style
			.transform ?? ''
	);
}

let mount: HTMLElement;
let renderer: DomRenderer;

beforeEach(() => {
	jest.useFakeTimers();
	mount = makeMount();
	renderer = new DomRenderer();
	renderer.mount(mount, createStubResolver());
});

afterEach(() => {
	renderer.destroy();
	mount.remove();
	jest.useRealTimers();
});

describe('frame cycles', () => {
	it('advances through the steps on its own clock', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					frame: 'idle',
					frames: [
						{name: 'idle', dur: 0.1},
						{name: 'wave', dur: 0.3}
					]
				})
			)
		);

		expect(shownAsset(mount)).toBe('a_mira_idle');

		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		// The second step is held three times as long as the first: at 100ms in it is still
		// on screen, and only the full 300ms brings the cycle round.
		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		jest.advanceTimersByTime(200);
		expect(shownAsset(mount)).toBe('a_mira_idle');
	});

	it('defaults a step with no dur to a tenth of a second', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', frames: [{name: 'idle'}, {name: 'wave'}]}))
		);

		jest.advanceTimersByTime(99);
		expect(shownAsset(mount)).toBe('a_mira_idle');

		jest.advanceTimersByTime(1);
		expect(shownAsset(mount)).toBe('a_mira_wave');
	});

	it('holds the last step under frameLoop: once', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					frameLoop: 'once',
					frames: [{name: 'idle'}, {name: 'wave'}]
				})
			)
		);

		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		jest.advanceTimersByTime(5000);
		expect(shownAsset(mount)).toBe('a_mira_wave');
	});

	it('keeps playing across an apply that did not change the cycle', async () => {
		const cycle = [{name: 'idle'}, {name: 'wave'}];

		await renderer.apply(stage(entity({id: 'mira', frames: cycle})));
		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		// The editor re-applies on every keystroke. A cycle restarted each time would never
		// reach its second step.
		await renderer.apply(
			stage(entity({id: 'mira', at: {x: 0.4, y: -0.85}, frames: cycle}))
		);
		expect(shownAsset(mount)).toBe('a_mira_wave');
	});

	it('restarts when the cycle itself changes', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', frames: [{name: 'idle'}, {name: 'wave'}]}))
		);
		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		await renderer.apply(
			stage(entity({id: 'mira', frames: [{name: 'angry'}, {name: 'wave'}]}))
		);
		expect(shownAsset(mount)).toBe('a_mira_angry');
	});

	it('stops when the entity goes back to a still pose', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', frames: [{name: 'idle'}, {name: 'wave'}]}))
		);
		await renderer.apply(stage(entity({id: 'mira', frame: 'angry'})));

		expect(shownAsset(mount)).toBe('a_mira_angry');

		jest.advanceTimersByTime(5000);
		expect(shownAsset(mount)).toBe('a_mira_angry');
	});

	it('moves the sprite when a step carries an at', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					at: {x: -0.5, y: -0.85},
					frames: [
						{name: 'idle', at: {x: -0.5, y: -0.85}},
						{name: 'wave', at: {x: 0.5, y: -0.85}}
					]
				})
			)
		);

		const first = transformOf(mount);

		jest.advanceTimersByTime(100);

		const second = transformOf(mount);

		expect(shownAsset(mount)).toBe('a_mira_wave');
		expect(second).not.toBe(first);
	});

	it('leaves the entity where the stage put it when no step moves', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					at: {x: 0.25, y: -0.85},
					frames: [{name: 'idle'}, {name: 'wave'}]
				})
			)
		);

		const before = transformOf(mount);

		jest.advanceTimersByTime(100);
		expect(transformOf(mount)).toBe(before);
	});

	it('stops the timer when the entity leaves', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', frames: [{name: 'idle'}, {name: 'wave'}]}))
		);
		await renderer.apply(stage());

		// Nothing left to draw to, so nothing may still be scheduled against it.
		expect(jest.getTimerCount()).toBe(0);
	});
});
