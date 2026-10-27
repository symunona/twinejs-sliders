import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {useArtLoading} from '../../../../store/asset-library/library-provider';
import {AssetScopeProvider} from '../../../sliders-assets/asset-store-context';
import {ArtLoadingBar} from '../art-loading-bar';

jest.mock('../../../../store/asset-library/library-provider', () => ({
	...jest.requireActual('../../../../store/asset-library/library-provider'),
	useArtLoading: jest.fn()
}));

const useArtLoadingMock = useArtLoading as jest.Mock;

function renderBar() {
	return render(
		<AssetScopeProvider storyId="S">
			<ArtLoadingBar />
		</AssetScopeProvider>
	);
}

describe('<ArtLoadingBar>', () => {
	it('shows done of total for the scoped story while its art loads', () => {
		useArtLoadingMock.mockReturnValue({done: 3, total: 10});
		renderBar();

		expect(useArtLoadingMock).toHaveBeenCalledWith('S');
		expect(screen.getByTestId('art-loading-bar')).toHaveTextContent(
			'dialogs.passageEdit.scenePreview.loadingArt'
		);
		expect(screen.getByRole('progressbar')).toHaveAttribute('value', '3');
		expect(screen.getByRole('progressbar')).toHaveAttribute('max', '10');
	});

	it('is gone once the art is local', () => {
		useArtLoadingMock.mockReturnValue(undefined);
		renderBar();

		expect(screen.queryByTestId('art-loading-bar')).not.toBeInTheDocument();
	});
});
