import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {BubbleGeometry} from '@sliders/scene-edit';
import type {BubbleStyle} from '@sliders/scene-types';
import {BubbleEditor} from '../bubble-editor';

/**
 * jsdom lays nothing out, so every rect the editor measures is stubbed here and the pixel
 * arithmetic itself is what these tests are about: the FRACTIONS a gesture hands back.
 *
 * The bubble element is a stand-in for the renderer's, carrying exactly the data
 * attributes the dialogue layer publishes — `data-sizing`, `data-anchor-mode` and the
 * anchor point from the bubble's own top left. Nothing here renders a real bubble, because
 * the point of reading those attributes is that the editor never has to.
 */

const FRAME = {left: 0, top: 0, width: 800, height: 450};
const STAGE_BOX = {left: 0, top: 50, width: 800, height: 350};
/** Centre (400, 225), so a handle drag's half-extent is easy to read. */
const BUBBLE = {left: 300, top: 175, width: 200, height: 100};

function stubRect(
	el: Element,
	rect: {left: number; top: number; width: number; height: number}
) {
	el.getBoundingClientRect = () =>
		({
			...rect,
			bottom: rect.top + rect.height,
			right: rect.left + rect.width,
			toJSON: () => rect,
			x: rect.left,
			y: rect.top
		} as DOMRect);
}

function pointer(type: string, clientX: number, clientY: number) {
	const event = new MouseEvent(type, {bubbles: true, clientX, clientY});

	Object.defineProperty(event, 'pointerId', {value: 1});

	return event;
}

interface SetupOptions {
	style?: BubbleStyle;
	sizing?: string;
	anchorMode?: string;
	anchor?: {x: number; y: number} | null;
}

function setup(options: SetupOptions = {}) {
	const commits: BubbleGeometry[] = [];
	const drafts: (BubbleStyle | undefined)[] = [];
	const {anchor = {x: 100, y: 180}} = options;

	const view = render(
		<div className="frame">
			<div className="sliders-stage-box" />
			<div
				className="sliders-bubble"
				data-anchor-mode={options.anchorMode}
				data-anchor-x={anchor ? String(anchor.x) : undefined}
				data-anchor-y={anchor ? String(anchor.y) : undefined}
				data-sizing={options.sizing}
			/>
			<BubbleEditor
				beat={0}
				editable
				onCommit={(_beat, geometry) => commits.push(geometry)}
				onDraft={style => drafts.push(style)}
				style={options.style}
			/>
		</div>
	);

	const frame = view.container.querySelector('.frame') as HTMLElement;

	stubRect(frame, FRAME);
	stubRect(frame.querySelector('.sliders-stage-box')!, STAGE_BOX);
	stubRect(frame.querySelector('.sliders-bubble')!, BUBBLE);

	return {commits, drafts, frame, view};
}

/** Let the editor's requestAnimationFrame measuring loop run at least once. */
async function measured() {
	await act(async () => {
		await new Promise(resolve => setTimeout(resolve, 40));
	});
}

/** A whole gesture: press on `el`, move to the point, release there. */
function drag(el: Element, to: {x: number; y: number}, from?: {x: number; y: number}) {
	const start = from ?? {
		x: (el.getBoundingClientRect().left + el.getBoundingClientRect().right) / 2,
		y: (el.getBoundingClientRect().top + el.getBoundingClientRect().bottom) / 2
	};

	fireEvent(el, pointer('pointerdown', start.x, start.y));
	fireEvent(window, pointer('pointermove', to.x, to.y));
	fireEvent(window, pointer('pointerup', to.x, to.y));
}

/**
 * jsdom has no hit testing, and the editor asks for one on every press so a `[[link]]` in
 * the bubble keeps its click. Nothing here renders a link, so the honest answer is none.
 */
beforeAll(() => {
	(document as unknown as {elementsFromPoint: unknown}).elementsFromPoint = () => [];
});

afterEach(() => document.body.replaceChildren());

describe('BubbleEditor', () => {
	it('frames the bubble where the renderer put it', async () => {
		setup();
		await measured();

		const frame = screen.getByTestId('scene-bubble-editor');

		expect(frame.style.left).toBe('300px');
		expect(frame.style.top).toBe('175px');
		expect(frame.style.width).toBe('200px');
		expect(frame.style.height).toBe('100px');
	});

	it('shows no handles until it is selected, then all eight', async () => {
		const {view} = setup();
		await measured();

		expect(view.container.querySelectorAll('[data-handle]')).toHaveLength(0);

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		expect(view.container.querySelectorAll('[data-handle]')).toHaveLength(8);
	});

	it('drops the selection on Escape', async () => {
		const {view} = setup();
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));
		fireEvent.keyDown(window, {key: 'Escape'});

		expect(view.container.querySelectorAll('[data-handle]')).toHaveLength(0);
	});

	it('writes the centre as stage fractions when the body is dragged', async () => {
		const {commits, view} = setup();
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		drag(body, {x: 480, y: 260}, {x: 400, y: 225});

		// Centre moved to (480, 260) in frame px; the box starts 50px down.
		expect(commits).toEqual([{at: {x: 0.6, y: 0.6}}]);
	});

	it('an east handle writes the width alone, growing about the centre', async () => {
		const {commits, view} = setup();
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const east = view.container.querySelector('[data-handle="e"]')!;

		drag(east, {x: 600, y: 225}, {x: 500, y: 225});

		// Half-extent 200 from the centre, so 400 of an 800 wide box.
		expect(commits).toEqual([{w: 0.5}]);
	});

	it('a south handle promotes an auto bubble to manual, keeping its width', async () => {
		const {commits, view} = setup();
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const south = view.container.querySelector('[data-handle="s"]')!;

		drag(south, {x: 400, y: 330}, {x: 400, y: 275});

		// Half-extent 105 from the centre, so 210 of a 350 tall box. Width is the one the
		// bubble already had: 200 of 800.
		expect(commits).toEqual([{h: 0.6, sizing: 'manual', w: 0.25}]);
	});

	it('leaves the sizing alone when the box is already fixed', async () => {
		const {commits, view} = setup({sizing: 'absolute'});
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const south = view.container.querySelector('[data-handle="s"]')!;

		drag(south, {x: 400, y: 330}, {x: 400, y: 275});

		expect(commits).toEqual([{h: 0.6}]);
	});

	it('a corner handle writes both sides', async () => {
		const {commits, view} = setup({sizing: 'manual'});
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const corner = view.container.querySelector('[data-handle="se"]')!;

		drag(corner, {x: 600, y: 330}, {x: 500, y: 275});

		expect(commits).toEqual([{h: 0.6, w: 0.5}]);
	});

	it('offers the anchor cross only while selected, and never when detached', async () => {
		const {view} = setup();
		await measured();

		expect(screen.queryByTestId('scene-bubble-editor-anchor')).toBeNull();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const cross = screen.getByTestId('scene-bubble-editor-anchor');

		// Published from the bubble's top left: (300 + 100, 175 + 180).
		expect(cross.style.left).toBe('400px');
		expect(cross.style.top).toBe('355px');
	});

	it('hides the cross for anchor: scene, which grows no tail', async () => {
		const {view} = setup({anchorMode: 'scene'});
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		expect(screen.queryByTestId('scene-bubble-editor-anchor')).toBeNull();
	});

	it('hides the cross when the tail reaches for nothing', async () => {
		const {view} = setup({anchor: null});
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		expect(screen.queryByTestId('scene-bubble-editor-anchor')).toBeNull();
	});

	it('dragging the cross writes tail:, not at:', async () => {
		const {commits, view} = setup();
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointerup', 400, 225));

		const cross = screen.getByTestId('scene-bubble-editor-anchor');

		drag(cross, {x: 160, y: 190}, {x: 400, y: 355});

		expect(commits).toEqual([{tail: {x: 0.2, y: 0.4}}]);
	});

	it('paints a draft through the renderer while the gesture runs', async () => {
		const {drafts, view} = setup({style: {as: 'comic'}});
		await measured();

		const body = view.container.querySelector('.scene-bubble-editor-body')!;

		fireEvent(body, pointer('pointerdown', 400, 225));
		fireEvent(window, pointer('pointermove', 480, 260));

		expect(drafts[0]).toEqual({as: 'comic', at: {x: 0.6, y: 0.6}});

		fireEvent(window, pointer('pointerup', 480, 260));

		// Cleared on release: the committed text is what paints from then on.
		expect(drafts[drafts.length - 1]).toBeUndefined();
	});
});
