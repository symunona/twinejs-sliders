/**
 * `sizing: absolute` fits the type to the box — to the box the words actually get.
 *
 * jsdom lays nothing out, so the fitter's one measurement (`scrollHeight` of the body) is
 * stubbed as a plain function of the type size: three lines tall, whatever the size. The
 * padding is NOT stubbed — jsdom resolves the injected stylesheet, so `padding: 10px 14px`
 * on `.sliders-bubble` is the real rule the player would apply.
 */

import {DialogueLayer} from '../dialogue';
import type {MeasuringRenderer} from '../dialogue';

const BOX = {left: 0, top: 0, width: 1600, height: 900};

/** Lines the stub pretends the text wraps to. */
const LINES = 3;

function setup(measure: MeasuringRenderer['measure'] = () => ({x: 400, y: 300})) {
	const mount = document.createElement('div');

	Object.defineProperty(mount, 'clientWidth', {value: 1600, configurable: true});
	Object.defineProperty(mount, 'clientHeight', {value: 900, configurable: true});
	document.body.appendChild(mount);

	const dialogue = new DialogueLayer();

	dialogue.mount(mount, {measure, stageBox: () => BOX});

	return {mount, dialogue};
}

/** Make the body report a height that tracks the type size, the way a real one would. */
function stubLines(mount: HTMLElement) {
	const body = mount.querySelector('.sliders-bubble-body') as HTMLElement;

	Object.defineProperty(body, 'scrollHeight', {
		configurable: true,
		get: () => Math.ceil(parseFloat(body.style.fontSize || '0') * LINES)
	});
	Object.defineProperty(body, 'scrollWidth', {configurable: true, get: () => 0});

	return body;
}

afterEach(() => document.body.replaceChildren());

describe('sizing: absolute', () => {
	it('fits the type inside the padding, not inside the whole box', () => {
		const {mount, dialogue} = setup();
		const style = {sizing: 'absolute' as const, w: 0.25, h: 0.2};

		// The bubble exists before the stub can be attached, so say twice: the second call
		// re-measures the same bubble with the stub in place.
		dialogue.say('mira', 'Three lines of narration.', {style});

		const body = stubLines(mount);

		dialogue.say('mira', 'Three lines of narration.', {style});

		// 0.2 * 900 = 180px tall, less the 10px padding top and bottom. Plus the one pixel
		// the fitter forgives, which is there to cover `scrollHeight` rounding — see
		// `FIT_SLACK`.
		const inner = 180 - 20 + 1;

		expect(parseFloat(body.style.fontSize) * LINES).toBeLessThanOrEqual(inner);
	});

	it('still uses as much of that inner box as it can', () => {
		const {mount, dialogue} = setup();
		const style = {sizing: 'absolute' as const, w: 0.25, h: 0.2};

		dialogue.say('mira', 'Three lines of narration.', {style});

		const body = stubLines(mount);

		dialogue.say('mira', 'Three lines of narration.', {style});

		// Within a line of the largest size that fits: the search is not just bottoming out.
		expect(parseFloat(body.style.fontSize) * LINES).toBeGreaterThan(180 - 20 - 3);
	});

	it('states the inset in stage fractions, so it shrinks with the stage', () => {
		const half = {left: 0, top: 0, width: 800, height: 450};
		const mount = document.createElement('div');

		document.body.appendChild(mount);

		const dialogue = new DialogueLayer();

		dialogue.mount(mount, {
			measure: () => ({x: 0, y: 0}),
			stageBox: () => half
		});
		dialogue.say('mira', 'Hello.', {style: {sizing: 'absolute', w: 0.25, h: 0.2}});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		// Half the 900px stage the stylesheet's 10px/14px were drawn for.
		expect(bubble.style.getPropertyValue('--sliders-bubble-pad-y')).toBe('5px');
		expect(bubble.style.getPropertyValue('--sliders-bubble-pad-x')).toBe('7px');
	});
});
