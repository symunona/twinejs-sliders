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
			point={{x: 10, y: 10}}
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

		fireEvent.keyDown(document, {key: 'Escape'});
		expect(onCancel).toHaveBeenCalled();
		expect(onChoose).not.toHaveBeenCalled();
	});
});
