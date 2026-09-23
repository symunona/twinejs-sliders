/**
 * Steps on the renderer's own clock: a scene's `pose:` list, and a pose that owns steps.
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

describe('a scene pose list', () => {
	it('advances through the steps on its own clock', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					pose: 'idle',
					steps: [
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
			stage(entity({id: 'mira', steps: [{name: 'idle'}, {name: 'wave'}]}))
		);

		jest.advanceTimersByTime(99);
		expect(shownAsset(mount)).toBe('a_mira_idle');

		jest.advanceTimersByTime(1);
		expect(shownAsset(mount)).toBe('a_mira_wave');
	});

	it('holds the last step under poseLoop: once', async () => {
		await renderer.apply(
			stage(
				entity({
					id: 'mira',
					poseLoop: 'once',
					steps: [{name: 'idle'}, {name: 'wave'}]
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

		await renderer.apply(stage(entity({id: 'mira', steps: cycle})));
		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		// The editor re-applies on every keystroke. A cycle restarted each time would never
		// reach its second step.
		await renderer.apply(
			stage(entity({id: 'mira', at: {x: 0.4, y: -0.85}, steps: cycle}))
		);
		expect(shownAsset(mount)).toBe('a_mira_wave');
	});

	it('restarts when the cycle itself changes', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', steps: [{name: 'idle'}, {name: 'wave'}]}))
		);
		jest.advanceTimersByTime(100);
		expect(shownAsset(mount)).toBe('a_mira_wave');

		await renderer.apply(
			stage(entity({id: 'mira', steps: [{name: 'angry'}, {name: 'wave'}]}))
		);
		expect(shownAsset(mount)).toBe('a_mira_angry');
	});

	it('stops when the entity goes back to a still pose', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', steps: [{name: 'idle'}, {name: 'wave'}]}))
		);
		await renderer.apply(stage(entity({id: 'mira', pose: 'angry'})));

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
					steps: [
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
					steps: [{name: 'idle'}, {name: 'wave'}]
				})
			)
		);

		const before = transformOf(mount);

		jest.advanceTimersByTime(100);
		expect(transformOf(mount)).toBe(before);
	});

	it('stops the timer when the entity leaves', async () => {
		await renderer.apply(
			stage(entity({id: 'mira', steps: [{name: 'idle'}, {name: 'wave'}]}))
		);
		await renderer.apply(stage());

		// Nothing left to draw to, so nothing may still be scheduled against it.
		expect(jest.getTimerCount()).toBe(0);
	});
});

describe('a pose that owns steps', () => {
	/** Kate: a breathing idle, a wave that plays once, and one still. */
	function kate(): DomRenderer {
		renderer.destroy();
		renderer = new DomRenderer();
		renderer.mount(
			mount,
			createStubResolver({
				characters: {
					kate: {
						poses: {
							idle: {
								steps: [
									{asset: 'a_kate_i1', dur: 0.2},
									{asset: 'a_kate_i2', dur: 0.2}
								]
							},
							wave: {
								loop: false,
								steps: [{asset: 'a_kate_w1'}, {asset: 'a_kate_w2'}]
							},
							crossed: {asset: 'a_kate_x'}
						}
					}
				}
			})
		);

		return renderer;
	}

	it('plays the steps and loops by default', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'idle'})));

		expect(shownAsset(mount, 'kate')).toBe('a_kate_i1');

		jest.advanceTimersByTime(200);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');

		jest.advanceTimersByTime(200);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i1');
	});

	it('plays with no pose named, when the fallback idle has steps', async () => {
		await kate().apply(stage(entity({id: 'kate'})));

		jest.advanceTimersByTime(200);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');
	});

	it('holds the last step under loop: false', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'wave'})));

		jest.advanceTimersByTime(100);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_w2');

		jest.advanceTimersByTime(1000);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_w2');
	});

	it('keeps its place when the same stage is applied again', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'idle'})));
		jest.advanceTimersByTime(200);

		// The editor re-applies on every keystroke; a restart would never reach step 2.
		await renderer.apply(stage(entity({id: 'kate', pose: 'idle'})));
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');
	});

	it('stops when the pose changes to a still', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'idle'})));
		await renderer.apply(stage(entity({id: 'kate', pose: 'crossed'})));

		expect(shownAsset(mount, 'kate')).toBe('a_kate_x');

		jest.advanceTimersByTime(1000);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_x');
	});

	it('shows its first image when a scene list names it as one step', async () => {
		await kate().apply(
			stage(
				entity({
					id: 'kate',
					pose: 'crossed',
					steps: [
						{dur: 0.5, name: 'crossed'},
						{dur: 0.5, name: 'idle'}
					]
				})
			)
		);

		jest.advanceTimersByTime(500);
		// The scene's list owns the clock; the idle's own steps do not run inside it.
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i1');

		jest.advanceTimersByTime(200);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i1');
	});

	it('addresses one image of a stepped pose as name#n, 1-based', async () => {
		await kate().apply(
			stage(
				entity({
					id: 'kate',
					pose: 'idle#2',
					poseLoop: 'all',
					steps: [
						{dur: 0.1, name: 'idle#2'},
						{dur: 0.1, name: 'idle#1'},
						{dur: 0.1, name: 'crossed#1'}
					]
				})
			)
		);

		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');

		jest.advanceTimersByTime(100);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i1');

		jest.advanceTimersByTime(100);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_x');
	});

	it('holds one image named as the pose, rather than playing the pose', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'idle#2'})));

		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');

		jest.advanceTimersByTime(1000);
		expect(shownAsset(mount, 'kate')).toBe('a_kate_i2');
	});

	it('placeholders an image past the end', async () => {
		await kate().apply(stage(entity({id: 'kate', pose: 'idle#9'})));

		expect(
			mount.querySelector('[data-entity-id="kate"] .sliders-placeholder')
		).not.toBeNull();
	});
});
