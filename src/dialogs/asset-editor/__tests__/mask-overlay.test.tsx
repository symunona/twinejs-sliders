import {AssetMask, MaskShape} from '@sliders/scene-types';
import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {MaskOverlay, MaskOverlayProps} from '../mask-overlay';

/**
 * The art's rect, in client pixels, and the source image's size at once: the two are the
 * same numbers here so that a click at (100, 20) reads as the fraction it obviously is.
 *
 * jsdom lays nothing out -- every rect is 0x0 and every `offsetParent` is null -- so
 * `useArtRect` and the overlay's own pointer maths both have nothing to divide by. One
 * stub on `Element.prototype` feeds both.
 */
const WIDTH = 300;
const HEIGHT = 200;
const BOX = {
	bottom: HEIGHT,
	height: HEIGHT,
	left: 0,
	right: WIDTH,
	toJSON: () => ({}),
	top: 0,
	width: WIDTH,
	x: 0,
	y: 0
} as DOMRect;

/** A right triangle, already rounded. Its first vertex sits at (30, 20) in client px. */
const TRIANGLE: MaskShape = {
	feather: 0,
	id: 'shape-1',
	op: 'cut',
	points: [
		{x: 0.1, y: 0.1},
		{x: 0.5, y: 0.1},
		{x: 0.5, y: 0.5}
	]
};

const OTHER: MaskShape = {...TRIANGLE, id: 'shape-2', op: 'keep'};

describe('<MaskOverlay>', () => {
	beforeEach(() => {
		// `resetMocks` clears this between tests, so it is re-made rather than restored.
		jest
			.spyOn(Element.prototype, 'getBoundingClientRect')
			.mockReturnValue(BOX);
	});

	afterEach(() => jest.restoreAllMocks());

	/**
	 * The overlay needs two refs it does not own, so it is always rendered inside
	 * something: a positioned container with the art in it, exactly as the stage does.
	 */
	function renderOverlay(props?: Partial<MaskOverlayProps>) {
		const Host: React.FC = () => {
			const art = React.useRef<HTMLCanvasElement>(null);
			const container = React.useRef<HTMLDivElement>(null);

			return (
				<div ref={container} style={{position: 'relative'}}>
					<canvas ref={art} />
					<MaskOverlay
						art={art}
						container={container}
						feather={0}
						height={HEIGHT}
						mask={{shapes: []}}
						mode="paint"
						onChange={jest.fn()}
						onSelect={jest.fn()}
						op="cut"
						tool="polygon"
						width={WIDTH}
						{...props}
					/>
				</div>
			);
		};

		return render(<Host />);
	}

	function overlay() {
		return screen.getByTestId('mask-overlay');
	}

	function click(x: number, y: number) {
		fireEvent.click(overlay(), {button: 0, clientX: x, clientY: y});
	}

	it('measures itself against the art rather than the container', () => {
		renderOverlay();
		expect(overlay()).toHaveStyle({height: '200px', left: '0px', width: '300px'});
		expect(overlay()).toHaveAttribute('viewBox', `0 0 ${WIDTH} ${HEIGHT}`);
	});

	// The three clicks land on thirds, which do not survive three decimals untouched --
	// so this also says the points went through `roundPoint` on the way out.

	it('turns three polygon clicks and a close into one rounded shape', () => {
		const onChange = jest.fn();
		const onSelect = jest.fn();

		renderOverlay({onChange, onSelect});
		click(100, 20);
		click(200, 20);
		click(200, 100);
		expect(screen.getByTestId('mask-draft')).toBeInTheDocument();
		expect(onChange).not.toHaveBeenCalled();

		fireEvent.keyDown(window, {key: 'Enter'});

		expect(onChange).toHaveBeenCalledTimes(1);

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes).toHaveLength(1);
		expect(next.shapes[0].points).toEqual([
			{x: 0.333, y: 0.1},
			{x: 0.667, y: 0.1},
			{x: 0.667, y: 0.5}
		]);
		expect(next.shapes[0].op).toBe('cut');
		expect(next.shapes[0].feather).toBe(0);
		// Picked up straight away, so the pane's op and feather edit what was just drawn.
		expect(onSelect).toHaveBeenCalledWith(next.shapes[0].id);
		expect(screen.queryByTestId('mask-draft')).not.toBeInTheDocument();
	});

	it('starts a shape with the op and feather it was handed', () => {
		const onChange = jest.fn();

		renderOverlay({feather: 0.04, onChange, op: 'keep'});
		click(100, 20);
		click(200, 20);
		click(200, 100);
		fireEvent.keyDown(window, {key: 'Enter'});

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes[0]).toMatchObject({feather: 0.04, op: 'keep'});
	});

	it('closes a polygon on a click back at its first vertex', () => {
		const onChange = jest.fn();

		renderOverlay({onChange});
		click(100, 20);
		click(200, 20);
		click(200, 100);
		click(100, 20);

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(onChange).toHaveBeenCalledTimes(1);
		// The closing click is the close, not a fourth point.
		expect(next.shapes[0].points).toHaveLength(3);
	});

	/*
	A double click has already added its second click as a point before `dblclick` fires.
	The close has to take that one back, or every double-closed polygon carries a stray
	vertex a pixel from the one before it.
	*/

	it('closes a polygon on a double click, without its stray point', () => {
		const onChange = jest.fn();

		renderOverlay({onChange});
		click(100, 20);
		click(200, 20);
		click(200, 100);
		click(201, 100);
		fireEvent.doubleClick(overlay(), {button: 0, clientX: 201, clientY: 100});

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(onChange).toHaveBeenCalledTimes(1);
		expect(next.shapes[0].points).toHaveLength(3);
		expect(next.shapes[0].points[2]).toEqual({x: 0.667, y: 0.5});
	});

	it('throws away a polygon on Escape', () => {
		const onChange = jest.fn();

		renderOverlay({onChange});
		click(100, 20);
		click(200, 20);
		click(200, 100);
		fireEvent.keyDown(window, {key: 'Escape'});

		expect(screen.queryByTestId('mask-draft')).not.toBeInTheDocument();

		// Nothing left to close, so the key that would have closed it does nothing either.
		fireEvent.keyDown(window, {key: 'Enter'});
		expect(onChange).not.toHaveBeenCalled();
	});

	it('does not write a shape that has no inside', () => {
		const onChange = jest.fn();

		renderOverlay({onChange});
		click(100, 20);
		click(200, 20);
		fireEvent.keyDown(window, {key: 'Enter'});
		expect(onChange).not.toHaveBeenCalled();
	});

	it('records a freehand stroke and closes it on release', () => {
		const onChange = jest.fn();

		renderOverlay({onChange, tool: 'freehand'});

		const svg = overlay();

		fireEvent.pointerDown(svg, {button: 0, clientX: 30, clientY: 20});
		fireEvent.pointerMove(svg, {clientX: 260, clientY: 20});
		fireEvent.pointerMove(svg, {clientX: 260, clientY: 170});
		fireEvent.pointerMove(svg, {clientX: 30, clientY: 170});
		fireEvent.pointerUp(svg, {});

		expect(onChange).toHaveBeenCalledTimes(1);

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes).toHaveLength(1);
		expect(next.shapes[0].points.length).toBeGreaterThanOrEqual(3);
	});

	it('draws every finished shape but handles only on the picked one', () => {
		renderOverlay({mask: {shapes: [TRIANGLE, OTHER]}, selected: OTHER.id});

		const drawn = screen.getAllByTestId('mask-shape');

		expect(drawn).toHaveLength(2);
		expect(drawn[0]).toHaveAttribute('data-op', 'cut');
		expect(drawn[1]).toHaveAttribute('data-op', 'keep');
		expect(screen.getAllByTestId('mask-vertex')).toHaveLength(
			OTHER.points.length
		);
	});

	it('picks a shape up and puts it down again with the edit tool', () => {
		const onSelect = jest.fn();

		renderOverlay({mask: {shapes: [TRIANGLE]}, onSelect, tool: 'edit'});
		// Well inside the triangle, and far from every one of its vertices.
		fireEvent.pointerDown(overlay(), {button: 0, clientX: 90, clientY: 40});
		expect(onSelect).toHaveBeenCalledWith(TRIANGLE.id);

		onSelect.mockClear();
		// Well outside it.
		fireEvent.pointerDown(overlay(), {button: 0, clientX: 280, clientY: 190});
		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	it('moves the vertex a drag started on', () => {
		const onChange = jest.fn();

		renderOverlay({
			mask: {shapes: [TRIANGLE]},
			onChange,
			selected: TRIANGLE.id,
			tool: 'edit'
		});

		const svg = overlay();

		// The first vertex, at 0.1 of 300 by 0.1 of 200.
		fireEvent.pointerDown(svg, {button: 0, clientX: 30, clientY: 20});
		fireEvent.pointerMove(svg, {clientX: 60, clientY: 20});

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes[0].points).toEqual([
			{x: 0.2, y: 0.1},
			TRIANGLE.points[1],
			TRIANGLE.points[2]
		]);

		fireEvent.pointerUp(svg, {});
		onChange.mockClear();
		// The drag is over; a stray move is not a move of anything.
		fireEvent.pointerMove(svg, {clientX: 120, clientY: 20});
		expect(onChange).not.toHaveBeenCalled();
	});

	it('deletes the picked shape on Delete', () => {
		const onChange = jest.fn();
		const onSelect = jest.fn();

		renderOverlay({
			mask: {shapes: [TRIANGLE, OTHER]},
			onChange,
			onSelect,
			selected: TRIANGLE.id,
			tool: 'edit'
		});
		fireEvent.keyDown(window, {key: 'Delete'});

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes).toEqual([OTHER]);
		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	/*
	The overlay shares the stage with the crop drag and the one-shot anchor pick. A live
	sheet over the art eats both, so the rendered preview must not have one at all -- not
	a transparent one, not a keyboard listener.
	*/

	it('is not there at all in the rendered preview', () => {
		const onChange = jest.fn();
		const onSelect = jest.fn();

		renderOverlay({
			mask: {shapes: [TRIANGLE]},
			mode: 'rendered',
			onChange,
			onSelect,
			selected: TRIANGLE.id
		});

		expect(screen.queryByTestId('mask-overlay')).not.toBeInTheDocument();
		expect(screen.queryByTestId('mask-shape')).not.toBeInTheDocument();
		fireEvent.keyDown(window, {key: 'Delete'});
		fireEvent.keyDown(window, {key: 'Enter'});
		expect(onChange).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
	});

	it('shows its shapes but takes no gesture while disabled', () => {
		const onChange = jest.fn();
		const onSelect = jest.fn();

		renderOverlay({
			disabled: true,
			mask: {shapes: [TRIANGLE]},
			onChange,
			onSelect
		});

		expect(screen.getByTestId('mask-shape')).toBeInTheDocument();
		expect(overlay()).toHaveStyle({pointerEvents: 'none'});
		click(100, 20);
		fireEvent.keyDown(window, {key: 'Enter'});
		expect(onChange).not.toHaveBeenCalled();
		expect(onSelect).not.toHaveBeenCalled();
	});
});
