/**
 * The fitter asks an INTEGER (`scrollHeight`) whether it is under a FRACTION (the box less
 * its padding). When the body's real height lands on or above .5 the integer rounds up
 * past the fraction, every size in the search reads as overflowing, and the type collapses
 * to `FIT_MIN` — a quarter size, in a bubble with room for four times that.
 *
 * Measured on `02 approaching-closeup` beat 3 in the player: a 474.896 x 108.54 bubble with
 * 13.0248px of shape padding leaves 82.49 by arithmetic and a body the browser lays out at
 * 82.5, so `scrollHeight` reported 83 at every size and the line was set at 8.29px in a box
 * that took 19.87px. The beat before it, whose height happened to land on .47, was fine.
 *
 * jsdom lays nothing out, so the body reports the browser's own numbers: its height rounded
 * to an integer while the words fit, the words' own height once they do not.
 */

import {DialogueLayer} from '../dialogue';
import type {MeasuringRenderer} from '../dialogue';

const BOX = {left: 0, top: 0, width: 1600, height: 900};

/** Lines the stub pretends the text wraps to, at any size. */
const LINES = 3;

function setup() {
	const mount = document.createElement('div');

	Object.defineProperty(mount, 'clientWidth', {value: 1600, configurable: true});
	Object.defineProperty(mount, 'clientHeight', {value: 900, configurable: true});
	document.body.appendChild(mount);

	const dialogue = new DialogueLayer();
	const measure: MeasuringRenderer['measure'] = () => ({x: 400, y: 300});

	dialogue.mount(mount, {measure, stageBox: () => BOX});

	return {mount, dialogue};
}

/**
 * What the browser reports for a body of a given arithmetic height, under `height: 100%`.
 *
 * Two roundings, and they are the whole bug. The box is snapped UP to the next 1/64 of a
 * px, the unit layout is kept in, and `scrollHeight` then reports that as an integer. Both
 * of the real numbers come back out of this: the beat that was fine laid out at 65.4656 and
 * reported 65, the beat that collapsed laid out at 82.4904 and reported 83.
 */
function reportedHeight(inner: number): number {
	return Math.round(Math.ceil(inner * 64) / 64);
}

/**
 * A body that behaves like a real one under `height: 100%`: it never reports less than its
 * own box, and its box is what the browser makes of that fractional height.
 */
function stubBody(mount: HTMLElement, innerHeight: number) {
	const body = mount.querySelector('.sliders-bubble-body') as HTMLElement;
	const own = reportedHeight(innerHeight);

	Object.defineProperty(body, 'scrollHeight', {
		configurable: true,
		get: () => Math.max(own, Math.ceil(parseFloat(body.style.fontSize || '0') * LINES))
	});
	Object.defineProperty(body, 'scrollWidth', {configurable: true, get: () => 0});

	return body;
}

afterEach(() => document.body.replaceChildren());

describe('sizing: absolute, inner height lands on a half pixel', () => {
	/**
	 * 0.2 * 900 = 180 tall. The stylesheet's padding is 10px top and bottom, so the inner
	 * box is 160 — an integer, and the case that always worked.
	 */
	it('fills the box when the arithmetic lands on a whole pixel', () => {
		const {mount, dialogue} = setup();
		const style = {sizing: 'absolute' as const, w: 0.25, h: 0.2};

		dialogue.say('mira', 'Three lines of narration.', {style});

		const body = stubBody(mount, 160);

		dialogue.say('mira', 'Three lines of narration.', {style});

		expect(parseFloat(body.style.fontSize) * LINES).toBeGreaterThan(160 - 3);
	});

	/**
	 * 180.49 tall, less the same 20px, is an inner box of 160.49 by arithmetic — which the
	 * browser snaps to 160.5 and reports as 161. Half a pixel of overflow that is not there,
	 * at every size the search tries. The shape of `02 approaching-closeup` beat 3.
	 */
	it('still fills the box when it lands on a half pixel', () => {
		const {mount, dialogue} = setup();
		const h = 180.49 / 900;
		const style = {sizing: 'absolute' as const, w: 0.25, h};

		dialogue.say('mira', 'Three lines of narration.', {style});

		const body = stubBody(mount, 180.49 - 20);

		dialogue.say('mira', 'Three lines of narration.', {style});

		const size = parseFloat(body.style.fontSize);
		const base = BOX.height * 0.055;

		// The tell of the bug: the search bottoming out rather than finding a size.
		expect(size).toBeGreaterThan(base * 0.25 + 0.01);
		expect(size * LINES).toBeGreaterThan(160.49 - 3);
	});

	it('never lets the words overflow by more than the rounding it forgives', () => {
		const {mount, dialogue} = setup();
		const h = 180.49 / 900;
		const style = {sizing: 'absolute' as const, w: 0.25, h};

		dialogue.say('mira', 'Three lines of narration.', {style});

		const body = stubBody(mount, 180.49 - 20);

		dialogue.say('mira', 'Three lines of narration.', {style});

		expect(parseFloat(body.style.fontSize) * LINES).toBeLessThanOrEqual(160.49 + 1);
	});
});
