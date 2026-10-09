import {createEvent, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {EntityId, Stage} from '@sliders/scene-types';
import {autoZWrites, layerRows, reorderWrites} from '../layer-order';
import type {ZResetBlock} from '../layer-order';
import {
	LAYER_DRAG_TYPE,
	LAYERS_PANEL_KEY,
	LayersPanel,
	useLayersPanelOpen
} from '../layers-panel';
import {lockWrites} from '../scene-gestures';
import {parseSceneText} from '../use-scene-parse';
import {EDIT_ORIGIN, Z_ORIGIN} from '../use-scene-writer';

// `lamp` rides on `candle` (`of:`), so it is the one indented row. `joren` is the only
// pinned z; everyone else is auto, ordered by y.
const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: [-0.4, -0.5]}',
	'  joren: {at: 0.3, z: 2, locked: true}',
	'props:',
	'  candle: {ref: props/candle, at: [0.4, 0.2]}',
	'  lamp: {at: [0, 0.1], of: candle}'
].join('\n');

const stage: Stage = parseSceneText(passage).states[0];

interface HarnessProps {
	editable?: boolean;
	initial?: EntityId[];
	onCommit?: jest.Mock;
	onSelect?: jest.Mock;
	resetBlocks?: ReadonlyMap<EntityId, ZResetBlock>;
	/** A pick made on the STAGE: replaces the selection without touching the panel. */
	stagePick?: EntityId[];
	stage?: Stage;
}

/**
 * The panel is controlled, so the harness holds the selection the way `useStageSelection`
 * does — a second click has to see what the first one selected.
 */
function Harness({
	editable = true,
	initial = [],
	onCommit,
	onSelect,
	resetBlocks,
	stage: shown = stage,
	stagePick
}: HarnessProps) {
	const [selection, setSelection] = React.useState<EntityId[]>(initial);
	const [hidden, setHidden] = React.useState<ReadonlySet<EntityId>>(new Set());

	return (
		<>
			{stagePick && (
				<button onClick={() => setSelection(stagePick)} type="button">
					stage pick
				</button>
			)}
			<LayersPanel
				editable={editable}
				hidden={hidden}
				onCommit={onCommit ?? jest.fn()}
				onSelect={ids => {
					onSelect?.(ids);
					setSelection(ids);
				}}
				onToggleHidden={id =>
					setHidden(current => {
						const next = new Set(current);

						return next.delete(id) ? next : next.add(id);
					})
				}
				resetBlocks={resetBlocks}
				selection={selection}
				stage={shown}
			/>
		</>
	);
}

function rowIds(): string[] {
	return screen
		.getAllByRole('option')
		.map(row => row.getAttribute('data-layer-id') ?? '');
}

function row(id: string): HTMLElement {
	const found = document.querySelector<HTMLElement>(`[data-layer-id="${id}"]`);

	if (!found) {
		throw new Error(`no row ${id}`);
	}

	return found;
}

function selectedIds(): string[] {
	return screen
		.getAllByRole('option')
		.filter(option => option.getAttribute('aria-selected') === 'true')
		.map(option => option.getAttribute('data-layer-id') ?? '');
}

function inRow(id: string, testId: string): HTMLButtonElement {
	return row(id).querySelector(
		`[data-testid="${testId}"]`
	) as HTMLButtonElement;
}

/**
 * A drag event at a client y. jsdom has no `DragEvent`, so the init dictionary's `clientY`
 * is dropped on the floor; it has to be put on the event by hand.
 */
function dragAt(
	kind: 'dragOver' | 'drop',
	element: HTMLElement,
	clientY: number,
	types: string[] = [LAYER_DRAG_TYPE]
) {
	const event = createEvent[kind](element, {dataTransfer: {types}});

	Object.defineProperty(event, 'clientY', {value: clientY});
	fireEvent(element, event);
}

describe('<LayersPanel>', () => {
	it('lists every entity front-most first, cast and props mixed', () => {
		render(<Harness />);

		expect(rowIds()).toEqual(layerRows(stage).map(layer => layer.id));
		// The one pinned z is far in front of anything y alone can give.
		expect(rowIds()[0]).toBe('joren');
		expect(rowIds()).toHaveLength(4);
	});

	it('indents a child row and dims a ref that is not the id', () => {
		render(<Harness />);

		expect(row('lamp')).toHaveClass('child');
		expect(row('candle')).not.toHaveClass('child');
		expect(row('candle').querySelector('.layers-panel-ref')?.textContent).toBe(
			'props/candle'
		);
		expect(row('mira').querySelector('.layers-panel-ref')).toBeNull();
	});

	it('reads a pinned z out rounded, not as the raw float', () => {
		const floaty = parseSceneText(
			['[scene]', 'cast:', '  mira: {at: 0, z: 0.1234567}'].join('\n')
		).states[0];

		render(<Harness stage={floaty} />);

		expect(
			row('mira').querySelector('.layers-panel-z-value')?.textContent
		).toBe('0.123');
	});

	it('badges auto rows and offers reset only on pinned ones', () => {
		render(<Harness />);

		expect(inRow('mira', 'layers-panel-auto')).not.toBeNull();
		expect(inRow('mira', 'layers-panel-reset')).toBeNull();
		expect(inRow('joren', 'layers-panel-auto')).toBeNull();
		expect(inRow('joren', 'layers-panel-reset')).not.toBeNull();
	});

	describe('selection', () => {
		it('click selects only that row', () => {
			const onSelect = jest.fn();

			render(<Harness initial={['mira', 'candle']} onSelect={onSelect} />);
			fireEvent.click(row('joren'));

			expect(onSelect).toHaveBeenLastCalledWith(['joren']);
			expect(selectedIds()).toEqual(['joren']);
		});

		it('selects a locked entity — the panel is how one is reached', () => {
			render(<Harness />);
			fireEvent.click(row('joren'));

			expect(selectedIds()).toEqual(['joren']);
		});

		it('ctrl/cmd-click toggles a row in and out', () => {
			const onSelect = jest.fn();

			render(<Harness onSelect={onSelect} />);
			fireEvent.click(row('mira'));
			fireEvent.click(row('candle'), {ctrlKey: true});
			expect(onSelect).toHaveBeenLastCalledWith(['mira', 'candle']);

			fireEvent.click(row('mira'), {metaKey: true});
			expect(onSelect).toHaveBeenLastCalledWith(['candle']);
		});

		it('shift-click takes the range in row order, anchor first', () => {
			const onSelect = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);

			render(<Harness onSelect={onSelect} />);
			fireEvent.click(row(order[0]));
			fireEvent.click(row(order[2]), {shiftKey: true});

			expect(onSelect).toHaveBeenLastCalledWith(order.slice(0, 3));

			// The anchor stays put: a second shift-click regrows from the same row.
			fireEvent.click(row(order[1]), {shiftKey: true});
			expect(onSelect).toHaveBeenLastCalledWith(order.slice(0, 2));
		});

		it('shift-click grows from a sprite picked on the stage', () => {
			const onSelect = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);

			render(<Harness onSelect={onSelect} stagePick={[order[3]]} />);
			// The panel's own anchor is order[0]; then the stage moves the selection away.
			fireEvent.click(row(order[0]));
			fireEvent.click(screen.getByText('stage pick'));
			fireEvent.click(row(order[1]), {shiftKey: true});

			expect(onSelect).toHaveBeenLastCalledWith([order[3], order[1], order[2]]);
		});

		it('lights the rows the stage selected', () => {
			render(<Harness initial={['candle', 'lamp']} />);

			expect(selectedIds().sort()).toEqual(['candle', 'lamp']);
		});

		it('moves focus with the arrow keys', () => {
			render(<Harness />);

			const order = rowIds();

			row(order[0]).focus();
			fireEvent.keyDown(row(order[0]), {key: 'ArrowDown'});
			expect(document.activeElement).toBe(row(order[1]));

			fireEvent.keyDown(row(order[1]), {key: 'ArrowUp'});
			expect(document.activeElement).toBe(row(order[0]));
		});

		it('keeps Left and Right from reaching the stage', () => {
			render(<Harness />);

			const first = rowIds()[0];

			for (const key of ['ArrowLeft', 'ArrowRight']) {
				// `fireEvent` returns false when the event was default-prevented, which is
				// what the stage's nudge and the hotkey dispatcher both check.
				expect(fireEvent.keyDown(row(first), {key})).toBe(false);
				expect(
					fireEvent.keyDown(inRow(first, 'layers-panel-lock'), {key})
				).toBe(false);
			}
		});

		it('treats a focused button as its row for the arrows', () => {
			render(<Harness />);

			const order = rowIds();
			const lock = inRow(order[0], 'layers-panel-lock');

			lock.focus();
			expect(fireEvent.keyDown(lock, {key: 'ArrowDown'})).toBe(false);
			expect(document.activeElement).toBe(row(order[1]));
		});
	});

	describe('writes', () => {
		it('locks one row through the existing lock write, without selecting it', () => {
			const onCommit = jest.fn();
			const onSelect = jest.fn();

			render(<Harness onCommit={onCommit} onSelect={onSelect} />);
			fireEvent.click(inRow('mira', 'layers-panel-lock'));

			expect(onCommit).toHaveBeenCalledWith(
				lockWrites(stage, ['mira']),
				EDIT_ORIGIN
			);
			expect(onSelect).not.toHaveBeenCalled();
		});

		it('resets a pinned row to auto', () => {
			const onCommit = jest.fn();

			render(<Harness onCommit={onCommit} />);
			fireEvent.click(inRow('joren', 'layers-panel-reset'));

			// EDIT: a `+` origin would merge into the last change's undo step.
			expect(onCommit).toHaveBeenCalledWith(
				autoZWrites(stage, ['joren']),
				EDIT_ORIGIN
			);
			expect(onCommit.mock.calls[0][0]).toHaveLength(1);
		});

		it('drags a row to a new slot', () => {
			const onCommit = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);
			const last = order[order.length - 1];

			render(<Harness onCommit={onCommit} />);

			// jsdom lays nothing out, so every row is a zero box at the top: a pointer at -1
			// is above the midpoint and drops into the slot ABOVE the row.
			fireEvent.dragStart(row(last), {dataTransfer: {setData: jest.fn()}});
			dragAt('dragOver', row(order[0]), -1);
			expect(row(order[0])).toHaveClass('drop-above');

			dragAt('drop', row(order[0]), -1);

			expect(onCommit).toHaveBeenCalledWith(
				reorderWrites(stage, [last], 0),
				EDIT_ORIGIN
			);
			expect(onCommit).not.toHaveBeenCalledWith(expect.anything(), Z_ORIGIN);
			expect(row(order[0])).not.toHaveClass('drop-above');
		});

		it('drags the whole selection when the row is in it', () => {
			const onCommit = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);

			render(<Harness initial={[order[3], order[2]]} onCommit={onCommit} />);
			fireEvent.dragStart(row(order[3]), {dataTransfer: {setData: jest.fn()}});
			dragAt('drop', row(order[0]), -1);

			expect(onCommit).toHaveBeenCalledWith(
				reorderWrites(stage, [order[2], order[3]], 0),
				EDIT_ORIGIN
			);
		});

		it('ignores a drag that is not a row, even with a row drag left in the ref', () => {
			const onCommit = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);

			render(<Harness onCommit={onCommit} />);

			// An asset tile, no row drag ever started.
			dragAt('dragOver', row(order[0]), -1, ['application/x-sliders-asset']);
			expect(row(order[0])).not.toHaveClass('drop-above');
			dragAt('drop', row(order[0]), -1, ['application/x-sliders-asset']);

			// A row drag whose `dragend` never came, then a foreign drop.
			fireEvent.dragStart(row(order[3]), {dataTransfer: {setData: jest.fn()}});
			dragAt('drop', row(order[0]), -1, ['Files']);
			// The foreign drop cleared it: a later row-typed drop has nothing to replay.
			dragAt('drop', row(order[0]), -1);

			expect(onCommit).not.toHaveBeenCalled();
		});

		it('forgets the drag on dragend', () => {
			const onCommit = jest.fn();
			const order = layerRows(stage).map(layer => layer.id);

			render(<Harness onCommit={onCommit} />);
			fireEvent.dragStart(row(order[3]), {dataTransfer: {setData: jest.fn()}});
			fireEvent.dragEnd(row(order[3]));
			dragAt('drop', row(order[0]), -1);

			expect(onCommit).not.toHaveBeenCalled();
		});

		it('greys out a reset that would not unpin, and says where to go', () => {
			const onCommit = jest.fn();

			render(
				<Harness
					onCommit={onCommit}
					resetBlocks={new Map([['joren', 'beat']])}
				/>
			);

			const reset = inRow('joren', 'layers-panel-reset');

			expect(reset).toBeDisabled();
			expect(reset).toHaveAttribute(
				'title',
				'dialogs.passageEdit.scenePreview.layers.resetBlockedBeat'
			);
			expect(reset.parentElement).toHaveAttribute(
				'title',
				'dialogs.passageEdit.scenePreview.layers.resetBlockedBeat'
			);
			fireEvent.click(reset);
			expect(onCommit).not.toHaveBeenCalled();
		});

		it('writes nothing read-only, but still selects and hides', () => {
			const onCommit = jest.fn();

			render(<Harness editable={false} onCommit={onCommit} />);

			expect(inRow('mira', 'layers-panel-lock')).toBeDisabled();
			expect(inRow('joren', 'layers-panel-reset')).toBeDisabled();
			expect(row('mira')).toHaveAttribute('draggable', 'false');

			fireEvent.click(row('mira'));
			expect(selectedIds()).toEqual(['mira']);

			fireEvent.click(inRow('mira', 'layers-panel-eye'));
			expect(row('mira')).toHaveClass('hidden');
			expect(onCommit).not.toHaveBeenCalled();
		});
	});

	it('hides in the editor only, and the eye toggles back', () => {
		const onCommit = jest.fn();

		render(<Harness onCommit={onCommit} />);
		fireEvent.click(inRow('candle', 'layers-panel-eye'));
		expect(row('candle')).toHaveClass('hidden');
		expect(inRow('candle', 'layers-panel-eye')).toHaveAttribute(
			'aria-pressed',
			'true'
		);

		fireEvent.click(inRow('candle', 'layers-panel-eye'));
		expect(row('candle')).not.toHaveClass('hidden');
		expect(onCommit).not.toHaveBeenCalled();
	});
});

describe('useLayersPanelOpen', () => {
	function Toggle() {
		const [open, toggle] = useLayersPanelOpen();

		return (
			<>
				<button onClick={toggle} type="button">
					toggle
				</button>
				{open && (
					<LayersPanel
						editable
						hidden={new Set()}
						onCommit={jest.fn()}
						onSelect={jest.fn()}
						onToggleHidden={jest.fn()}
						selection={[]}
						stage={stage}
					/>
				)}
			</>
		);
	}

	beforeEach(() => window.localStorage.removeItem(LAYERS_PANEL_KEY));

	it('starts closed, opens, closes, and remembers', () => {
		const {unmount} = render(<Toggle />);

		expect(screen.queryByTestId('layers-panel')).toBeNull();

		fireEvent.click(screen.getByText('toggle'));
		expect(screen.getByTestId('layers-panel')).toBeInTheDocument();
		unmount();

		// A new preview, same author: still open.
		render(<Toggle />);
		expect(screen.getByTestId('layers-panel')).toBeInTheDocument();

		fireEvent.click(screen.getByText('toggle'));
		expect(screen.queryByTestId('layers-panel')).toBeNull();
		expect(window.localStorage.getItem(LAYERS_PANEL_KEY)).toBe('false');
	});
});
