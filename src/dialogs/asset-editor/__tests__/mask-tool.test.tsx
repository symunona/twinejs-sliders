import {AssetMask, MaskShape} from '@sliders/scene-types';
import {fireEvent, render, screen, within} from '@testing-library/react';
import * as React from 'react';
import {FEATHER_RANGE} from '../mask-shapes';
import {MaskTool, MaskToolProps} from '../mask-tool';

/*
i18n is not initialised under jest, so `t()` hands back its own key and every row's
label is the same string. Controls are found structurally -- by role inside the group
that names them, or by the row they sit in -- and asserted on by key.
*/

function shape(id: string, op: MaskShape['op'] = 'cut'): MaskShape {
	return {
		feather: 0,
		id,
		op,
		points: [
			{x: 0.1, y: 0.1},
			{x: 0.5, y: 0.1},
			{x: 0.5, y: 0.5}
		]
	};
}

const THREE: AssetMask = {
	shapes: [shape('shape-1'), shape('shape-2', 'keep'), shape('shape-3')]
};

describe('<MaskTool>', () => {
	function renderTool(props?: Partial<MaskToolProps>) {
		return render(
			<MaskTool
				feather={0}
				mask={{shapes: []}}
				mode="paint"
				onChange={jest.fn()}
				onChangeFeather={jest.fn()}
				onChangeOp={jest.fn()}
				onChangeTool={jest.fn()}
				onSelect={jest.fn()}
				op="cut"
				tool="polygon"
				{...props}
			/>
		);
	}

	function group(key: string) {
		return within(screen.getByRole('radiogroup', {name: key}));
	}

	it('says so when nothing has been drawn', () => {
		renderTool();
		expect(
			screen.getByText('dialogs.assetEditor.maskEmpty')
		).toBeInTheDocument();
		expect(screen.queryAllByTestId('mask-row')).toHaveLength(0);
		expect(
			screen.getByRole('button', {name: 'dialogs.assetEditor.maskClear'})
		).toBeDisabled();
	});

	// The preview switch moved to the toolbar, where `alpha` is also reachable from the
	// background tool. All this pane does with `mode` now is read it.

	it('leaves the preview switch to the toolbar', () => {
		renderTool();
		expect(
			screen.queryByRole('radiogroup', {name: 'dialogs.assetEditor.modeLabel'})
		).not.toBeInTheDocument();
	});

	it('marks the current drawing tool and reports a change of it', () => {
		const onChangeTool = jest.fn();

		renderTool({onChangeTool});

		const tools = group('dialogs.assetEditor.maskToolsLabel');

		expect(
			tools.getByRole('radio', {name: 'dialogs.assetEditor.maskTool.polygon'})
		).toBeChecked();
		fireEvent.click(
			tools.getByRole('radio', {name: 'dialogs.assetEditor.maskTool.freehand'})
		);
		expect(onChangeTool).toHaveBeenCalledWith('freehand');
	});

	// The rendered preview takes no gestures at all, so a drawing tool cannot be armed
	// from under it.

	it('turns the drawing tools off in the rendered preview', () => {
		renderTool({mode: 'rendered'});
		expect(
			group('dialogs.assetEditor.maskToolsLabel').getByRole('radio', {
				name: 'dialogs.assetEditor.maskTool.polygon'
			})
		).toBeDisabled();
	});

	it('lists a row per shape and picks one up on click', () => {
		const onSelect = jest.fn();

		renderTool({mask: THREE, onSelect});

		const rows = screen.getAllByTestId('mask-row');

		expect(rows).toHaveLength(3);
		expect(rows[1]).toHaveAttribute('data-op', 'keep');
		fireEvent.click(within(rows[2]).getAllByRole('button')[0]);
		expect(onSelect).toHaveBeenCalledWith('shape-3');
	});

	it('puts a picked shape down again when its row is clicked', () => {
		const onSelect = jest.fn();

		renderTool({mask: THREE, onSelect, selected: 'shape-2'});
		fireEvent.click(
			within(screen.getAllByTestId('mask-row')[1]).getAllByRole('button')[0]
		);
		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	it('deletes the shape whose row the delete button is in', () => {
		const onChange = jest.fn();

		renderTool({mask: THREE, onChange});
		fireEvent.click(
			within(screen.getAllByTestId('mask-row')[1]).getByRole('button', {
				name: 'dialogs.assetEditor.maskDelete'
			})
		);

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes.map(each => each.id)).toEqual(['shape-1', 'shape-3']);
	});

	it('drops the selection when the shape holding it is deleted', () => {
		const onSelect = jest.fn();

		renderTool({mask: THREE, onSelect, selected: 'shape-2'});
		fireEvent.click(
			within(screen.getAllByTestId('mask-row')[1]).getByRole('button', {
				name: 'dialogs.assetEditor.maskDelete'
			})
		);
		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	it('clears every shape at once', () => {
		const onChange = jest.fn();
		const onSelect = jest.fn();

		renderTool({mask: THREE, onChange, onSelect});
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.assetEditor.maskClear'})
		);
		expect(onChange).toHaveBeenCalledWith({shapes: []});
		expect(onSelect).toHaveBeenCalledWith(undefined);
	});

	/*
	Op and feather are one pair of controls with two meanings. The caption above them is
	the only thing onscreen that says which of the two is in force, so it is asserted on
	as hard as the routing itself.
	*/

	it('names the shape its controls are editing', () => {
		const {rerender} = renderTool({mask: THREE, selected: 'shape-2'});

		expect(screen.getByTestId('mask-scope')).toHaveTextContent(
			'dialogs.assetEditor.maskShapeLabel'
		);

		rerender(
			<MaskTool
				feather={0}
				mask={THREE}
				mode="paint"
				onChange={jest.fn()}
				onChangeFeather={jest.fn()}
				onChangeOp={jest.fn()}
				onChangeTool={jest.fn()}
				onSelect={jest.fn()}
				op="cut"
				tool="polygon"
			/>
		);
		expect(screen.getByTestId('mask-scope')).toHaveTextContent(
			'dialogs.assetEditor.maskDefaults'
		);
	});

	it('routes feather to the picked shape when there is one', () => {
		const onChange = jest.fn();
		const onChangeFeather = jest.fn();
		const value = FEATHER_RANGE.max;
		const {container} = renderTool({
			mask: THREE,
			onChange,
			onChangeFeather,
			selected: 'shape-2'
		});

		fireEvent.change(container.querySelector('input[type="range"]')!, {
			target: {value: String(value)}
		});

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes[1].feather).toBe(value);
		// The other two are untouched, and the default for the NEXT shape is not moved.
		expect(next.shapes[0].feather).toBe(0);
		expect(next.shapes[2].feather).toBe(0);
		expect(onChangeFeather).not.toHaveBeenCalled();
	});

	it('routes feather to the next shape when none is picked', () => {
		const onChange = jest.fn();
		const onChangeFeather = jest.fn();
		const value = FEATHER_RANGE.max;
		const {container} = renderTool({mask: THREE, onChange, onChangeFeather});

		fireEvent.change(container.querySelector('input[type="range"]')!, {
			target: {value: String(value)}
		});
		expect(onChangeFeather).toHaveBeenCalledWith(value);
		expect(onChange).not.toHaveBeenCalled();
	});

	it('shows the picked shape’s feather rather than the default', () => {
		const mask: AssetMask = {
			shapes: [{...shape('shape-1'), feather: FEATHER_RANGE.max}]
		};
		const {container} = renderTool({feather: 0, mask, selected: 'shape-1'});

		expect(container.querySelector('input[type="range"]')).toHaveValue(
			String(FEATHER_RANGE.max)
		);
	});

	it('routes op to the picked shape when there is one', () => {
		const onChange = jest.fn();
		const onChangeOp = jest.fn();

		renderTool({mask: THREE, onChange, onChangeOp, selected: 'shape-1'});
		fireEvent.click(
			group('dialogs.assetEditor.maskShapeLabel').getByRole('radio', {
				name: 'dialogs.assetEditor.maskOp.keep'
			})
		);

		const [next] = onChange.mock.calls[0] as [AssetMask];

		expect(next.shapes[0].op).toBe('keep');
		expect(next.shapes[2].op).toBe('cut');
		expect(onChangeOp).not.toHaveBeenCalled();
	});

	it('routes op to the next shape when none is picked', () => {
		const onChange = jest.fn();
		const onChangeOp = jest.fn();

		renderTool({mask: THREE, onChange, onChangeOp});
		fireEvent.click(
			group('dialogs.assetEditor.maskDefaults').getByRole('radio', {
				name: 'dialogs.assetEditor.maskOp.keep'
			})
		);
		expect(onChangeOp).toHaveBeenCalledWith('keep');
		expect(onChange).not.toHaveBeenCalled();
	});
});
