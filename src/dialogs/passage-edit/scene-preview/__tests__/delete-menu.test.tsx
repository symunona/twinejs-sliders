import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {SceneDeleteMenu} from '../delete-menu';

function renderMenu() {
	const onCancel = jest.fn();
	const onChoose = jest.fn();

	render(
		<SceneDeleteMenu
			ids={['mira']}
			onCancel={onCancel}
			onChoose={onChoose}
		/>
	);

	return {onCancel, onChoose};
}

describe('<SceneDeleteMenu>', () => {
	it('deletes with the beats', () => {
		const {onChoose} = renderMenu();

		fireEvent.click(screen.getByTestId('scene-delete-menu-with-beats'));
		expect(onChoose).toHaveBeenCalledWith(true);
	});

	it('deletes only the entity, the beats stay', () => {
		const {onChoose} = renderMenu();

		fireEvent.click(screen.getByTestId('scene-delete-menu-keep-beats'));
		expect(onChoose).toHaveBeenCalledWith(false);
	});

	it('cancels on Escape', () => {
		const {onCancel, onChoose} = renderMenu();

		fireEvent.keyDown(screen.getByTestId('scene-delete-menu-keep-beats'), {
			key: 'Escape'
		});
		expect(onCancel).toHaveBeenCalled();
		expect(onChoose).not.toHaveBeenCalled();
	});

	it('cancels on a press on the backdrop, not on the card', () => {
		const {onCancel} = renderMenu();

		fireEvent.pointerDown(screen.getByTestId('scene-delete-menu'));
		expect(onCancel).not.toHaveBeenCalled();

		fireEvent.pointerDown(screen.getByTestId('scene-delete-modal'));
		expect(onCancel).toHaveBeenCalled();
	});

	it('keeps every key from the editor behind it', () => {
		const behind = jest.fn();

		document.addEventListener('keydown', behind);
		renderMenu();
		fireEvent.keyDown(screen.getByTestId('scene-delete-menu-with-beats'), {
			key: 'Delete'
		});
		document.removeEventListener('keydown', behind);
		expect(behind).not.toHaveBeenCalled();
	});
});
