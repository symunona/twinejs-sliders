/**
 * `sizing: manual` and `tail:` — the two keys a hand-composed bubble is made of.
 *
 * jsdom lays nothing out, so `offsetWidth` is 0 everywhere and the AUTO path cannot be
 * measured here. That is fine: what these keys change is what the layer WRITES — an inline
 * width and height from the author's fractions, a tail aimed at a stage point rather than
 * at the speaker, and the anchor data the scene editor's cross is drawn from.
 */

import {DialogueLayer, tailPoint} from '../dialogue';
import type {MeasuringRenderer} from '../dialogue';

const BOX = {left: 0, top: 0, width: 1600, height: 900};

function setup(measure: MeasuringRenderer['measure'] = () => ({x: 400, y: 300})) {
	const mount = document.createElement('div');

	Object.defineProperty(mount, 'clientWidth', {value: 1600, configurable: true});
	Object.defineProperty(mount, 'clientHeight', {value: 900, configurable: true});
	document.body.appendChild(mount);

	const dialogue = new DialogueLayer();

	dialogue.mount(mount, {measure, stageBox: () => BOX});

	return {mount, dialogue};
}

afterEach(() => document.body.replaceChildren());

describe('tailPoint', () => {
	it('is nothing when the author named no tail', () => {
		expect(tailPoint(undefined, BOX)).toBeUndefined();
		expect(tailPoint({at: {x: 0.5, y: 0.5}}, BOX)).toBeUndefined();
	});

	it('reads the point as fractions of the stage box', () => {
		expect(tailPoint({tail: {x: 0.25, y: 0.5}}, BOX)).toEqual({x: 400, y: 450});
	});

	it('does NOT clamp, so a tail may reach past the frame', () => {
		expect(tailPoint({tail: {x: 1.5, y: -0.5}}, BOX)).toEqual({
			x: 2400,
			y: -450
		});
	});
});

describe('sizing: manual', () => {
	it('states the box in stage fractions, exactly like absolute', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', 'Hello.', {
			style: {sizing: 'manual', w: 0.25, h: 0.2}
		});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.style.width).toBe('400px');
		expect(bubble.style.height).toBe('180px');
		expect(bubble.dataset.sizing).toBe('manual');
	});

	it('leaves the type alone, where absolute fits it to the box', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', 'Hello.', {style: {sizing: 'absolute', w: 0.25, h: 0.2}});

		const body = mount.querySelector('.sliders-bubble-body') as HTMLElement;

		expect(body.style.fontSize).not.toBe('');

		dialogue.say('mira', 'Hello.', {style: {sizing: 'manual', w: 0.25, h: 0.2}});

		expect(
			(mount.querySelector('.sliders-bubble-body') as HTMLElement).style.fontSize
		).toBe('');
	});

	it('falls back to the panel default when a side is missing', () => {
		const {mount, dialogue} = setup();

		dialogue.say('mira', 'Hello.', {style: {sizing: 'manual'}});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.style.width).toBe('800px');
		expect(bubble.style.height).toBe('180px');
	});

	it('gives a narration box a height as well, which auto never does', () => {
		const {mount, dialogue} = setup();

		dialogue.setBox('Later.', {sizing: 'manual', w: 0.5, h: 0.3});

		const box = mount.querySelector('.sliders-box') as HTMLElement;

		expect(box.style.width).toBe('800px');
		expect(box.style.height).toBe('270px');

		dialogue.setBox('Later.', {w: 0.5});

		expect((mount.querySelector('.sliders-box') as HTMLElement).style.height).toBe(
			''
		);
	});
});

describe('tail:', () => {
	it('aims the tail at the stage point instead of at the speaker', () => {
		const {mount, dialogue} = setup(() => ({x: 1500, y: 800}));

		// Pinned top left, speaker bottom right: the tail would lean down-right.
		dialogue.say('mira', 'Over there.', {
			style: {at: {x: 0.2, y: 0.2}, tail: {x: 0.2, y: 0.02}}
		});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		// The named point is ABOVE the bubble, so the bubble is below it.
		expect(bubble.dataset.side).toBe('below');
	});

	it('is ignored by a detached bubble, which grows no tail at all', () => {
		const {mount, dialogue} = setup(() => ({x: 1500, y: 800}));

		dialogue.say('mira', 'Nowhere.', {
			style: {anchor: 'scene', tail: {x: 0.9, y: 0.9}}
		});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.anchored).toBe('false');
		expect(bubble.dataset.anchorX).toBeUndefined();
	});

	it('publishes the anchor from the bubble own top left, for the editor cross', () => {
		const {mount, dialogue} = setup(() => ({x: 1500, y: 800}));

		dialogue.say('mira', 'Here.', {
			style: {at: {x: 0.5, y: 0.5}, sizing: 'manual', w: 0.25, h: 0.2}
		});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		// Centre of a 1600x900 box, box 400x180: top left is (600, 360).
		expect(bubble.dataset.anchorX).toBe('900');
		expect(bubble.dataset.anchorY).toBe('440');
	});

	it('moves the published anchor when tail: names a different point', () => {
		const {mount, dialogue} = setup(() => ({x: 1500, y: 800}));

		dialogue.say('mira', 'Here.', {
			style: {
				at: {x: 0.5, y: 0.5},
				h: 0.2,
				sizing: 'manual',
				tail: {x: 0, y: 0},
				w: 0.25
			}
		});

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.anchorX).toBe('-600');
		expect(bubble.dataset.anchorY).toBe('-360');
	});

	it('clears the anchor when the speaker is not on stage', () => {
		const {mount, dialogue} = setup(() => null);

		dialogue.say('mira', 'Nobody here.');

		const bubble = mount.querySelector('.sliders-bubble') as HTMLElement;

		expect(bubble.dataset.anchorX).toBeUndefined();
	});
});
