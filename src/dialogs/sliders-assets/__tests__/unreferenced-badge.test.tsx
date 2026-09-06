import {render, screen} from '@testing-library/react';
import * as React from 'react';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {FakeStateProvider} from '../../../test-util';
import {AssetTile} from '../asset-tile';
import {CharacterTile} from '../character-tile';

/**
 * The badge that tells an author their art is not going to the server.
 *
 * `unreferenced` is deliberately three-state at the call site: the scan is async, and
 * `undefined` means "not known yet". A tile that showed the warning during that gap would
 * flash on every open, and a warning that cries wolf gets ignored on the one occasion it
 * is telling the truth.
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
		name: 'props/candle',
		tags: [],
		w: 100,
		...overrides
	};
}

function character(overrides: Partial<Character> = {}): Character {
	return {
		frames: {idle: {asset: 'a_0001'}},
		id: 'mira',
		name: 'Mira Vale',
		origin: {x: 0.5, y: 1},
		size: {w: 1, h: 2},
		tags: [],
		...overrides
	};
}

function renderAsset(unreferenced?: boolean) {
	render(
		<FakeStateProvider>
			<AssetTile
				allTags={[]}
				meta={meta()}
				onChangeTags={jest.fn()}
				onDelete={jest.fn()}
				onEdit={jest.fn()}
				unreferenced={unreferenced}
			/>
		</FakeStateProvider>
	);
}

function renderCharacter(unreferenced?: boolean) {
	render(
		<FakeStateProvider>
			<CharacterTile
				allTags={[]}
				character={character()}
				onChangeTags={jest.fn()}
				onDelete={jest.fn()}
				onEdit={jest.fn()}
				unreferenced={unreferenced}
			/>
		</FakeStateProvider>
	);
}

describe('the unused badge', () => {
	it('marks an asset no scene names', () => {
		renderAsset(true);
		expect(
			screen.getByText('dialogs.slidersAssets.unreferenced')
		).toBeInTheDocument();
	});

	it('leaves a referenced asset unmarked', () => {
		renderAsset(false);
		expect(
			screen.queryByText('dialogs.slidersAssets.unreferenced')
		).not.toBeInTheDocument();
	});

	it('marks nothing while the scan is still running', () => {
		renderAsset(undefined);
		expect(
			screen.queryByText('dialogs.slidersAssets.unreferenced')
		).not.toBeInTheDocument();
	});

	it('marks a character no scene casts', () => {
		renderCharacter(true);
		expect(
			screen.getByText('dialogs.slidersAssets.unreferenced')
		).toBeInTheDocument();
	});

	it('leaves a cast character unmarked', () => {
		renderCharacter(false);
		expect(
			screen.queryByText('dialogs.slidersAssets.unreferenced')
		).not.toBeInTheDocument();
	});

	/** It has to read as a caution, not as another tag. */
	it('renders as a warning, not an ordinary tag badge', () => {
		renderAsset(true);
		expect(
			screen.getByText('dialogs.slidersAssets.unreferenced')
		).toHaveClass('variant-warning');
	});
});
