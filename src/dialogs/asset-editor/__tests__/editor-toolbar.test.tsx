import {fireEvent, render, screen, within} from '@testing-library/react';
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

	it('offers the mask tool alongside the other three', () => {
		const onSelectTool = jest.fn();

		renderComponent({onSelectTool});
		fireEvent.click(
			screen.getByRole('radio', {name: 'dialogs.assetEditor.toolHint.mask'})
		);
		expect(onSelectTool).toHaveBeenCalledWith('mask');
	});

	/*
	The preview switch. It lives here rather than in the mask pane because the mode
	nobody can do without is `alpha`, and the tool it is wanted in is Background: it is
	how an author judges what the model produced. A toolbar with no image behind it has
	no preview to switch, so the whole group is absent without `onChangeMode`.
	*/

	it('has no preview switch until it is given one to report to', () => {
		renderComponent();
		expect(
			screen.queryByRole('radiogroup', {name: 'dialogs.assetEditor.modeLabel'})
		).not.toBeInTheDocument();
	});

	it('marks the current preview and reports a change of it', () => {
		const onChangeMode = jest.fn();

		renderComponent({mode: 'paint', onChangeMode});

		const modes = within(
			screen.getByRole('radiogroup', {name: 'dialogs.assetEditor.modeLabel'})
		);

		expect(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.paint'})
		).toBeChecked();
		expect(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.rendered'})
		).not.toBeChecked();
		fireEvent.click(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.alpha'})
		);
		expect(onChangeMode).toHaveBeenCalledWith('alpha');
	});

	// Greyed, not hidden: a switch that grows a third button the moment a shape is drawn
	// is a switch nobody ever finds.

	it('greys the previews this image has nothing to show in', () => {
		renderComponent({
			mode: 'rendered',
			modes: ['rendered'],
			onChangeMode: jest.fn()
		});

		const modes = within(
			screen.getByRole('radiogroup', {name: 'dialogs.assetEditor.modeLabel'})
		);

		expect(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.rendered'})
		).toBeEnabled();
		expect(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.alpha'})
		).toBeDisabled();
		expect(
			modes.getByRole('radio', {name: 'dialogs.assetEditor.mode.paint'})
		).toBeDisabled();
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
