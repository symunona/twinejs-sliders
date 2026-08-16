import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {DomRenderer, Rect} from '@sliders/render-dom';
import type {Stage} from '@sliders/scene-types';
import {ASSET_DRAG_MIME} from '../asset-drag';
import type {AssetDragPayload} from '../asset-drag';
import {parseSceneText} from '../use-scene-parse';
import {hitTargets, StageEditorOverlay} from '../stage-editor-overlay';
import {CAMERA_ORIGIN} from '../use-scene-writer';

/**
 * jsdom has no layout: every `getBoundingClientRect` is zero and there is no
 * ResizeObserver, so the pixel math itself is tested in `stage-geometry.test.ts`. What is
 * testable here is the wiring — which rect wins a click, and what a drag hands back.
 * Because the frame's own rect is all zeros, client coordinates ARE mount coordinates.
 */

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'props:',
	'  candle: {at: 0.4, layer: front}'
].join('\n');

const stage: Stage = parseSceneText(passage).states[0];

const RECTS: Record<string, Rect> = {
	candle: {left: 100, top: 100, width: 40, height: 40},
	mira: {left: 80, top: 60, width: 120, height: 300}
};

function stubRenderer(rects = RECTS) {
	return {
		measure: () => null,
		rectOf: (id: string) => rects[id] ?? null,
		stageBox: () => ({left: 0, top: 0, width: 640, height: 360}),
		subscribe: () => () => {}
	} as unknown as DomRenderer;
}

function pointer(type: string, clientX: number, clientY: number, init = {}) {
	const event = new MouseEvent(type, {
		bubbles: true,
		clientX,
		clientY,
		...init
	});

	Object.defineProperty(event, 'pointerId', {value: 1});

	return event;
}

/** jsdom has no DataTransfer, and only the two members the overlay reads are needed. */
function dropData(payload: AssetDragPayload) {
	return {
		getData: (type: string) =>
			type === ASSET_DRAG_MIME ? JSON.stringify(payload) : '',
		types: [ASSET_DRAG_MIME]
	};
}

/**
 * jsdom has no `DragEvent` either, so testing-library builds a plain `Event` for a drop and
 * silently loses `clientX`/`clientY`. A `MouseEvent` named `drop` carries both, and React
 * dispatches on the name.
 */
function dragEvent(
	type: string,
	clientX: number,
	clientY: number,
	dataTransfer: unknown
) {
	const event = new MouseEvent(type, {
		bubbles: true,
		cancelable: true,
		clientX,
		clientY
	});

	Object.defineProperty(event, 'dataTransfer', {value: dataTransfer});

	return event;
}

describe('hitTargets()', () => {
	it('ranks layers above z, so a front prop beats a mid character', () => {
		const targets = hitTargets(stage, id => RECTS[id]);

		expect(targets.map(target => target.id)).toEqual(['mira', 'candle']);
		expect(targets[1].zIndex).toBeGreaterThan(targets[0].zIndex);
	});

	it('leaves out entities the renderer has no rect for', () => {
		expect(
			hitTargets(stage, id => (id === 'mira' ? RECTS.mira : null))
		).toHaveLength(1);
	});
});

describe('<StageEditorOverlay>', () => {
	function renderOverlay(
		props: Partial<React.ComponentProps<typeof StageEditorOverlay>> = {}
	) {
		const handlers = {
			onCameraPatch: jest.fn(),
			onCancel: jest.fn(),
			onCommit: jest.fn(),
			onDropAsset: jest.fn(),
			onPatch: jest.fn(),
			onSelect: jest.fn(),
			onToggleFullScreen: jest.fn()
		};

		const element = (
			overrides: Partial<React.ComponentProps<typeof StageEditorOverlay>>
		) => (
			<StageEditorOverlay
				editable
				renderer={stubRenderer()}
				seal={0}
				selection={[]}
				stage={stage}
				{...handlers}
				{...props}
				{...overrides}
			>
				<div data-testid="stage" />
			</StageEditorOverlay>
		);
		const {rerender} = render(element({}));

		return {
			...handlers,
			frame: screen.getByTestId('stage-editor'),
			update: (
				overrides: Partial<React.ComponentProps<typeof StageEditorOverlay>>
			) => rerender(element(overrides))
		};
	}

	it('selects the topmost entity under the pointer', () => {
		const {frame, onSelect} = renderOverlay();

		// Inside both rects; candle is in `front`, so it wins.
		fireEvent(frame, pointer('pointerdown', 120, 120));
		expect(onSelect).toHaveBeenCalledWith(['candle']);
	});

	it('selects the entity when only its rect contains the pointer', () => {
		const {frame, onSelect} = renderOverlay();

		fireEvent(frame, pointer('pointerdown', 90, 300));
		expect(onSelect).toHaveBeenCalledWith(['mira']);
	});

	it('clears the selection on empty stage', () => {
		const {frame, onSelect} = renderOverlay({selection: ['mira']});

		fireEvent(frame, pointer('pointerdown', 500, 20));
		expect(onSelect).toHaveBeenCalledWith([]);
	});

	it('goes full screen on a double click, not a single one', () => {
		const {frame, onToggleFullScreen} = renderOverlay();

		fireEvent(frame, pointer('pointerdown', 500, 20));
		expect(onToggleFullScreen).not.toHaveBeenCalled();

		fireEvent.doubleClick(frame);
		expect(onToggleFullScreen).toHaveBeenCalled();
	});

	it('patches while dragging and commits one write on release', () => {
		const {frame, onCommit, onPatch} = renderOverlay({selection: ['mira']});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 300));

		expect(onPatch).toHaveBeenCalled();

		const patched = onPatch.mock.calls[onPatch.mock.calls.length - 1][0];

		// 60 px right on a 640 px-wide stage box is 0.1875 of a half-width: -0.4 + 0.1875.
		expect(patched.mira.at.x).toBeCloseTo(-0.213, 3);

		expect(onCommit).not.toHaveBeenCalled();

		fireEvent(window, pointer('pointerup', 160, 300));

		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit.mock.calls[0][0]).toEqual([
			{
				id: 'mira',
				key: 'at',
				kind: 'cast',
				ref: 'mira',
				value: {x: -0.213, y: -0.85}
			}
		]);
	});

	/**
	 * `of:` write-back. The stage the overlay is handed is already resolved, so the drag
	 * itself is unchanged — what differs is the number that reaches the text, which has to
	 * be the OFFSET from the parent rather than the absolute position the pointer landed on.
	 */
	it('writes a drag on an of: child as an offset from its parent', () => {
		const {frame, onCommit, onPatch} = renderOverlay({
			parentOffsets: {mira: {x: -0.3, y: 0}},
			selection: ['mira']
		});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 300));

		// Same absolute landing point as the plain drag above (-0.213), minus the parent.
		const patched = onPatch.mock.calls[onPatch.mock.calls.length - 1][0];

		expect(patched.mira.at.x).toBeCloseTo(0.087, 3);

		fireEvent(window, pointer('pointerup', 160, 300));

		expect(onCommit.mock.calls[0][0]).toEqual([
			{
				id: 'mira',
				key: 'at',
				kind: 'cast',
				ref: 'mira',
				value: {x: 0.087, y: -0.85}
			}
		]);
	});

	/**
	 * The snap lines are absolute, and so is the sprite the author is looking at. A child
	 * dropped on the centre line must SIT on the centre line — its offset reading as the
	 * inverse of its parent's position is the correct consequence, not a bug.
	 */
	it('snaps an of: child in absolute space, not in its parent space', () => {
		const {frame, onCommit} = renderOverlay({
			parentOffsets: {mira: {x: -0.3, y: 0}},
			selection: ['mira']
		});

		// 128 px right of -0.4 lands on 0.0 exactly: 128 / 320 = 0.4.
		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 228, 300));
		fireEvent(window, pointer('pointerup', 228, 300));

		expect(onCommit.mock.calls[0][0][0].value).toEqual({x: 0.3, y: -0.85});
	});

	it('leaves a world-space entity alone when other entities have parents', () => {
		const {frame, onCommit} = renderOverlay({
			parentOffsets: {candle: {x: 0.9, y: 0.9}},
			selection: ['mira']
		});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 300));
		fireEvent(window, pointer('pointerup', 160, 300));

		expect(onCommit.mock.calls[0][0][0].value).toEqual({x: -0.213, y: -0.85});
	});

	it('does not write when the pointer barely moved', () => {
		const {frame, onCommit, onPatch} = renderOverlay({selection: ['mira']});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 101, 301));
		fireEvent(window, pointer('pointerup', 101, 301));

		expect(onPatch).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('locks a shift-drag to one axis', () => {
		const {frame, onCommit} = renderOverlay({selection: ['mira']});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 320, {shiftKey: true}));
		fireEvent(window, pointer('pointerup', 160, 320, {shiftKey: true}));

		expect(onCommit.mock.calls[0][0][0].value.y).toBeCloseTo(-0.85);
	});

	it('cancels a live gesture when the document changes underneath it', () => {
		const {frame, onCancel, onCommit, update} = renderOverlay({
			selection: ['mira']
		});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 300));

		update({seal: 1});
		fireEvent(window, pointer('pointerup', 200, 300));

		expect(onCommit).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalled();
	});

	// The anchor is the entity's origin in MOUNT px: `at: -0.4` on a 640x360 box puts
	// mira's feet at (192, 333), which is 8 right and 27 down from the `se` handle.
	it('writes scale when a corner handle is dragged', () => {
		const {onCommit} = renderOverlay({selection: ['mira']});
		const handle = document.querySelector('.stage-editor-handle.se')!;

		fireEvent(handle, pointer('pointerdown', 200, 360));
		fireEvent(window, pointer('pointermove', 216, 414));
		fireEvent(window, pointer('pointerup', 216, 414));

		// Three times as far from the anchor as it started.
		expect(onCommit.mock.calls[0][0]).toEqual([
			{id: 'mira', key: 'scale', kind: 'cast', ref: 'mira', value: 3}
		]);
	});

	it('removes the key instead of writing scale: 1', () => {
		const {onCommit} = renderOverlay({selection: ['mira']});
		const handle = document.querySelector('.stage-editor-handle.se')!;

		// Sideways: far enough to be a drag, but the same distance from the anchor along
		// the direction it started in, so the scale comes back to exactly 1.
		fireEvent(handle, pointer('pointerdown', 200, 360));
		fireEvent(window, pointer('pointermove', 146, 376));
		fireEvent(window, pointer('pointerup', 146, 376));

		expect(onCommit.mock.calls[0][0]).toEqual([
			{id: 'mira', key: 'scale', kind: 'cast', ref: 'mira', value: undefined}
		]);
	});

	it('draws handles only for a single selection', () => {
		renderOverlay({selection: ['mira']});
		expect(document.querySelectorAll('.stage-editor-handle')).toHaveLength(4);
	});

	it('draws no handles for a multi-select', () => {
		renderOverlay({selection: ['mira', 'candle']});
		expect(document.querySelectorAll('.stage-editor-handle')).toHaveLength(0);
	});

	// Pan is a drag on empty ground: no modifier to discover, and the press that starts it
	// is the same one that clears the selection.
	it('pans the camera on a drag over empty stage', () => {
		const {frame, onCameraPatch, onCommit, onSelect} = renderOverlay();

		fireEvent(frame, pointer('pointerdown', 500, 20));
		expect(onSelect).toHaveBeenCalledWith([]);

		fireEvent(window, pointer('pointermove', 564, 20));
		fireEvent(window, pointer('pointerup', 564, 20));

		// 64 px right on a 640 px box is 0.2 of a half width; the camera moves the other way.
		expect(onCameraPatch).toHaveBeenCalled();
		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit.mock.calls[0][0]).toEqual([
			{formatted: '{at: [-0.2, 0]}', sceneKey: 'camera'}
		]);
		expect(onCommit.mock.calls[0][1]).toBe(CAMERA_ORIGIN);
	});

	it('does not pan on a click that never moved', () => {
		const {frame, onCameraPatch, onCommit} = renderOverlay();

		fireEvent(frame, pointer('pointerdown', 500, 20));
		fireEvent(window, pointer('pointerup', 501, 20));

		expect(onCameraPatch).not.toHaveBeenCalled();
		expect(onCommit).not.toHaveBeenCalled();
	});

	it('drags the sprite, not the camera, when the press lands on one', () => {
		const {frame, onCameraPatch} = renderOverlay({selection: ['mira']});

		fireEvent(frame, pointer('pointerdown', 100, 300));
		fireEvent(window, pointer('pointermove', 160, 300));
		fireEvent(window, pointer('pointerup', 160, 300));

		expect(onCameraPatch).not.toHaveBeenCalled();
	});

	it('places a dropped asset where it landed, snapped to the floor', () => {
		const {frame, onDropAsset} = renderOverlay();

		fireEvent(
			frame,
			dragEvent('drop', 400, 320, dropData({ref: 'mira', target: 'cast'}))
		);

		expect(onDropAsset).toHaveBeenCalledTimes(1);

		const [payload, at] = onDropAsset.mock.calls[0];

		expect(payload).toEqual({ref: 'mira', target: 'cast'});
		expect(at.x).toBeCloseTo(0.25, 3);
		// 320 px down is scene y -0.778, inside the drop snap radius of the baseline.
		expect(at.y).toBeCloseTo(-0.85, 5);
	});

	it('ignores a drag that is not one of ours', () => {
		const {frame, onDropAsset} = renderOverlay();

		fireEvent(
			frame,
			dragEvent('drop', 400, 320, {getData: () => '', types: ['Files']})
		);

		expect(onDropAsset).not.toHaveBeenCalled();
	});
});
