import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {Character} from '@sliders/scene-types';
import {SceneDropMenu} from '../drop-menu';

const mira = {
	frames: {},
	id: 'mira',
	name: 'Mira',
	tags: []
} as unknown as Character;

function renderMenu(props: Partial<React.ComponentProps<typeof SceneDropMenu>> = {}) {
	const onCancel = jest.fn();
	const onChoose = jest.fn();

	render(
		<SceneDropMenu
			characters={[mira]}
			count={1}
			onCancel={onCancel}
			onChoose={onChoose}
			point={{x: 10, y: 10}}
			{...props}
		/>
	);

	return {onCancel, onChoose};
}

describe('<SceneDropMenu>', () => {
	it.each([
		['scene-drop-menu-bg', 'bg'],
		['scene-drop-menu-object', 'object'],
		['scene-drop-menu-character', 'character']
	])('reports %s as %s', (testId, kind) => {
		const {onChoose} = renderMenu();

		fireEvent.click(screen.getByTestId(testId));
		expect(onChoose).toHaveBeenCalledWith({kind});
	});

	it('names the character a frame choice belongs to', () => {
		const {onChoose} = renderMenu();

		fireEvent.click(screen.getByTestId('scene-drop-menu-frame'));
		fireEvent.click(screen.getByText('Mira'));
		expect(onChoose).toHaveBeenCalledWith({character: mira, kind: 'frame'});
	});

	it('offers no frame branch when the story has no cast', () => {
		renderMenu({characters: []});
		expect(screen.getByTestId('scene-drop-menu-frame')).toBeDisabled();
	});

	it('cancels on Escape', () => {
		const {onCancel} = renderMenu();

		fireEvent.keyDown(document, {key: 'Escape'});
		expect(onCancel).toHaveBeenCalled();
	});

	it('cancels on a press outside itself', () => {
		const {onCancel} = renderMenu();

		fireEvent.pointerDown(document.body);
		expect(onCancel).toHaveBeenCalled();
	});

	it('stays open for a press on itself', () => {
		const {onCancel} = renderMenu();

		fireEvent.pointerDown(screen.getByTestId('scene-drop-menu-bg'));
		expect(onCancel).not.toHaveBeenCalled();
	});
});
