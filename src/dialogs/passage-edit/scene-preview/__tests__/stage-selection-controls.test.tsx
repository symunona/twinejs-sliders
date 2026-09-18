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
		onPreviewFrame: jest.fn(),
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

/**
 * i18n is not initialised under jest, so every `t()` is its own key here. Real frame names
 * come from the manifest and are unaffected; only the Automatic row is a key.
 */
const AUTO_LABEL = 'dialogs.passageEdit.scenePreview.frameAuto';

/**
 * The frame control's own button. Found structurally — it is the row's only `MenuButton` —
 * rather than by label: the row also holds flip, two depth steps and delete, their order is
 * not what these tests are about, and their labels are all keys in this environment.
 */
function frameButton(): HTMLButtonElement | undefined {
	return (
		document.querySelector<HTMLButtonElement>(
			'.scene-preview-selection .menu-button button'
		) ?? undefined
	);
}

/** The open menu's rows. Portalled to the body, so this cannot be scoped to the row. */
function frameItems(): HTMLButtonElement[] {
	return Array.from(document.querySelectorAll('.menu-button-menu button'));
}

function itemNamed(label: string): HTMLButtonElement {
	const item = frameItems().find(button => button.textContent === label);

	if (!item) {
		throw new Error(`no menu item "${label}" in [${frameItems().map(i => i.textContent).join(', ')}]`);
	}

	return item;
}

async function openFrameMenu() {
	await waitFor(() => expect(frameButton()).toBeDefined());
	fireEvent.click(frameButton() as HTMLButtonElement);
	await waitFor(() => expect(frameItems().length).toBeGreaterThan(0));
}

/**
 * React 16 derives `onPointerEnter`/`onPointerLeave` from the pointerover/pointerout pair,
 * so dispatching `pointerenter` — which does not bubble — reaches nothing. These are the
 * events the component actually sees in a browser.
 */
function hover(item: HTMLElement) {
	fireEvent.pointerOver(item);
}

function unhover(item: HTMLElement) {
	fireEvent.pointerOut(item);
}

describe('<StageSelectionControls>', () => {
	// The row floats over the stage, so it costs the stage no height and simply is not there
	// when it has nothing to say. An empty placeholder would sit on the scene for nothing.

	it('renders nothing without a selection', () => {
		renderControls([]);

		expect(screen.queryByTestId('scene-preview-selection')).toBeNull();
	});

	it('renders nothing when there is no editor to write to', () => {
		renderControls(['mira'], {editable: false});

		expect(screen.queryByTestId('scene-preview-selection')).toBeNull();
	});

	it('offers the character manifest frames, plus automatic', async () => {
		renderControls(['mira']);
		await openFrameMenu();

		expect(frameItems().map(item => item.textContent)).toEqual([
			AUTO_LABEL,
			'angry',
			'idle'
		]);
		// The scene's own frame is the one ticked, so the menu reports as well as offers.
		expect(
			frameItems()
				.filter(item => item.getAttribute('aria-checked') === 'true')
				.map(item => item.textContent)
		).toEqual(['angry']);
	});

	it('writes the chosen frame, and removes the key for automatic', async () => {
		const {onFrame} = renderControls(['mira']);

		await openFrameMenu();
		fireEvent.click(itemNamed('idle'));
		expect(onFrame).toHaveBeenCalledWith('idle');

		await openFrameMenu();
		fireEvent.click(itemNamed(AUTO_LABEL));
		expect(onFrame).toHaveBeenLastCalledWith(undefined);
	});

	it('previews the hovered frame and takes it back on leave', async () => {
		const {onFrame, onPreviewFrame} = renderControls(['mira']);

		await openFrameMenu();
		hover(itemNamed('idle'));
		expect(onPreviewFrame).toHaveBeenLastCalledWith('idle');

		// Automatic previews the fallback, so it is a frame to look at like any other.
		hover(itemNamed(AUTO_LABEL));
		expect(onPreviewFrame).toHaveBeenLastCalledWith('');

		unhover(itemNamed(AUTO_LABEL));
		expect(onPreviewFrame).toHaveBeenLastCalledWith(null);

		// Hovering is a question, not an answer.
		expect(onFrame).not.toHaveBeenCalled();
	});

	it('takes the preview back when the menu closes without a leave', async () => {
		const {onPreviewFrame} = renderControls(['mira']);

		await openFrameMenu();
		hover(itemNamed('idle'));
		onPreviewFrame.mockClear();

		// What a click anywhere else does: the items unmount under the pointer and no leave
		// event ever arrives.
		fireEvent.click(document.body);
		expect(onPreviewFrame).toHaveBeenCalledWith(null);
	});

	it('offers no frames for a prop — props are one image', async () => {
		renderControls(['candle']);

		// Nothing left to choose at all now that depth is two buttons. Waited on so a late
		// resolver cannot sneak one in after the assertion.
		await waitFor(() => expect(frameButton()).toBeUndefined());
	});

	it('offers no frames for a multi-selection', async () => {
		renderControls(['mira', 'joren']);

		await waitFor(() => expect(frameButton()).toBeUndefined());
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
