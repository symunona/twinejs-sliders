import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {Rect} from '@sliders/render-dom';
import {StageTraceLayer} from '../stage-trace-layer';
import type {EntityTrace, TracePoint} from '../stage-history';

function point(
	kind: TracePoint['kind'],
	x: number,
	y: number,
	scale = 1
): TracePoint {
	const rect: Rect = {height: 400, left: x, top: y, width: 200};

	return {
		at: {x: x / 1000, y: y / 1000},
		kind,
		origin: {x: x + 100, y: y + 400},
		pixel: {x, y},
		rect,
		scale
	};
}

function trace(extra: Partial<EntityTrace> = {}): EntityTrace {
	return {id: 'mira', now: point('now', 500, 300), ...extra};
}

function renderLayer(
	traces: EntityTrace[],
	props: Partial<React.ComponentProps<typeof StageTraceLayer>> = {}
) {
	const onJumpTo = jest.fn();
	const {container} = render(
		<StageTraceLayer
			onJumpTo={onJumpTo}
			selection={['mira']}
			traces={traces}
			{...props}
		/>
	);

	return {container, onJumpTo};
}

describe('<StageTraceLayer>', () => {
	it('outlines an unselected entity but leaves the selection its own box', () => {
		const {container} = renderLayer([trace()], {selection: []});

		expect(container.querySelectorAll('.stage-editor-outline')).toHaveLength(1);

		const selected = renderLayer([trace()]);

		expect(
			selected.container.querySelectorAll('.stage-editor-outline')
		).toHaveLength(0);
	});

	it('draws a ghost per past position', () => {
		renderLayer([
			trace({orig: point('orig', 100, 300), prev: point('prev', 300, 300)})
		]);

		expect(screen.getByTestId('stage-editor-ghost-orig')).toBeInTheDocument();
		expect(screen.getByTestId('stage-editor-ghost-prev')).toBeInTheDocument();
	});

	it('shows no numbers for an entity that has not moved', () => {
		renderLayer([trace()]);

		expect(
			screen.queryByTestId('stage-editor-trace-readout')
		).not.toBeInTheDocument();
	});

	it('shows numbers only for the selected entity', () => {
		renderLayer([trace({orig: point('orig', 100, 300)})], {selection: []});

		expect(
			screen.queryByTestId('stage-editor-trace-readout')
		).not.toBeInTheDocument();
	});

	it('puts the entity back where a clicked row says it was', () => {
		const orig = point('orig', 100, 300, 2);
		const {onJumpTo} = renderLayer([trace({orig})]);

		fireEvent.click(screen.getByTestId('stage-editor-trace-orig'));
		expect(onJumpTo).toHaveBeenCalledWith('mira', orig.at, 2);
	});

	// A locked stage, or a scrubber parked on somebody else's beat: the numbers are still
	// the readout the grid was turned on for, they just cannot be spent.
	it('renders the rows as plain text when there is nowhere to write', () => {
		renderLayer([trace({orig: point('orig', 100, 300)})], {
			onJumpTo: undefined
		});

		expect(screen.getByTestId('stage-editor-trace-readout')).toBeInTheDocument();
		expect(
			screen.queryByTestId('stage-editor-trace-orig')
		).not.toBeInTheDocument();
	});

	// The present is where the entity already is. A button that moves it nowhere is a
	// button that looks broken.
	it('never makes the present row clickable', () => {
		renderLayer([trace({orig: point('orig', 100, 300)})]);

		expect(screen.getAllByRole('button')).toHaveLength(1);
	});

	// React derives enter/leave from the pointerover/pointerout pair, so a dispatched
	// `pointerenter` reaches nothing.
	it('asks the stage for the art while a past row is hovered', () => {
		const onPreview = jest.fn();

		renderLayer([trace({orig: point('orig', 100, 300, 0.5)})], {onPreview});

		const row = screen.getByTestId('stage-editor-trace-orig');

		fireEvent.pointerOver(row);
		expect(onPreview).toHaveBeenLastCalledWith({
			at: {x: 0.1, y: 0.3},
			id: 'mira',
			scale: 0.5
		});

		fireEvent.pointerOut(row);
		expect(onPreview).toHaveBeenLastCalledWith(null);
	});

	it('thickens the ghost the pointer is on, and only that one', () => {
		const {container} = renderLayer([
			trace({orig: point('orig', 100, 300), prev: point('prev', 300, 300)})
		]);

		fireEvent.pointerOver(screen.getByTestId('stage-editor-trace-orig'));

		expect(
			screen.getByTestId('stage-editor-ghost-orig')
		).toHaveClass('hovered');
		expect(
			screen.getByTestId('stage-editor-ghost-prev')
		).not.toHaveClass('hovered');
		expect(container.querySelectorAll('.stage-editor-ghost.hovered')).toHaveLength(
			1
		);
	});

	// A row taken off screen mid-hover never gets its own pointerleave, and the art would
	// stay drawn at a position nothing is pointing at any more.
	it('drops the preview when the panel goes', () => {
		const onPreview = jest.fn();
		const props = {onPreview, selection: ['mira'], traces: [
			trace({orig: point('orig', 100, 300)})
		]};
		const {rerender} = render(<StageTraceLayer onJumpTo={jest.fn()} {...props} />);

		fireEvent.pointerOver(screen.getByTestId('stage-editor-trace-orig'));
		expect(onPreview).toHaveBeenLastCalledWith(
			expect.objectContaining({id: 'mira'})
		);

		rerender(<StageTraceLayer onJumpTo={jest.fn()} {...props} quiet />);
		expect(onPreview).toHaveBeenLastCalledWith(null);
	});

	it('stands down while a gesture is running', () => {
		renderLayer([trace({orig: point('orig', 100, 300)})], {quiet: true});

		expect(
			screen.queryByTestId('stage-editor-trace-readout')
		).not.toBeInTheDocument();
		// The ghosts stay: they are what the drag is being compared against.
		expect(screen.getByTestId('stage-editor-ghost-orig')).toBeInTheDocument();
	});
});
