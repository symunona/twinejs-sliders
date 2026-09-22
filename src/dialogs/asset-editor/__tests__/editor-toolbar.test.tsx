import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {EditorToolbar, EditorToolbarProps} from '../editor-toolbar';

describe('<EditorToolbar>', () => {
	function renderComponent(props?: Partial<EditorToolbarProps>) {
		return render(
			<EditorToolbar
				actions={<button>mock-save</button>}
				dirty={false}
				onSelectTool={jest.fn()}
				tool="adjust"
				{...props}
			/>
		);
	}

	it('shows the save controls it is handed', () => {
		renderComponent();
		expect(screen.getByRole('button', {name: 'mock-save'})).toBeInTheDocument();
	});

	it('says whether there is anything to save', () => {
		const {rerender} = renderComponent();

		expect(screen.getByTestId('asset-editor-dirty')).toHaveTextContent(
			'dialogs.assetEditor.noChanges'
		);
		rerender(
			<EditorToolbar
				actions={null}
				dirty
				onSelectTool={jest.fn()}
				tool="adjust"
			/>
		);
		expect(screen.getByTestId('asset-editor-dirty')).toHaveTextContent(
			'dialogs.assetEditor.unsavedChanges'
		);
	});

	it('marks the current tool as the chosen one', () => {
		renderComponent({tool: 'size'});
		expect(
			screen.getByRole('radio', {name: 'dialogs.assetEditor.toolHint.size'})
		).toBeChecked();
		expect(
			screen.getByRole('radio', {name: 'dialogs.assetEditor.toolHint.adjust'})
		).not.toBeChecked();
	});

	it('reports a tool being chosen', () => {
		const onSelectTool = jest.fn();

		renderComponent({onSelectTool});
		fireEvent.click(
			screen.getByRole('radio', {
				name: 'dialogs.assetEditor.toolHint.background'
			})
		);
		expect(onSelectTool).toHaveBeenCalledWith('background');
	});

	// Detached editing--pixels no asset owns--has nothing the generator could attach,
	// so the button is absent rather than present and broken.

	it('offers Generate only when there is something to attach', () => {
		const onGenerate = jest.fn();

		const {rerender} = renderComponent({onGenerate});
		fireEvent.click(
			screen.getByRole('button', {name: 'dialogs.assetEditor.generateWith'})
		);
		expect(onGenerate).toHaveBeenCalled();

		rerender(
			<EditorToolbar
				actions={null}
				dirty={false}
				onSelectTool={jest.fn()}
				tool="adjust"
			/>
		);
		expect(
			screen.queryByRole('button', {name: 'dialogs.assetEditor.generateWith'})
		).not.toBeInTheDocument();
	});
});
