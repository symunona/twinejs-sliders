import {fireEvent, render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import type {AssetMeta} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../test-util';
import {AssetTile} from '../asset-tile';

/**
 * Renaming an asset from its tile, and the two double clicks the tile answers.
 *
 * The rule worth pinning: scene YAML addresses assets by NAME, so the prompt has to refuse
 * a name the library already answers to (`store.update` throws on it) and has to SAY
 * something when scenes already write the old one--nothing rewrites those beats.
 */

function meta(overrides: Partial<AssetMeta> = {}): AssetMeta {
	return {
		animated: false,
		bytes: 100,
		h: 100,
		hash: 'hash',
		id: 'a_8f21',
		kind: 'object',
		mime: 'image/png',
		name: 'candle',
		tags: [],
		w: 100,
		...overrides
	};
}

function renderTile(props: Partial<React.ComponentProps<typeof AssetTile>> = {}) {
	const onEdit = jest.fn();
	const onRename = jest.fn();

	render(
		<FakeStateProvider>
			<AssetTile
				allTags={[]}
				meta={meta()}
				onChangeTags={jest.fn()}
				onDelete={jest.fn()}
				onEdit={onEdit}
				onRename={onRename}
				{...props}
			/>
		</FakeStateProvider>
	);

	return {onEdit, onRename};
}

/** i18n is not initialised under jest, so every label is its own key. */
function renameField() {
	return screen.getByRole('textbox', {name: 'common.renamePrompt'});
}

describe('renaming an asset from its tile', () => {
	it('renames from the button in the tile row', async () => {
		const {onRename} = renderTile();

		await userEvent.click(screen.getByRole('button', {name: 'common.rename'}));
		await userEvent.clear(renameField());
		await userEvent.type(renameField(), 'lantern');
		await userEvent.click(screen.getByRole('button', {name: 'common.ok'}));
		expect(onRename).toHaveBeenCalledWith('lantern');
	});

	it('opens the same prompt when the name is double-clicked', () => {
		renderTile();
		expect(
			screen.queryByRole('textbox', {name: 'common.renamePrompt'})
		).not.toBeInTheDocument();
		fireEvent.doubleClick(document.querySelector('.sliders-tile-name')!);
		expect(renameField()).toBeInTheDocument();
	});

	it('refuses a name something else in the library already answers to', async () => {
		const {onRename} = renderTile({nameTaken: name => name === 'lantern'});

		await userEvent.click(screen.getByRole('button', {name: 'common.rename'}));
		await userEvent.clear(renameField());
		await userEvent.type(renameField(), 'lantern');
		expect(
			screen.getByText('dialogs.slidersAssets.renameTaken')
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'common.ok'})).toBeDisabled();
		expect(onRename).not.toHaveBeenCalled();
	});

	/** The asset's own name is not a clash with itself. */
	it('allows the name it already has', async () => {
		renderTile({nameTaken: name => name === 'candle'});

		await userEvent.click(screen.getByRole('button', {name: 'common.rename'}));
		expect(screen.getByRole('button', {name: 'common.ok'})).toBeEnabled();
	});

	/**
	 * Allowed, but loudly: renaming does not rewrite `bg: candle` in a scene, so those
	 * beats are about to ask for art that no longer exists.
	 */
	it('warns when scenes already write the old name, without blocking', async () => {
		renderTile({usedIn: ['Tavern', 'Cellar']});

		await userEvent.click(screen.getByRole('button', {name: 'common.rename'}));
		await userEvent.clear(renameField());
		await userEvent.type(renameField(), 'lantern');
		expect(
			screen.getByText('dialogs.slidersAssets.renameUsed')
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'common.ok'})).toBeEnabled();
	});

	it('refuses an empty name', async () => {
		renderTile();

		await userEvent.click(screen.getByRole('button', {name: 'common.rename'}));
		await userEvent.clear(renameField());
		expect(
			screen.getByText('dialogs.slidersAssets.renameEmpty')
		).toBeInTheDocument();
		expect(screen.getByRole('button', {name: 'common.ok'})).toBeDisabled();
	});
});

describe('double-clicking a tile picture', () => {
	it('opens the image editor', () => {
		const {onEdit} = renderTile();

		fireEvent.doubleClick(document.querySelector('.sliders-tile-art')!);
		expect(onEdit).toHaveBeenCalled();
	});

	/** Editing an animation would flatten it, which is why the button is disabled too. */
	it('does nothing for animated art', () => {
		const {onEdit} = renderTile({meta: meta({animated: true})});

		fireEvent.doubleClick(document.querySelector('.sliders-tile-art')!);
		expect(onEdit).not.toHaveBeenCalled();
	});

	it('does nothing for a sound, which has no pixels to edit', () => {
		const {onEdit} = renderTile({meta: meta({kind: 'sound'})});

		fireEvent.doubleClick(document.querySelector('.sliders-tile-art')!);
		expect(onEdit).not.toHaveBeenCalled();
	});
});
