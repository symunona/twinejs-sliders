import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../../../../test-util';
import {SlidersAssetsButton} from '../sliders-assets-button';
import {SlidersCharactersButton} from '../sliders-characters-button';

// The keys themselves live in src/hotkeys/default-keymap.ts. What's tested
// here is that the command reaches the same handler the button clicks.

describe('sliders toolbar buttons', () => {
	async function renderComponent(children: React.ReactNode) {
		const result = render(
			<FakeStateProvider hotkeyScope="story-map">{children}</FakeStateProvider>
		);

		await act(async () => Promise.resolve());
		return result;
	}

	async function pressKey(key: string, init: KeyboardEventInit = {}) {
		fireEvent.keyDown(document.activeElement!, {key, ...init});
		await act(async () => Promise.resolve());
	}

	it('opens the asset manager when clicked', async () => {
		await renderComponent(<SlidersAssetsButton />);
		fireEvent.click(screen.getByText('routes.storyEdit.toolbar.slidersAssets'));
		await act(async () => Promise.resolve());
		expect(screen.getByText('dialogs.library.title')).toBeInTheDocument();
	});

	it('opens the asset manager from its shortcut', async () => {
		await renderComponent(<SlidersAssetsButton />);
		await pressKey('a', {altKey: true});
		expect(screen.getByText('dialogs.library.title')).toBeInTheDocument();
	});

	// One key everywhere: the map, a text field, and a dialog, none of which is the scope
	// the button sits in.

	it('opens the asset manager from its shortcut while the author is typing', async () => {
		await renderComponent(
			<>
				<SlidersAssetsButton />
				<input aria-hidden type="text" />
			</>
		);
		fireEvent.keyDown(document.querySelector('input[type="text"]')!, {
			altKey: true,
			key: 'a'
		});
		await act(async () => Promise.resolve());
		expect(screen.getByText('dialogs.library.title')).toBeInTheDocument();
	});

	it('opens the asset manager from its shortcut inside a dialog', async () => {
		await renderComponent(
			<>
				<SlidersAssetsButton />
				<div data-hotkey-scope="dialog">
					<button>inside</button>
				</div>
			</>
		);
		screen.getByText('inside').focus();
		await pressKey('a', {altKey: true});
		expect(screen.getByText('dialogs.library.title')).toBeInTheDocument();
	});

	it('opens the character editor from its shortcut', async () => {
		await renderComponent(<SlidersCharactersButton />);
		await pressKey('c', {altKey: true});
		expect(
			screen.getByText('dialogs.slidersCharacters.title')
		).toBeInTheDocument();
	});

	it("doesn't open the asset manager on a bare a while the author is typing", async () => {
		await renderComponent(
			<>
				<SlidersAssetsButton />
				<input aria-hidden type="text" />
			</>
		);
		fireEvent.keyDown(document.querySelector('input[type="text"]')!, {key: 'a'});
		await act(async () => Promise.resolve());
		expect(
			screen.queryByText('dialogs.library.title')
		).not.toBeInTheDocument();
	});
});
