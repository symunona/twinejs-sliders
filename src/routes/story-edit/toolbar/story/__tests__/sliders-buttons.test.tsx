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

	async function pressKey(key: string) {
		fireEvent.keyDown(document.activeElement!, {key});
		await act(async () => Promise.resolve());
	}

	it('opens the asset manager when clicked', async () => {
		await renderComponent(<SlidersAssetsButton />);
		fireEvent.click(screen.getByText('routes.storyEdit.toolbar.slidersAssets'));
		await act(async () => Promise.resolve());
		expect(screen.getByText('dialogs.slidersAssets.title')).toBeInTheDocument();
	});

	it('opens the asset manager from its shortcut', async () => {
		await renderComponent(<SlidersAssetsButton />);
		await pressKey('a');
		expect(screen.getByText('dialogs.slidersAssets.title')).toBeInTheDocument();
	});

	it('opens the character editor from its shortcut', async () => {
		await renderComponent(<SlidersCharactersButton />);
		await pressKey('c');
		expect(
			screen.getByText('dialogs.slidersCharacters.title')
		).toBeInTheDocument();
	});

	it("doesn't open the asset manager while the author is typing", async () => {
		await renderComponent(
			<>
				<SlidersAssetsButton />
				<input aria-hidden type="text" />
			</>
		);
		fireEvent.keyDown(document.querySelector('input[type="text"]')!, {key: 'a'});
		await act(async () => Promise.resolve());
		expect(
			screen.queryByText('dialogs.slidersAssets.title')
		).not.toBeInTheDocument();
	});
});
