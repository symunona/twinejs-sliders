import {AssetStore} from '@sliders/asset-store';
import {AssetId, AssetMeta, CutoutTuning} from '@sliders/scene-types';
import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {setupJestCanvasMock} from 'jest-canvas-mock';
import * as React from 'react';
import {AssetEditorDialog} from '../asset-editor';

// The store is the only thing this dialog reads the asset through, so it is the only
// thing worth faking. Everything else mocked here is scenery on the way in -- usage
// counts and the scene rename both want a story context, and the generator is only ever
// reached from a button.

let mockStore: AssetStore;

// Not the shared i18n mock, which hands back a fresh `t` on every call. Three controls
// here memoise a validator on `t`, and `<PromptButton>` re-validates -- and sets state --
// whenever that identity changes, so an unstable `t` renders this dialog forever. The
// real `useTranslation` returns a stable one; this one does too.

jest.mock('react-i18next', () => {
	const t = (key: string) => key;

	return {useTranslation: () => ({t})};
});
jest.mock('../../sliders-assets/asset-store-context', () => ({
	refreshAssetLibrary: jest.fn(),
	useAssetStore: () => mockStore
}));
jest.mock('../../sliders-assets/use-asset-usage', () => ({
	useAssetUsage: () => new Map()
}));
jest.mock('../../sliders-assets/use-scene-ref-rename', () => ({
	useSceneRefRename: () => jest.fn()
}));
jest.mock('../../asset-generator/asset-generator', () => ({
	AssetGeneratorDialog: () => null
}));

const ASSET_ID: AssetId = 'a_1234';
/** The picture is four by four, so a matching alpha map is sixteen values. */
const BASE = {height: 4, width: 4};
const TUNING: CutoutTuning = {softness: 0.1, threshold: 0.42};

/** How big the bitmap a blob decodes to is. See the `createImageBitmap` stub below. */
const bitmapSizes = new Map<Blob, {height: number; width: number}>();

function fakeImage(size: {height: number; width: number}): Blob {
	const blob = new Blob(['png'], {type: 'image/png'});

	bitmapSizes.set(blob, size);
	return blob;
}

function fakeMeta(overrides?: Partial<AssetMeta>): AssetMeta {
	return {
		animated: false,
		bytes: 64,
		h: BASE.height,
		hash: 'hash',
		id: ASSET_ID,
		kind: 'bg',
		mime: 'image/webp',
		name: 'lamp',
		tags: [],
		w: BASE.width,
		...overrides
	};
}

describe('<AssetEditorDialog>', () => {
	/** Records what the dialog asked for, so a test can wait for the load to run out. */
	let sidecar: jest.Mock;

	beforeEach(() => {
		// `resetMocks` empties every `jest.fn`, and jest-canvas-mock's whole surface is
		// made of them -- so by the time a test runs, `getContext('2d')` is back to
		// returning undefined. Re-arm it here rather than in setupTests: this is the
		// only suite that actually draws.
		setupJestCanvasMock();

		// A plain function rather than a `jest.fn`, for the same reason, and ours
		// because jest-canvas-mock reads `width` off whatever it is handed: a jsdom Blob
		// has none, so every blob would decode 1x1.
		(window as any).createImageBitmap = async (blob: Blob) => {
			const size = bitmapSizes.get(blob) ?? BASE;

			return new (window as any).ImageBitmap(size.width, size.height);
		};
	});

	afterEach(() => bitmapSizes.clear());

	/**
	 * An asset that was edited once -- so it has a base to re-render from -- and whose
	 * manifest says a cutout went with it. `cutout` is what `store.sidecar` hands back
	 * for that kind, absent when the blob is not on this device.
	 */
	function renderEdited(cutout?: Blob) {
		const assetMeta = fakeMeta({
			sidecars: {cutout: {}, src: {}},
			tuning: TUNING
		});

		sidecar = jest.fn(async (_id: AssetId, kind: string) =>
			kind === 'cutout' ? cutout : fakeImage(BASE)
		);
		mockStore = {
			get: async () => fakeImage(BASE),
			list: async () => [assetMeta],
			meta: async () => assetMeta,
			sidecar,
			takenNames: async () => new Set<string>()
		} as unknown as AssetStore;

		return render(
			<AssetEditorDialog
				assetId={ASSET_ID}
				collapsed={false}
				onChangeCollapsed={jest.fn()}
				onChangeHighlighted={jest.fn()}
				onChangeMaximized={jest.fn()}
				onChangeProps={jest.fn()}
				onClose={jest.fn()}
			/>
		);
	}

	/** Every fixture here names a cutout, and asking for it is the last thing `load` does. */
	async function waitForLoad() {
		await screen.findByTestId('asset-editor-dirty');
		await waitFor(() =>
			expect(sidecar).toHaveBeenCalledWith(ASSET_ID, 'cutout')
		);
	}

	/** Nothing to save, and nothing offering to. Keys, because `t` is identity here. */
	function expectClean() {
		expect(screen.getByTestId('asset-editor-dirty')).toHaveTextContent(
			'dialogs.assetEditor.noChanges'
		);
		expect(
			screen.getByRole('button', {name: 'dialogs.assetEditor.replace'})
		).toBeDisabled();
	}

	// Opening an asset is not editing it. Both of these open with the manifest
	// promising a cutout and the alpha map never reaching the canvas, and in both the
	// dialog has to report what it is actually showing -- the un-cut picture -- rather
	// than what the manifest said. A dialog that opens dirty is not just noisy: the
	// save it offers would write the tuning back out from controls that never loaded.

	it('opens clean when the manifest names a cutout whose blob is not on this device', async () => {
		renderEdited(undefined);
		await waitForLoad();
		expectClean();
	});

	it('opens clean when the stored cutout does not fit the pixels it is stored against', async () => {
		renderEdited(fakeImage({height: 2, width: 2}));
		await waitForLoad();
		expectClean();
	});

	it('opens clean and restores the tuning when the cutout does load', async () => {
		renderEdited(fakeImage(BASE));
		await waitForLoad();
		expectClean();

		fireEvent.click(
			screen.getByRole('radio', {
				name: 'dialogs.assetEditor.toolHint.background'
			})
		);

		const sliders = screen.getAllByRole('slider') as HTMLInputElement[];

		// Threshold then softness, the order the panel lists them in.
		expect(sliders).toHaveLength(2);
		expect(sliders[0].value).toBe('0.42');
		expect(sliders[1].value).toBe('0.1');
	});
});
