/**
 * A narration box under `sizing: absolute` fits its type to the stated rectangle; under
 * `sizing: manual` it clips instead.
 *
 * jsdom lays nothing out, so the fitter's one measurement (`scrollHeight` of the box's
 * body) is stubbed as a plain function of the type size. The padding is NOT stubbed —
 * jsdom resolves the injected stylesheet, so `padding: 16px 22px` on `.sliders-box` is the
 * real rule the player would apply.
 */

import {DialogueLayer} from '../dialogue';

const BOX = {left: 0, top: 0, width: 1600, height: 900};

/** Lines the stub pretends the text wraps to. */
const LINES = 3;

function setup(stage = BOX) {
	const mount = document.createElement('div');

	Object.defineProperty(mount, 'clientWidth', {
		configurable: true,
		value: stage.width
	});
	Object.defineProperty(mount, 'clientHeight', {
		configurable: true,
		value: stage.height
	});
	document.body.appendChild(mount);

	const dialogue = new DialogueLayer();

	dialogue.mount(mount, {measure: () => ({x: 0, y: 0}), stageBox: () => stage});

	return {mount, dialogue};
}

/** Make the body report a height that tracks the type size, the way a real one would. */
function stubLines(mount: HTMLElement) {
	const body = mount.querySelector('.sliders-box-body') as HTMLElement;

	Object.defineProperty(body, 'scrollHeight', {
		configurable: true,
		get: () => Math.ceil(parseFloat(body.style.fontSize || '0') * LINES)
	});
	Object.defineProperty(body, 'scrollWidth', {
		configurable: true,
		get: () => 0
	});

	return body;
}

afterEach(() => document.body.replaceChildren());

describe('box sizing: absolute', () => {
	const style = {sizing: 'absolute' as const, w: 0.5, h: 0.2};

	// 0.2 * 900 = 180px tall, less the 16px padding top and bottom.
	const inner = 180 - 32;

	it('fits the type inside the padding, not inside the whole bar', () => {
		const {mount, dialogue} = setup();

		// The box exists before the stub can be attached, so say it twice: the second call
		// re-measures the same box with the stub in place.
		dialogue.setBox('Three lines of narration.', style);

		const body = stubLines(mount);

		dialogue.setBox('Three lines of narration.', {...style});

		expect(parseFloat(body.style.fontSize) * LINES).toBeLessThanOrEqual(inner);
	});

	it('still uses as much of that inner box as it can', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('Three lines of narration.', style);

		const body = stubLines(mount);

		dialogue.setBox('Three lines of narration.', {...style});

		// Within a line of the largest size that fits: the search is not bottoming out.
		expect(parseFloat(body.style.fontSize) * LINES).toBeGreaterThan(inner - 3);
	});

	it('re-fits when the stage changes size', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('Three lines of narration.', style);

		const body = stubLines(mount);

		dialogue.setBox('Three lines of narration.', {...style});

		const big = parseFloat(body.style.fontSize);
		const {mount: small, dialogue: halfStage} = setup({
			left: 0,
			top: 0,
			width: 800,
			height: 450
		});

		halfStage.setBox('Three lines of narration.', style);
		stubLines(small);
		halfStage.setBox('Three lines of narration.', {...style});

		expect(
			parseFloat(
				(small.querySelector('.sliders-box-body') as HTMLElement).style.fontSize
			)
		).toBeLessThan(big);
	});

	it('states the inset in stage fractions, so it shrinks with the stage', () => {
		const {mount, dialogue} = setup({left: 0, top: 0, width: 800, height: 450});

		dialogue.setBox('Half a stage.', style);

		const box = mount.querySelector('.sliders-box') as HTMLElement;

		// Half the 900px stage the stylesheet's 16px/22px were drawn for.
		expect(box.style.getPropertyValue('--sliders-box-pad-y')).toBe('8px');
		expect(box.style.getPropertyValue('--sliders-box-pad-x')).toBe('11px');
	});

	it('keeps the words, links included, inside the body', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('The candle gutters. [[wait]]', style);

		const body = mount.querySelector('.sliders-box-body') as HTMLElement;

		expect(body.textContent).toContain('The candle gutters.');
		expect(body.querySelector('a.sliders-link')!.textContent).toBe('wait');
	});
});

describe('box sizing: manual', () => {
	it('leaves the type alone and clips', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('Three lines of narration.', {
			sizing: 'manual',
			w: 0.5,
			h: 0.2
		});

		const box = mount.querySelector('.sliders-box') as HTMLElement;
		const body = mount.querySelector('.sliders-box-body') as HTMLElement;

		expect(body.style.fontSize).toBe('');
		expect(box.style.height).toBe('180px');
		expect(getComputedStyle(box).overflow).toBe('hidden');
	});

	it('still scales its inset with the stage', () => {
		const {mount, dialogue} = setup({left: 0, top: 0, width: 800, height: 450});

		dialogue.setBox('Later.', {sizing: 'manual', w: 0.5, h: 0.3});

		const box = mount.querySelector('.sliders-box') as HTMLElement;

		expect(box.style.getPropertyValue('--sliders-box-pad-y')).toBe('8px');
		expect(box.style.getPropertyValue('--sliders-box-pad-x')).toBe('11px');
	});
});

describe('box sizing: auto', () => {
	it('fits nothing and keeps the flat inset', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('A bar as tall as its words.', {w: 0.5});

		const box = mount.querySelector('.sliders-box') as HTMLElement;
		const body = mount.querySelector('.sliders-box-body') as HTMLElement;

		expect(box.style.height).toBe('');
		expect(body.style.fontSize).toBe('');
		expect(box.style.getPropertyValue('--sliders-box-pad-y')).toBe('');
	});

	it('drops a fitted size when a later beat goes back to auto', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('Three lines of narration.', {
			sizing: 'absolute',
			w: 0.5,
			h: 0.2
		});

		const body = stubLines(mount);

		dialogue.setBox('Three lines of narration.', {
			sizing: 'absolute',
			w: 0.5,
			h: 0.2
		});
		expect(body.style.fontSize).not.toBe('');

		dialogue.setBox('Three lines of narration.', {w: 0.5});
		expect(body.style.fontSize).toBe('');
	});
});
