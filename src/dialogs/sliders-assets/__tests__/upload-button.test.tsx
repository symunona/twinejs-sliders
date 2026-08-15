import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../test-util';
import {UploadButton} from '../upload-button';

describe('<UploadButton>', () => {
	let click: jest.SpyInstance;

	beforeEach(() => {
		// The button opens the file picker by clicking a hidden input, which
		// jsdom won't do for real.
		click = jest.spyOn(HTMLInputElement.prototype, 'click');
		click.mockImplementation(() => {});
	});

	afterEach(() => click.mockRestore());

	function renderComponent(props?: Partial<React.ComponentProps<typeof UploadButton>>) {
		return render(
			<FakeStateProvider hotkeyScope="sliders-assets">
				<UploadButton label="test-label" onUpload={jest.fn()} {...props} />
			</FakeStateProvider>
		);
	}

	it('opens the file picker when clicked', () => {
		renderComponent();
		fireEvent.click(screen.getByText('test-label'));
		expect(click).toHaveBeenCalled();
	});

	it('opens the file picker from its command, when given one', () => {
		renderComponent({
			commandId: 'slidersAssets.upload',
			commandScope: 'sliders-assets'
		});
		fireEvent.keyDown(document.activeElement!, {key: 'u'});
		expect(click).toHaveBeenCalled();
	});

	it('registers no command when given no ID', () => {
		renderComponent();
		fireEvent.keyDown(document.activeElement!, {key: 'u'});
		expect(click).not.toHaveBeenCalled();
	});

	it('passes chosen files to the onUpload prop', () => {
		const onUpload = jest.fn();
		const file = new File(['x'], 'test.png', {type: 'image/png'});

		renderComponent({onUpload});
		fireEvent.change(screen.getByLabelText('test-label'), {
			target: {files: [file]}
		});
		expect(onUpload).toHaveBeenCalledWith([file]);
	});
});
