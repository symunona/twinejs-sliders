import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FileChooser, FileChooserProps} from '../file-chooser';

describe('FileChooser', () => {
	function renderComponent(props?: Partial<FileChooserProps>) {
		return render(
			<FileChooser onChange={jest.fn()} onChooseBundle={jest.fn()} {...props} />
		);
	}

	it('displays a file input that accepts HTML and Twee files', () => {
		renderComponent();

		const input = screen.getByLabelText('dialogs.storyImport.filePrompt');

		expect(input).toBeInTheDocument();
		expect(input).toHaveAttribute('accept', '.html,.twee,.tw');
	});

	it('displays a separate input for Sliders bundles', () => {
		renderComponent();

		const input = screen.getByLabelText('dialogs.storyImport.bundleButton');

		expect(input).toHaveAttribute('accept', '.zip');
		// A bundle carries assets, and the asset flow needs the File itself rather than
		// the text FileInput would hand back.
		expect(input).not.toHaveAttribute('multiple');
	});

	it('hands a chosen bundle to onChooseBundle', () => {
		const onChooseBundle = jest.fn();
		const bundle = new File([''], 'story.sliders.zip');

		renderComponent({onChooseBundle});
		fireEvent.change(
			screen.getByLabelText('dialogs.storyImport.bundleButton'),
			{
				target: {files: [bundle]}
			}
		);

		expect(onChooseBundle).toHaveBeenCalledWith(bundle);
	});

	// Todo for the same reason this test is todo on FileInput under components.

	it.todo('calls the onChange prop when a file is chosen');

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
