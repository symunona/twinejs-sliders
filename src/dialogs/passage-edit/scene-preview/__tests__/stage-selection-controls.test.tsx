import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import * as React from 'react';
import type {AssetResolver, Character, Stage} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../../test-util';
import {StageSelectionControls} from '../stage-selection-controls';
import {parseSceneText} from '../use-scene-parse';

const passage = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4, frame: angry}',
	'  joren: {at: 0.3, z: 2}',
	'props:',
	'  candle: {at: 0.4}'
].join('\n');

const stage: Stage = parseSceneText(passage).states[0];

const mira: Character = {
	frames: {angry: {asset: 'a_2'}, idle: {asset: 'a_1'}},
	id: 'mira',
	name: 'Mira',
	origin: {x: 0.5, y: 1},
	size: {w: 1, h: 2},
	tags: []
};

const assets = {
	character: async (id: string) => (id === 'mira' ? mira : undefined),
	meta: async () => undefined,
	url: async () => undefined
} as unknown as AssetResolver;

function renderControls(
	ids: string[],
	overrides: Partial<React.ComponentProps<typeof StageSelectionControls>> = {}
) {
	const handlers = {
		onDelete: jest.fn(),
		onFlip: jest.fn(),
		onFrame: jest.fn(),
		onStepZ: jest.fn()
	};

	render(
		<FakeStateProvider>
			<StageSelectionControls
				assets={assets}
				editable
				entities={ids.map(id => stage.entities[id])}
				{...handlers}
				{...overrides}
			/>
		</FakeStateProvider>
	);

	return handlers;
}

function selects() {
	return Array.from(document.querySelectorAll('select'));
}

describe('<StageSelectionControls>', () => {
	// The row itself always exists — it holds the stage's height steady, which is why the
	// scene no longer jumps on the click that selects a sprite. What must not appear is any
	// control inside it.

	it('keeps the row but offers no controls without a selection', () => {
		renderControls([]);

		const row = screen.getByTestId('scene-preview-selection');

		expect(row).toHaveAttribute('aria-hidden', 'true');
		expect(row).toBeEmptyDOMElement();
	});

	it('keeps the row but offers no controls when there is no editor to write to', () => {
		renderControls(['mira'], {editable: false});

		const row = screen.getByTestId('scene-preview-selection');

		expect(row).toHaveAttribute('aria-hidden', 'true');
		expect(row).toBeEmptyDOMElement();
	});

	it('offers the character manifest frames, plus automatic', async () => {
		renderControls(['mira']);

		await waitFor(() => expect(selects()).toHaveLength(1));

		const frame = selects()[0];

		expect(Array.from(frame.options).map(option => option.value)).toEqual([
			'',
			'angry',
			'idle'
		]);
		expect(frame.value).toBe('angry');
	});

	it('writes the chosen frame, and removes the key for automatic', async () => {
		const {onFrame} = renderControls(['mira']);

		await waitFor(() => expect(selects()).toHaveLength(1));

		fireEvent.change(selects()[0], {target: {value: 'idle'}});
		expect(onFrame).toHaveBeenCalledWith('idle');

		fireEvent.change(selects()[0], {target: {value: ''}});
		expect(onFrame).toHaveBeenLastCalledWith(undefined);
	});

	it('offers no frames for a prop — props are one image', async () => {
		renderControls(['candle']);

		// Nothing left to select at all now that depth is two buttons. Waited on so a late
		// resolver cannot sneak one in after the assertion.
		await waitFor(() => expect(selects()).toHaveLength(0));
	});

	it('offers no frames for a multi-selection', async () => {
		renderControls(['mira', 'joren']);

		await waitFor(() => expect(selects()).toHaveLength(0));
	});

	// A prop, so nothing is fetched and the buttons are all there is.
	it('flips, steps depth and deletes through its buttons', () => {
		const {onDelete, onFlip, onStepZ} = renderControls(['candle']);
		const buttons = document.querySelectorAll('button');

		fireEvent.click(buttons[0]);
		expect(onFlip).toHaveBeenCalled();

		// Backward then forward, in the order a stack reads bottom-up.
		fireEvent.click(buttons[1]);
		expect(onStepZ).toHaveBeenCalledWith(-1);

		fireEvent.click(buttons[2]);
		expect(onStepZ).toHaveBeenLastCalledWith(1);

		fireEvent.click(buttons[buttons.length - 1]);
		expect(onDelete).toHaveBeenCalled();
	});
});
