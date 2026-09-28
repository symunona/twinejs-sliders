import {
	act,
	createEvent,
	fireEvent,
	render,
	screen,
	waitFor,
	within
} from '@testing-library/react';
import * as React from 'react';
import {AssetRecord} from '@sliders/asset-library';
import {png} from '../../../../packages/asset-library/src/testing/fixtures';
import {
	byName,
	team,
	upload
} from '../../../../packages/asset-library/src/testing/scenario';
import type {Browser, World} from '../../../../packages/asset-library/src/testing/world';
import {setLibraryEngine} from '../../../store/asset-library/engine-registry';
import type {Story} from '../../../store/stories';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {resetAssetStoresForTests} from '../asset-store-context';
import {SlidersAssetsDialog} from '../sliders-assets';

/**
 * The Library dialog over a REAL engine (packages/asset-library/src/testing): rail
 * attach / detach / reorder, tile menu actions, the upload dupe dialog. Asserts on what
 * the engine holds afterwards, not on calls.
 */

jest.mock('../../../components/control/menu-button');
// A stable `t`, like the real hook: PromptButton re-validates on every new identity.
jest.mock('react-i18next', () => {
	const t = (key: string) => key;

	return {useTranslation: () => ({t})};
});
jest.mock('../../asset-generator/asset-generator', () => ({
	AssetGeneratorDialog: () => null
}));
// jsdom cannot decode images; the pipeline's own tests cover prepareUpload.
jest.mock('@sliders/asset-store', () => {
	const actual = jest.requireActual('@sliders/asset-store');

	return {
		...actual,
		prepareUpload: async (file: File) => ({
			animated: false,
			blob: file,
			height: 4,
			mime: 'image/png',
			sniffed: {animated: false, format: 'png', mime: 'image/png'},
			transcoded: false,
			width: 4
		})
	};
});

// jsdom has neither SubtleCrypto nor TextEncoder; the real engine needs both.
beforeAll(() => {
	if (typeof globalThis.TextEncoder === 'undefined') {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const util = require('util');

		Object.assign(globalThis, {
			TextDecoder: util.TextDecoder,
			TextEncoder: util.TextEncoder
		});
	}

	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

afterEach(() => resetAssetStoresForTests());

interface Setup {
	world: World;
	ana: Browser;
	bo: Browser;
	story: Story;
	tavernId: string;
	fantasyId: string;
}

async function setup(sceneText = ''): Promise<Setup> {
	const {world, ana, bo, tavern} = await team();
	const fantasy = ana.engine.createCollection({name: 'fantasy'});
	const story = fakeStory(1);

	story.name = 'Night Market';
	story.passages[0].text = sceneText;
	ana.engine.createStory(story.id, {name: story.name});
	await world.settle();
	await setLibraryEngine(ana.engine);

	return {ana, bo, fantasyId: fantasy.id, story, tavernId: tavern.id, world};
}

function renderLibrary(story: Story) {
	return render(
		<FakeStateProvider assetScope={story.id} stories={[story]}>
			<SlidersAssetsDialog
				collapsed={false}
				onChangeCollapsed={jest.fn()}
				onChangeHighlighted={jest.fn()}
				onChangeMaximized={jest.fn()}
				onChangeProps={jest.fn()}
				onClose={jest.fn()}
			/>
		</FakeStateProvider>
	);
}

function railItem(name: string): HTMLElement {
	return screen
		.getAllByRole('button', {name})
		.find(button => button.classList.contains('library-rail-name'))!
		.closest('li')!;
}

function dataTransfer(data: Record<string, string> = {}, files: File[] = []) {
	return {
		dropEffect: '',
		effectAllowed: '',
		files,
		getData: (type: string) => data[type] ?? '',
		setData: (type: string, value: string) => {
			data[type] = value;
		},
		types: files.length ? ['Files'] : Object.keys(data)
	};
}

describe('Library rail', () => {
	it('ticking a team collection attaches it; unticking detaches', async () => {
		const {ana, story, tavernId} = await setup();

		renderLibrary(story);

		// Both team collections have the same (key) label; find tavern-set's row.
		await screen.findAllByRole('checkbox', {name: 'dialogs.library.attach'});
		fireEvent.click(within(railItem('tavern-set')).getByRole('checkbox'));
		await waitFor(() =>
			expect(ana.engine.binding(story.id)!.collections).toEqual([tavernId])
		);
		await waitFor(() =>
			expect(
				within(screen.getByTestId('library-rail-attached')).getByText('tavern-set')
			).toBeInTheDocument()
		);
		fireEvent.click(within(railItem('tavern-set')).getByRole('checkbox'));
		await waitFor(() =>
			expect(ana.engine.binding(story.id)!.collections).toEqual([])
		);
	});

	it('detach warns when the scenes use names only found there', async () => {
		const {ana, story, tavernId} = await setup('[scene]\nbg: night');

		await upload(ana, tavernId, 'night', 'night', {kind: 'bg'});
		ana.engine.bind(story.id, [tavernId]);
		renderLibrary(story);

		fireEvent.click(
			within(await waitFor(() => railItem('tavern-set'))).getByRole('checkbox')
		);

		const ask = await screen.findByRole('alertdialog');

		expect(ask).toHaveTextContent('dialogs.library.detachWarning');
		// Still attached until confirmed.
		expect(ana.engine.binding(story.id)!.collections).toEqual([tavernId]);
		fireEvent.click(
			within(ask).getByRole('button', {name: 'dialogs.library.detachAnyway'})
		);
		await waitFor(() =>
			expect(ana.engine.binding(story.id)!.collections).toEqual([])
		);
	});

	it('dragging an attached collection onto another reorders the binding', async () => {
		const {ana, fantasyId, story, tavernId} = await setup();

		ana.engine.bind(story.id, [tavernId, fantasyId]);
		renderLibrary(story);

		const tavern = await waitFor(() => railItem('tavern-set'));
		const fantasy = railItem('fantasy');
		const transfer = dataTransfer();

		fireEvent.dragStart(tavern, {dataTransfer: transfer});
		fireEvent.dragOver(fantasy, {dataTransfer: transfer});
		fireEvent.drop(fantasy, {dataTransfer: transfer});
		await waitFor(() =>
			expect(ana.engine.binding(story.id)!.collections).toEqual([
				fantasyId,
				tavernId
			])
		);
	});

	it('+ New collection creates a shared collection and attaches it', async () => {
		const {ana, story} = await setup();

		renderLibrary(story);
		fireEvent.click(
			await screen.findByRole('button', {name: 'dialogs.library.newCollection'})
		);
		fireEvent.change(
			screen.getByRole('textbox', {name: 'dialogs.library.newCollectionPrompt'}),
			{target: {value: 'ui-icons'}}
		);
		// OK waits for the (async) name check.
		await waitFor(() =>
			expect(screen.getByRole('button', {name: 'common.ok'})).toBeEnabled()
		);
		fireEvent.click(screen.getByRole('button', {name: 'common.ok'}));
		await waitFor(() => expect(ana.engine.collectionByName('ui-icons')).toBeDefined());
		expect(ana.engine.binding(story.id)!.collections).toEqual([
			ana.engine.collectionByName('ui-icons')!.id
		]);
		expect(ana.engine.collectionByName('ui-icons')!.kind).toBe('shared');
	});

	it('a tile dropped on a rail collection moves it; Alt copies', async () => {
		const {ana, fantasyId, story, tavernId} = await setup();
		const night = await upload(ana, tavernId, 'night', 'night', {kind: 'bg'});
		const day = await upload(ana, tavernId, 'day', 'day', {kind: 'bg'});

		ana.engine.bind(story.id, [tavernId, fantasyId]);
		renderLibrary(story);

		const fantasy = await waitFor(() => railItem('fantasy'));

		fireEvent.drop(fantasy, {
			dataTransfer: dataTransfer({'application/x-sliders-library-asset': night.id})
		});
		expect(ana.engine.get<'asset'>(night.id, 'asset')!.collection).toBe(fantasyId);

		// jsdom has no DragEvent, so `altKey` in the init is dropped: set it on the event.
		const altDrop = createEvent.drop(fantasy, {
			dataTransfer: dataTransfer({'application/x-sliders-library-asset': day.id})
		});

		Object.defineProperty(altDrop, 'altKey', {value: true});
		fireEvent(fantasy, altDrop);
		expect(ana.engine.get<'asset'>(day.id, 'asset')!.collection).toBe(tavernId);
		expect(byName(ana, fantasyId, 'day')!.sourceAsset).toBe(day.id);
	});
});

describe('Library tile menu', () => {
	async function showTavern(s: Setup) {
		s.ana.engine.bind(s.story.id, [s.tavernId]);
		renderLibrary(s.story);
		fireEvent.click(
			await waitFor(() =>
				within(railItem('tavern-set')).getByRole('button', {name: 'tavern-set'})
			)
		);
	}

	/** The one tile's menu (the mock renders items inline). */
	function menu() {
		return screen.getByTestId('mock-menu-button-dialogs.library.menu.more');
	}

	it('Copy to Mine forks into the own collection; Unfork removes the copy', async () => {
		const s = await setup();
		const night = await upload(s.ana, s.tavernId, 'night', 'night', {kind: 'bg'});

		await showTavern(s);
		await screen.findByText('night');
		fireEvent.click(
			within(menu()).getByRole('button', {name: 'dialogs.library.menu.fork'})
		);

		const own = s.ana.engine.binding(s.story.id)!.own;

		await waitFor(() => expect(byName(s.ana, own, 'night')).toBeDefined());

		const fork = byName(s.ana, own, 'night')!;

		expect(fork.sourceAsset).toBe(night.id);

		// Mine now shows the fork, with Unfork.
		fireEvent.click(railItem('dialogs.library.mine').querySelector('button')!);
		await waitFor(() =>
			expect(
				screen.getByRole('button', {name: 'dialogs.library.menu.unfork'})
			).toBeInTheDocument()
		);
		fireEvent.click(screen.getByRole('button', {name: 'dialogs.library.menu.unfork'}));
		expect(s.ana.engine.get(fork.id, 'asset')).toBeUndefined();
	});

	it('Move to collection… moves the record', async () => {
		const s = await setup();
		const night = await upload(s.ana, s.tavernId, 'night', 'night', {kind: 'bg'});

		await showTavern(s);
		await screen.findByText('night');
		fireEvent.click(
			within(menu()).getByRole('button', {name: 'dialogs.library.menu.move'})
		);
		const panel = await waitFor(() => {
			const found = document.querySelector<HTMLElement>('.library-move');

			expect(found).not.toBeNull();
			return found!;
		});

		fireEvent.click(within(panel).getByRole('button', {name: 'fantasy'}));
		expect(s.ana.engine.get<'asset'>(night.id, 'asset')!.collection).toBe(
			s.fantasyId
		);
	});

	it('Delete of unshared art confirms, then tombstones', async () => {
		const s = await setup();
		const own = s.ana.engine.binding(s.story.id)!.own;
		const stool = await upload(s.ana, own, 'stool', 'red', {kind: 'bg'});

		renderLibrary(s.story);
		await screen.findByText('stool');
		fireEvent.click(within(menu()).getByRole('button', {name: 'common.delete'}));

		const ask = await screen.findByRole('alertdialog');

		fireEvent.click(within(ask).getByRole('button', {name: 'common.delete'}));
		await waitFor(() => expect(s.ana.engine.get(stool.id, 'asset')).toBeUndefined());
	});

	it('Delete of shared art asks Update All only (no fork), then deletes for everyone', async () => {
		const s = await setup();
		const night = await upload(s.ana, s.tavernId, 'night', 'night', {kind: 'bg'});

		s.ana.engine.createStory('other', {name: 'Old Mill'});
		s.ana.engine.bind('other', [s.tavernId]);
		s.ana.engine.setRefs('other', [night.id]);
		await showTavern(s);
		await screen.findByText('night');
		fireEvent.click(within(menu()).getByRole('button', {name: 'common.delete'}));

		const prompt = await screen.findByTestId('library-shared-prompt');

		expect(
			within(prompt).queryByRole('button', {name: 'dialogs.assetEditor.sharedFork'})
		).not.toBeInTheDocument();
		fireEvent.click(
			within(prompt).getByRole('button', {name: 'dialogs.library.deleteForEveryone'})
		);
		await waitFor(() => expect(s.ana.engine.get(night.id, 'asset')).toBeUndefined());
	});

	it('Rename of shared art asks; Fork renames a copy, the original keeps its name', async () => {
		const s = await setup();
		const night = await upload(s.ana, s.tavernId, 'night', 'night', {kind: 'bg'});

		await showTavern(s);
		await screen.findByText('night');
		fireEvent.click(within(menu()).getByRole('button', {name: 'common.rename'}));
		fireEvent.change(await screen.findByDisplayValue('night'), {
			target: {value: 'late'}
		});
		fireEvent.click(screen.getByRole('button', {name: 'common.ok'}));

		const prompt = await screen.findByTestId('library-shared-prompt');

		fireEvent.click(
			within(prompt).getByRole('button', {name: 'dialogs.assetEditor.sharedFork'})
		);

		const own = s.ana.engine.binding(s.story.id)!.own;

		await waitFor(() => expect(byName(s.ana, own, 'late')).toBeDefined());
		expect(s.ana.engine.get<'asset'>(night.id, 'asset')!.name).toBe('night');
	});
});

describe('upload dupe dialog', () => {
	function drop(files: File[]) {
		const zone = document.querySelector('.upload-drop-zone')!;

		fireEvent.drop(zone, {dataTransfer: dataTransfer({}, files)});
	}

	function file(name: string) {
		return new File([png('red', 4, 4)], name, {type: 'image/png'});
	}

	async function setupDupe() {
		const s = await setup();

		// Bytes already in tavern-set, not attached.
		await s.ana.engine.addAsset(png('red', 4, 4), 'image/png', {
			collection: s.tavernId,
			kind: 'bg',
			name: 'tavern-night'
		});
		renderLibrary(s.story);
		await screen.findByRole('button', {name: 'dialogs.library.newCollection'});

		return s;
	}

	it('exact match defaults to a new name on the same blob', async () => {
		const s = await setupDupe();
		const own = s.ana.engine.binding(s.story.id)!.own;

		await act(async () => drop([file('inn.png')]));

		const dialog = await screen.findByRole('alertdialog', {
			name: 'dialogs.library.dupe.title'
		});

		expect(within(dialog).getByRole('radio', {checked: true})).toHaveAttribute(
			'value',
			'alias'
		);
		fireEvent.change(within(dialog).getByRole('textbox', {name: 'dialogs.library.dupe.aliasName'}), {
			target: {value: 'inn-night'}
		});
		fireEvent.click(within(dialog).getByRole('button', {name: 'common.ok'}));
		await waitFor(() => expect(byName(s.ana, own, 'inn-night')).toBeDefined());
		expect(byName(s.ana, own, 'inn-night')!.blob).toBe(
			byName(s.ana, s.tavernId, 'tavern-night')!.blob
		);
	});

	it('use existing attaches its collection and adds nothing', async () => {
		const s = await setupDupe();

		await act(async () => drop([file('inn.png')]));

		const dialog = await screen.findByRole('alertdialog', {
			name: 'dialogs.library.dupe.title'
		});

		fireEvent.click(within(dialog).getByRole('radio', {name: /dupe.useAttach/}));
		fireEvent.click(within(dialog).getByRole('button', {name: 'common.ok'}));
		await waitFor(() =>
			expect(s.ana.engine.binding(s.story.id)!.collections).toEqual([s.tavernId])
		);
		expect(s.ana.engine.assets().length).toBe(1);
	});

	it('upload anyway makes a separate asset; cancel makes none', async () => {
		const s = await setupDupe();
		const own = s.ana.engine.binding(s.story.id)!.own;

		await act(async () => drop([file('inn.png')]));

		let dialog = await screen.findByRole('alertdialog', {
			name: 'dialogs.library.dupe.title'
		});

		fireEvent.click(within(dialog).getByRole('radio', {name: 'dialogs.library.dupe.separate'}));
		fireEvent.click(within(dialog).getByRole('button', {name: 'common.ok'}));
		await waitFor(() => expect(byName(s.ana, own, 'inn')).toBeDefined());

		await act(async () => drop([file('again.png')]));
		dialog = await screen.findByRole('alertdialog', {
			name: 'dialogs.library.dupe.title'
		});
		fireEvent.click(within(dialog).getByRole('button', {name: 'common.cancel'}));
		await waitFor(() =>
			expect(
				screen.queryByRole('alertdialog', {name: 'dialogs.library.dupe.title'})
			).not.toBeInTheDocument()
		);
		expect(byName(s.ana, own, 'again')).toBeUndefined();
	});

	it('a pixel match says "looks like" and defaults to separate', async () => {
		const s = await setup();
		const asset = (await s.ana.engine.addAsset(png('red', 4, 4), 'image/png', {
			collection: s.tavernId,
			kind: 'bg',
			name: 'tavern-night'
		})).asset as AssetRecord;

		// Same pixels, different bytes: pretend the library holds a re-encode.
		s.ana.engine.updateAsset(asset.id, {blob: asset.blob.replace(/^./, '0')}, {override: true});
		renderLibrary(s.story);
		await screen.findByRole('button', {name: 'dialogs.library.newCollection'});
		await act(async () => drop([file('inn.png')]));

		const dialog = await screen.findByRole('alertdialog', {
			name: 'dialogs.library.dupe.title'
		});

		expect(dialog).toHaveTextContent('dialogs.library.dupe.looksLike');
		expect(within(dialog).getByRole('radio', {checked: true})).toHaveAttribute(
			'value',
			'separate'
		);
		expect(within(dialog).queryByRole('textbox')).not.toBeInTheDocument();
	});
});
