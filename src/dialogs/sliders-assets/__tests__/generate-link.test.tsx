import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {FakeStateProvider} from '../../../test-util';
import {AssetGeneratorDialog} from '../../asset-generator/asset-generator';
import {DialogsContext} from '../../context/dialogs-context';
import {SlidersAssetsDialog} from '../sliders-assets';

/**
 * The Generate link in the tab strip.
 *
 * It sits among the tabs but opens a dialog instead of switching panels, so the thing
 * worth pinning is that it dispatches at all -- react-tabs owns that row, and a click it
 * swallowed would look identical to a link that was never wired up.
 */

jest.mock('../../asset-generator/asset-generator', () => ({
	AssetGeneratorDialog: () => null
}));

// The library loads from IndexedDB, which jsdom does not have. Nothing here reads assets.
jest.mock('../asset-store-context', () => ({
	...jest.requireActual('../asset-store-context'),
	useAssetLibrary: () => ({
		all: [],
		busy: false,
		characters: [],
		refresh: jest.fn(),
		store: {backend: 'memory'},
		tags: [],
		visible: [],
		upload: jest.fn()
	})
}));

jest.mock('../use-asset-usage', () => ({useAssetUsage: () => new Map()}));
jest.mock('../use-synced-refs', () => ({
	useSyncedRefs: () => ({
		assetIds: new Set(),
		characterIds: new Set(),
		ready: false
	})
}));

function renderDialog(dispatch: jest.Mock) {
	render(
		<FakeStateProvider>
			<DialogsContext.Provider value={{dialogs: [], dispatch}}>
				<SlidersAssetsDialog
					collapsed={false}
					onChangeCollapsed={jest.fn()}
					onChangeHighlighted={jest.fn()}
					onChangeMaximized={jest.fn()}
					onChangeProps={jest.fn()}
					onClose={jest.fn()}
				/>
			</DialogsContext.Provider>
		</FakeStateProvider>
	);
}

describe('the Generate link in the assets dialog', () => {
	it('opens the generator dialog, maximized', async () => {
		const dispatch = jest.fn();

		renderDialog(dispatch);
		await userEvent.click(
			screen.getByRole('button', {name: 'dialogs.slidersAssets.generateTab'})
		);

		expect(dispatch).toHaveBeenCalledWith({
			type: 'addDialog',
			component: AssetGeneratorDialog,
			maximized: true
		});
	});

	it('leaves the selected tab alone', async () => {
		renderDialog(jest.fn());

		const backgrounds = screen.getByRole('tab', {
			name: 'dialogs.slidersAssets.backgrounds'
		});

		expect(backgrounds).toHaveAttribute('aria-selected', 'true');
		await userEvent.click(
			screen.getByRole('button', {name: 'dialogs.slidersAssets.generateTab'})
		);
		expect(backgrounds).toHaveAttribute('aria-selected', 'true');
	});
});
