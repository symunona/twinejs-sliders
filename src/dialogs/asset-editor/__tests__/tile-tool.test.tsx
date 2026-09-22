import type {ImageEdits} from '@sliders/scene-types';
import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {defaultEdits} from '../image-edits';
import {TileTool, TileToolProps} from '../tile-tool';

/*
i18n is not initialised under jest, so `t()` hands back its own key: every label onscreen is
`dialogs.assetEditor.…`. The slider is reached through its row rather than by accessible
name, the same way `effect-tool.test.tsx` does -- `AdjustSlider` is not `editable` here, so
the `<label>` wraps the range and the value readout together.
*/

function edits(changes: Partial<ImageEdits> = {}): ImageEdits {
	return {...defaultEdits(800, 600), ...changes};
}

function renderTool(props?: Partial<TileToolProps>) {
	const onChange = jest.fn();
	const onChangeAxis = jest.fn();
	const result = render(
		<TileTool
			edits={edits()}
			onChange={onChange}
			onChangeAxis={onChangeAxis}
			{...props}
		/>
	);

	return {...result, onChange, onChangeAxis};
}

/*
The axis buttons carry a visible label AND a tooltip, and `IconButton` gives a non-`iconOnly`
button its `tooltipLabel` as the accessible name -- the tooltip is aria-hidden, so the hint
has to reach a screen reader from the button itself. So they are looked up by hint key, the
same way `effect-tool.test.tsx` does.
*/
function axis(id: 'x' | 'y') {
	return screen.getByRole('radio', {
		name: `dialogs.assetEditor.tileAxisHint.${id}`
	});
}

function overlap(): HTMLInputElement {
	const row = screen
		.getByText('dialogs.assetEditor.tileOverlap')
		.closest('.adjust-slider');

	return row!.querySelector('input[type="range"]') as HTMLInputElement;
}

describe('<TileTool>', () => {
	it('shows the size the picture will actually be saved at', () => {
		renderTool({edits: edits({tile: 0.25})});
		expect(screen.getByText('600×600')).toBeInTheDocument();
	});

	it('shows the untouched size when nothing overlaps', () => {
		renderTool();
		expect(screen.getByText('800×600')).toBeInTheDocument();
	});

	it('starts at no overlap', () => {
		renderTool();
		expect(overlap().value).toBe('0');
	});

	it('restores the overlap it was opened with', () => {
		renderTool({edits: edits({tile: 0.2})});
		expect(overlap().value).toBe('0.2');
	});

	it('reports a dragged overlap as a fraction', () => {
		const {onChange} = renderTool();

		fireEvent.change(overlap(), {target: {value: '0.3'}});
		expect(onChange).toHaveBeenCalledWith(0.3);
	});

	it('says what the overlap costs, in pixels', () => {
		renderTool({edits: edits({tile: 0.25})});
		expect(
			screen.getByText('dialogs.assetEditor.tileCost')
		).toBeInTheDocument();
	});

	it('says plainly when there is no overlap at all', () => {
		renderTool();
		expect(screen.getByText('dialogs.assetEditor.tileOff')).toBeInTheDocument();
	});

	it('offers the loop preview even before a source has loaded', () => {
		// The pane is opened from a toolbar that does not wait for pixels, so it has to
		// render without them rather than throw on the way in.
		renderTool({source: undefined});
		expect(
			screen.getByRole('img', {name: 'dialogs.assetEditor.tileSeam'})
		).toBeInTheDocument();
	});

	it('greys the overlap out while the editor is busy', () => {
		renderTool({disabled: true});
		expect(overlap()).toBeDisabled();
	});

	it('loops sideways until told otherwise', () => {
		renderTool();
		expect(axis('x')).toHaveAttribute('aria-checked', 'true');
		expect(axis('y')).toHaveAttribute('aria-checked', 'false');
	});

	it('shows the axis it was opened with', () => {
		renderTool({edits: edits({tile: 0.25, tileAxis: 'y'})});
		expect(axis('y')).toHaveAttribute('aria-checked', 'true');
	});

	it('reports a change of direction', () => {
		const {onChangeAxis} = renderTool();

		fireEvent.click(axis('y'));
		expect(onChangeAxis).toHaveBeenCalledWith('y');
	});

	it('takes the overlap off the height when it loops downwards', () => {
		renderTool({edits: edits({tile: 0.25, tileAxis: 'y'})});
		expect(screen.getByText('800\u00d7450')).toBeInTheDocument();
	});

	it('greys the direction out while the editor is busy', () => {
		renderTool({disabled: true});
		expect(axis('y')).toBeDisabled();
	});
});
