import {AssetStore} from '@sliders/asset-store';
import {AssetId, AssetMeta, CutoutTuning} from '@sliders/scene-types';
import {act, fireEvent, render, screen, waitFor} from '@testing-library/react';
import {setupJestCanvasMock} from 'jest-canvas-mock';
import * as React from 'react';
import {AssetEditorDialog} from '../asset-editor';

// The store is the only thing this dialog reads the asset through, so it is the only
// thing worth faking. Everything else mocked here is scenery on the way in -- usage
// counts and the scene rename both want a story context, and the generator is only ever
// reached from a button.

let mockStore: AssetStore;
/** The sync context's per-story art pull. Re-armed by every test that cares. */
let mockPullAssets: jest.Mock;

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
	useAssetScope: () => MOCK_SCOPE,
	useAssetStore: () => mockStore
}));
// The whole sync layer, for one call. Importing the real hook would drag the client, the
// socket and the bundle importer into a suite about a canvas.
jest.mock('../../../store/persistence/server/use-server-sync', () => ({
	useServerSyncContext: () => ({pullAssets: mockPullAssets})
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
/**
 * The story whose library this is. `MOCK_` because a `jest.mock` factory may only reach
 * out to names that start with it.
 */
const MOCK_SCOPE = 'story-1';
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

		// A pull that finds nothing, which is what the tests below this one are about --
		// the dialog opening on what is already here. The wake-up suite re-arms it.
		mockPullAssets = jest.fn(async () => undefined);
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

	// Another editor can crop this asset, cut its background out or move its anchor on
	// their machine. Opening the editor on the stale copy and saving is what costs their
	// work, so the dialog pulls as it opens -- without ever making the author wait for it.

	describe('waking the asset up when the dialog opens', () => {
		/** What the store hands back for this asset. Swapped to stand for someone else's save. */
		let held: AssetMeta;
		let meta: jest.Mock;
		let settlePull!: (result: unknown) => void;

		/** A pull whose landing the test decides, so "before it settles" can be asserted. */
		function pendingPull(): Promise<unknown> {
			return new Promise(resolve => {
				settlePull = resolve;
			});
		}

		/**
		 * An asset with a `src` sidecar -- edited before, so the dialog restores from a
		 * base -- and a pull whose behaviour the test hands in.
		 */
		function renderWaking(pull: () => Promise<unknown>) {
			held = fakeMeta({sidecars: {src: {hash: 'src-1'}}});
			meta = jest.fn(async () => held);
			sidecar = jest.fn(async (_id: AssetId, kind: string) =>
				kind === 'src' ? fakeImage(BASE) : undefined
			);
			mockPullAssets = jest.fn(pull);
			mockStore = {
				get: async () => fakeImage(BASE),
				list: async () => [held],
				meta,
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

		/** The picture is up and the base has been read: the load is done. */
		async function waitForOpen() {
			await screen.findByTestId('anchor-marker');
			await waitFor(() =>
				expect(sidecar).toHaveBeenCalledWith(ASSET_ID, 'src')
			);
		}

		/** The same asset as `held`, with somebody else's anchor on it. */
		function movedElsewhere(): AssetMeta {
			return fakeMeta({
				origin: {x: 0.9, y: 0.25},
				sidecars: {src: {hash: 'src-1'}}
			});
		}

		/**
		 * The colour panel's three, in the order it lists them: brightness, contrast,
		 * gamma. By position rather than by name -- the label wraps the readout as well as
		 * the control, so the accessible name carries the current value on the end of it.
		 */
		function adjustSliders() {
			return screen.getAllByRole('slider') as HTMLInputElement[];
		}

		function changedButton() {
			return screen.queryByRole('button', {
				name: 'dialogs.assetEditor.changedElsewhere'
			});
		}

		it('opens on what is already here, without waiting for the pull', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			// Still in flight, and the dialog is fully usable anyway: the image, the
			// toolbar and the save buttons are all up, and nothing is spinning over them.
			expect(mockPullAssets).toHaveBeenCalledWith(MOCK_SCOPE);
			expect(screen.queryByText('dialogs.assetEditor.loading')).toBeNull();
			expectClean();
		});

		it('reloads silently when the pull moves this asset and nothing is unsaved', async () => {
			renderWaking(pendingPull);
			await waitForOpen();
			expect(screen.getByTestId('anchor-marker')).toHaveAttribute(
				'data-y',
				'1'
			);

			held = movedElsewhere();
			await act(async () => settlePull({changed: true}));

			// Reloaded, and not a word about it: there was nothing to lose.
			await waitFor(() =>
				expect(screen.getByTestId('anchor-marker')).toHaveAttribute(
					'data-y',
					'0.25'
				)
			);
			expect(changedButton()).toBeNull();
			expectClean();
		});

		it('asks before reloading over unsaved work, and declining keeps it', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			fireEvent.change(adjustSliders()[0], {target: {value: '20'}});
			expect(screen.getByTestId('asset-editor-dirty')).toHaveTextContent(
				'dialogs.assetEditor.unsavedChanges'
			);

			const loads = sidecar.mock.calls.length;

			held = movedElsewhere();
			await act(async () => settlePull({changed: true}));

			// Asked, not yanked. The prompt names what reloading costs.
			const keep = await screen.findByRole('button', {
				name: 'dialogs.assetEditor.changedElsewhereKeep'
			});

			expect(
				screen.getByText('dialogs.assetEditor.changedElsewherePrompt')
			).toBeInTheDocument();

			fireEvent.click(keep);
			await act(() => Promise.resolve());

			// Their brightness is still theirs, the asset never reloaded, and the offer is
			// still standing for when they are ready.
			expect(adjustSliders()[0].value).toBe('20');
			expect(screen.getByTestId('asset-editor-dirty')).toHaveTextContent(
				'dialogs.assetEditor.unsavedChanges'
			);
			expect(screen.getByTestId('anchor-marker')).toHaveAttribute(
				'data-y',
				'1'
			);
			expect(sidecar).toHaveBeenCalledTimes(loads);
			expect(changedButton()).toBeInTheDocument();
		});

		it('takes the other version when the author asks for it', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			fireEvent.change(adjustSliders()[0], {target: {value: '20'}});

			held = movedElsewhere();
			await act(async () => settlePull({changed: true}));

			fireEvent.click(
				await screen.findByRole('button', {
					name: 'dialogs.assetEditor.changedElsewhereReload'
				})
			);
			await act(() => Promise.resolve());

			await waitFor(() =>
				expect(screen.getByTestId('anchor-marker')).toHaveAttribute(
					'data-y',
					'0.25'
				)
			);
			expectClean();
			expect(changedButton()).toBeNull();
		});

		it('ignores a pull that landed art this dialog is not showing', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			const loads = sidecar.mock.calls.length;

			// `changed` is true -- somebody else's background arrived -- but this asset
			// stands exactly as it was. Reloading here would throw away a crop for art the
			// author is not even looking at.
			await act(async () => settlePull({changed: true}));
			await waitFor(() => expect(meta).toHaveBeenCalledTimes(2));

			expect(sidecar).toHaveBeenCalledTimes(loads);
			expect(changedButton()).toBeNull();
			expectClean();
		});

		it('ignores a pull that landed nothing', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			const loads = sidecar.mock.calls.length;

			// Moved on the server and already here: `changed` false is the honest answer,
			// and re-reading this asset over it would be work for nothing.
			held = movedElsewhere();
			await act(async () => settlePull({changed: false}));

			expect(meta).toHaveBeenCalledTimes(1);
			expect(sidecar).toHaveBeenCalledTimes(loads);
			expect(changedButton()).toBeNull();
		});

		// Editing offline is completely ordinary. Both of these have to leave the dialog
		// exactly as it is today, with nothing said to the author.

		it('says nothing when there is no sync client', async () => {
			renderWaking(async () => undefined);
			await waitForOpen();

			expect(screen.queryByRole('alert')).toBeNull();
			expect(changedButton()).toBeNull();
			expectClean();
		});

		it('says nothing when the pull throws', async () => {
			const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});

			renderWaking(async () => {
				throw new Error('offline');
			});
			await waitForOpen();
			await act(() => Promise.resolve());

			expect(screen.queryByRole('alert')).toBeNull();
			expect(changedButton()).toBeNull();
			expectClean();
			warn.mockRestore();
		});

		it('pulls once per open, not once per render', async () => {
			renderWaking(pendingPull);
			await waitForOpen();

			// Every one of these re-renders the dialog. An effect that listed `dirty`, the
			// metadata or the context's own callback would pull again on each -- a loop
			// against the server, wearing a dependency array.
			fireEvent.change(adjustSliders()[0], {target: {value: '20'}});
			fireEvent.change(adjustSliders()[1], {target: {value: '5'}});
			fireEvent.click(
				screen.getByRole('radio', {name: 'dialogs.assetEditor.toolHint.size'})
			);

			held = movedElsewhere();
			await act(async () => settlePull({changed: true}));
			await screen.findByRole('button', {
				name: 'dialogs.assetEditor.changedElsewhereKeep'
			});

			expect(mockPullAssets).toHaveBeenCalledTimes(1);
		});
	});
});
