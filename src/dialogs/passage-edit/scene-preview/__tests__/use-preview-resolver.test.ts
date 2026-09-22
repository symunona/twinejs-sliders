import {act, renderHook} from '@testing-library/react-hooks';
import {AssetStore} from '@sliders/asset-store';
import {refreshAssetLibrary} from '../../../sliders-assets/asset-store-context';
import {usePreviewResolver} from '../use-preview-resolver';

const mockStore = {
	character: jest.fn(),
	list: jest.fn(),
	meta: jest.fn(),
	url: jest.fn()
};

jest.mock('../../../sliders-assets/asset-store-context', () => ({
	...jest.requireActual('../../../sliders-assets/asset-store-context'),
	useAssetStore: () => mockStore as unknown as AssetStore
}));

const TAVERN = {id: 'a_1', name: 'tavern', tags: []};

beforeEach(() => {
	// `resetMocks` is on, so every implementation is put back by hand.
	mockStore.character.mockResolvedValue(undefined);
	mockStore.list.mockResolvedValue([TAVERN]);
	// A name is not an id, so the direct lookup misses and the name index is what answers.
	mockStore.meta.mockResolvedValue(undefined);
	mockStore.url.mockResolvedValue('blob:tavern');
});

describe('usePreviewResolver', () => {
	it('caches the name index, so typing does not re-list the library', async () => {
		const {result} = renderHook(() => usePreviewResolver());

		await act(async () => {
			await result.current.url('tavern');
			await result.current.url('tavern');
		});

		expect(mockStore.list).toHaveBeenCalledTimes(1);
	});

	it('drops the index when the library changes', async () => {
		// The bug: the asset dialogs are dialogs, in this same window. Editing or renaming
		// an asset over the top of the preview fires no window focus event, so the index
		// below kept answering with the library as it was when the passage was opened.
		const {result} = renderHook(() => usePreviewResolver());

		await act(async () => {
			await result.current.url('tavern');
		});

		act(() => refreshAssetLibrary());

		await act(async () => {
			await result.current.url('tavern');
		});

		expect(mockStore.list).toHaveBeenCalledTimes(2);
	});

	it('stops listening once the preview is gone', async () => {
		const {result, unmount} = renderHook(() => usePreviewResolver());

		await act(async () => {
			await result.current.url('tavern');
		});

		unmount();
		act(() => refreshAssetLibrary());

		await act(async () => {
			await result.current.url('tavern');
		});

		expect(mockStore.list).toHaveBeenCalledTimes(1);
	});
});
