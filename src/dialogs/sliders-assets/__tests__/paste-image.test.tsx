import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {clipboardImages, PasteImageModal, useImagePaste} from '../paste-image';

/**
 * Ctrl+V with a picture: the clipboard's files, renamed `pasted.*`, and the one question
 * (object, character or background) asked in a modal.
 */

function clipboard(files: File[], types: string[] = ['Files']) {
	return {files, types} as unknown as DataTransfer;
}

const png = () => new File(['x'], 'image.png', {type: 'image/png'});

function firePaste(target: Element, data: DataTransfer) {
	const event = new Event('paste', {bubbles: true, cancelable: true});

	Object.defineProperty(event, 'clipboardData', {value: data});
	target.dispatchEvent(event);

	return event;
}

const Harness: React.FC<{onImages: (files: File[]) => void}> = ({onImages}) => {
	useImagePaste(target => !!target.closest('[data-owned]'), onImages);

	return (
		<>
			<div data-owned data-testid="owned" tabIndex={-1}>
				<input data-testid="field" />
			</div>
			<div data-testid="elsewhere" tabIndex={-1} />
		</>
	);
};

describe('clipboardImages', () => {
	it('keeps only images and renames them pasted', () => {
		const files = clipboardImages(
			clipboard([png(), new File(['t'], 'notes.txt', {type: 'text/plain'})])
		);

		expect(files.map(file => file.name)).toEqual(['pasted.png']);
		expect(files[0].type).toBe('image/png');
	});

	it('maps an svg to a plain extension', () => {
		const files = clipboardImages(
			clipboard([new File(['<svg/>'], 'image', {type: 'image/svg+xml'})])
		);

		expect(files[0].name).toBe('pasted.svg');
	});

	it('is empty for a text-only clipboard or none', () => {
		expect(clipboardImages(clipboard([], ['text/plain']))).toEqual([]);
		expect(clipboardImages(null)).toEqual([]);
	});
});

describe('useImagePaste', () => {
	it('takes an image pasted where it owns focus', () => {
		const onImages = jest.fn();

		render(<Harness onImages={onImages} />);

		const event = firePaste(screen.getByTestId('owned'), clipboard([png()]));

		expect(onImages).toHaveBeenCalledWith([expect.any(File)]);
		expect(event.defaultPrevented).toBe(true);
	});

	it('leaves a paste elsewhere alone', () => {
		const onImages = jest.fn();

		render(<Harness onImages={onImages} />);
		firePaste(screen.getByTestId('elsewhere'), clipboard([png()]));
		expect(onImages).not.toHaveBeenCalled();
	});

	it('lets a text field have text that came along with the image', () => {
		const onImages = jest.fn();

		render(<Harness onImages={onImages} />);
		firePaste(
			screen.getByTestId('field'),
			clipboard([png()], ['Files', 'text/plain'])
		);
		expect(onImages).not.toHaveBeenCalled();

		firePaste(screen.getByTestId('field'), clipboard([png()]));
		expect(onImages).toHaveBeenCalledTimes(1);
	});
});

describe('<PasteImageModal>', () => {
	function renderModal(
		props: Partial<React.ComponentProps<typeof PasteImageModal>> = {}
	) {
		const onCancel = jest.fn();
		const onChoose = jest.fn();

		render(
			<PasteImageModal
				files={[png()]}
				onCancel={onCancel}
				onChoose={onChoose}
				{...props}
			/>
		);

		return {onCancel, onChoose};
	}

	it('offers object, character and background', () => {
		const {onChoose} = renderModal();

		fireEvent.click(screen.getByTestId('paste-image-character'));
		expect(onChoose).toHaveBeenCalledWith('character');
		fireEvent.click(screen.getByTestId('paste-image-bg'));
		expect(onChoose).toHaveBeenCalledWith('bg');
		fireEvent.click(screen.getByTestId('paste-image-object'));
		expect(onChoose).toHaveBeenCalledWith('object');
	});

	it('focuses the preferred kind', () => {
		renderModal({preferred: 'bg'});
		expect(screen.getByTestId('paste-image-bg')).toHaveFocus();
	});

	it('answers to its letter keys and Escape', () => {
		const {onCancel, onChoose} = renderModal();

		fireEvent.keyDown(document, {key: 'b'});
		expect(onChoose).toHaveBeenCalledWith('bg');
		fireEvent.keyDown(document, {key: 'Escape'});
		expect(onCancel).toHaveBeenCalled();
	});

	it('cancels on a press on the backdrop', () => {
		const {onCancel} = renderModal();

		fireEvent.pointerDown(screen.getByTestId('paste-image-modal'));
		expect(onCancel).toHaveBeenCalled();
	});
});
