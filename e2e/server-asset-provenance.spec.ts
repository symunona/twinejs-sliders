/**
 * Asset PROVENANCE across two editors: the edit settings and the sidecar blobs that
 * travel beside an asset's pixels.
 *
 * Every layer of this has unit tests. What none of them can show is the only claim that
 * matters: Alice changes an edit, the server takes it, Bob's library ends up holding it.
 * That path runs through `syncStoryAssets`, a real Go server, the change bus,
 * `pullStoryAssets`, `checkoutAssets` and `applySyncedProvenance`, and a break anywhere in
 * it is silent — the far side still sees a picture, it just never learns of the edit.
 *
 * Two of the tests below are `test.fail()`. Both are real defects this spec found, both
 * are described where they sit, and both are written as the behaviour that is WANTED, so
 * the day one is fixed the suite goes red and says so.
 *
 * ## Reading a library
 *
 * The assertions go against the real `AssetStore`, reached in the page. The store is not
 * on `window` the way `__slidersSync` is, so `libraryAssets` dynamically imports the
 * module that owns it. Under vite that resolves to the module the app itself imported, so
 * `slidersAssetStore(storyId)` hands back the editor's OWN store instance rather than a
 * second one over the same bytes — there is no cache to go stale between a write in the
 * app and a read here. Parsing the OPFS manifest by hand was the alternative, and it would
 * assert against this suite's copy of the storage layout instead of against the store.
 *
 * ## Ids
 *
 * Bob's asset ids are not Alice's. Two libraries mint their own and `planBundle` re-ids on
 * collision, so an id is the one field guaranteed to differ. Everything here finds an
 * asset by NAME and compares blobs by content hash.
 *
 * ## Why provenance is written through the store and not through the asset editor
 *
 * Two reasons, and neither is convenience.
 *
 * A real `cutout` is the output of a 168 MB ONNX model that wants WebGPU and takes seconds
 * to minutes — `sliders-asset-editor.spec.ts` skips that path entirely unless
 * `SLIDERS_WEBGPU` is set, and a sync suite must not need a GPU.
 *
 * And every save the asset editor offers re-renders the picture, so its bytes and its hash
 * MOVE. That is a different case from the one these commits are about (`needsPull`'s
 * second half is "the bytes are here, the provenance is not"), and — see the last test —
 * it is currently broken for its own unrelated reason. Driving the two through one save
 * would mean neither could be read.
 *
 * So the writes below go through the same `store.replace` / `store.update` calls
 * `handleReplace` makes, with the asset's own bytes handed back so the hash stands still.
 * Everything the commits changed — hashing a sidecar, the per-kind sync policy, the
 * upload, the manifest entry, the diff, the download, the landing, the deletion — is
 * downstream of those calls and runs for real.
 *
 * Nothing here sleeps except the one place in "no ping-pong" that has to, and that place
 * says why.
 */

import type {Locator, Page} from '@playwright/test';
import type {Editor} from './server-helpers';
import {
	assetFixture,
	enterStory,
	expect,
	expectSyncState,
	ghostCard,
	goToLibrary,
	newStory,
	openAssetManager,
	openPassageEditor,
	publishStory,
	refreshServer,
	test,
	typePassage,
	uploadAssets,
	waitForLibrary,
	type TestServer
} from './server-helpers';

const STORY = 'Lighthouse';
const ASSET = 'street-dusk';

/** A scene that names the art, so the push has something to resolve as well as to carry. */
const SCENE_TEXT = `[scene]
id: street
bg: street-dusk
`;

/** What `seedCutout` writes, and what the far side must end up agreeing with. */
const TUNING = {softness: 0.3, threshold: 0.5};

/**
 * The module that owns the per-story asset store, by the path vite serves it at.
 *
 * A variable and not a literal inside the `import()` below: a literal is a specifier
 * TypeScript resolves from THIS file, where `/src/...` means nothing. The import happens
 * in the page, against the dev server's module graph.
 */
const STORE_MODULE = '/src/dialogs/sliders-assets/asset-store-context.tsx';

// ---------------------------------------------------------------------------
// Reading a library through the store the editor is using
// ---------------------------------------------------------------------------

interface SidecarView {
	/** What the manifest records. */
	hash?: string;
	bytes?: number;
	/** SHA-256 of the blob the store hands back, or undefined when it has none. */
	blobHash?: string;
}

interface AssetView {
	id: string;
	name: string;
	hash: string;
	edits?: {brightness: number; contrast: number; gamma: number};
	origin?: {x: number; y: number};
	tuning?: {softness: number; threshold: number};
	/** Every kind the manifest names, with the blob behind it. */
	sidecars: Record<string, SidecarView>;
}

/**
 * One editor's whole asset library: manifest entries and sidecar bytes together.
 *
 * The sidecar blob is read back through `store.sidecar(id, kind)` and hashed here rather
 * than trusted from the entry. A manifest row promising a blob that is not on disk is
 * exactly what "the cutout arrived" has to rule out, and it is what a half-landed pull
 * would leave behind.
 */
async function libraryAssets(
	page: Page,
	storyId: string
): Promise<AssetView[]> {
	return page.evaluate(
		async ({id, modulePath}) => {
			const module = await import(modulePath);
			const store = module.slidersAssetStore(id);
			const digest = async (blob: Blob) =>
				Array.from(
					new Uint8Array(
						await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
					)
				)
					.map(byte => byte.toString(16).padStart(2, '0'))
					.join('');
			const views = [];

			for (const meta of await store.list({includePoseImages: true})) {
				const sidecars: Record<string, unknown> = {};

				for (const [kind, entry] of Object.entries(meta.sidecars ?? {})) {
					const blob = await store.sidecar(meta.id, kind);

					sidecars[kind] = {
						blobHash: blob ? await digest(blob) : undefined,
						bytes: (entry as {bytes?: number})?.bytes,
						hash: (entry as {hash?: string})?.hash
					};
				}

				views.push({
					edits: meta.edits,
					hash: meta.hash,
					id: meta.id,
					name: meta.name,
					origin: meta.origin,
					sidecars,
					tuning: meta.tuning
				});
			}

			return views as unknown[];
		},
		{id: storyId, modulePath: STORE_MODULE}
	);
}

/** The one asset called `name`, from whichever editor's page is asked. */
async function assetNamed(
	page: Page,
	storyId: string,
	name: string
): Promise<AssetView | undefined> {
	return (await libraryAssets(page, storyId)).find(
		asset => asset.name === name
	);
}

interface ServerManifest {
	rev: number;
	assets: AssetView[];
}

/**
 * The manifest the server holds, asked from the test process rather than the browser.
 *
 * The middle of every claim below. Without it a failure on Bob's side cannot say whether
 * Alice never pushed or Bob never pulled, and this spec found one of each.
 */
async function serverManifest(
	server: TestServer,
	storyId: string
): Promise<ServerManifest> {
	const response = await server.api(`/api/v1/stories/${storyId}/assets`);

	if (!response.ok) {
		return {assets: [], rev: -1};
	}

	const body = (await response.json()) as Partial<ServerManifest>;

	return {assets: body.assets ?? [], rev: body.rev ?? -1};
}

/** The manifest rev. The last word on whether anything is still pushing. */
async function manifestRev(
	server: TestServer,
	storyId: string
): Promise<number> {
	return (await serverManifest(server, storyId)).rev;
}

// ---------------------------------------------------------------------------
// Writing provenance the way a save does, without moving the bytes
// ---------------------------------------------------------------------------

/**
 * Give an asset the adjustment settings and the anchor an editor save would leave on it.
 *
 * `store.replace` with the asset's own bytes for `edits`, then `store.update` for
 * `origin` — the same two calls `handleReplace` makes, in the same order, and for the same
 * reason: the anchor is metadata and does not ride the bytes. `prepareUpload` hands the
 * unchanged bytes straight back, so the hash stands still and this is a provenance-only
 * change, which is the case these commits exist for.
 */
async function seedEdits(
	page: Page,
	storyId: string,
	name: string,
	gamma: number,
	origin: {x: number; y: number}
): Promise<void> {
	await page.evaluate(
		async ({assetName, id, modulePath, nextGamma, nextOrigin}) => {
			const module = await import(modulePath);
			const store = module.slidersAssetStore(id);
			const meta = (await store.list({includePoseImages: true})).find(
				(asset: {name: string}) => asset.name === assetName
			);

			if (!meta) {
				throw new Error(`No asset called "${assetName}" to edit.`);
			}

			const bytes = await store.get(meta.id);

			await store.replace(
				meta.id,
				new File([bytes], `${meta.name}.webp`, {type: meta.mime}),
				{
					edits: {
						brightness: 0,
						contrast: 0,
						crop: {h: meta.h, w: meta.w, x: 0, y: 0},
						gamma: nextGamma,
						height: meta.h,
						width: meta.w
					}
				}
			);
			await store.update(meta.id, {origin: nextOrigin});
			module.refreshAssetLibrary();
		},
		{
			assetName: name,
			id: storyId,
			modulePath: STORE_MODULE,
			nextGamma: gamma,
			nextOrigin: origin
		}
	);
}

/**
 * Give an asset a `cutout` sidecar and the tuning that goes with it, without the model.
 *
 * The map is half opaque and half clear and is packed the way `cutout-map.ts` packs one —
 * the alpha value in R, G and B of a fully opaque PNG — so it is a blob the editor could
 * decode rather than arbitrary bytes. `src` goes on at the same time, because a real save
 * writes both and because it is the kind that must NOT sync.
 *
 * Returns the SHA-256 of the cutout written, so the far side can be held to it.
 */
async function seedCutout(
	page: Page,
	storyId: string,
	name: string
): Promise<string> {
	return page.evaluate(
		async ({assetName, id, modulePath, tuning}) => {
			const module = await import(modulePath);
			const store = module.slidersAssetStore(id);
			const meta = (await store.list({includePoseImages: true})).find(
				(asset: {name: string}) => asset.name === assetName
			);

			if (!meta) {
				throw new Error(`No asset called "${assetName}" to cut out.`);
			}

			const bytes = await store.get(meta.id);
			const canvas = document.createElement('canvas');

			canvas.width = meta.w;
			canvas.height = meta.h;

			const context = canvas.getContext('2d')!;
			const image = context.createImageData(meta.w, meta.h);

			for (let y = 0; y < meta.h; y++) {
				for (let x = 0; x < meta.w; x++) {
					const at = (y * meta.w + x) * 4;
					const value = x < meta.w / 2 ? 0 : 255;

					image.data[at] = value;
					image.data[at + 1] = value;
					image.data[at + 2] = value;
					image.data[at + 3] = 255;
				}
			}

			context.putImageData(image, 0, 0);

			// PNG, never WebP: `toBlob` encodes WebP lossily, and a lossy mask frays at
			// exactly the edge the mask exists to describe.
			const cutout = await new Promise<Blob>((resolve, reject) =>
				canvas.toBlob(
					blob => (blob ? resolve(blob) : reject(new Error('No cutout blob'))),
					'image/png'
				)
			);

			await store.replace(
				meta.id,
				new File([bytes], `${meta.name}.webp`, {type: meta.mime}),
				{sidecars: {cutout, src: bytes}, tuning}
			);
			module.refreshAssetLibrary();

			return Array.from(
				new Uint8Array(
					await crypto.subtle.digest('SHA-256', await cutout.arrayBuffer())
				)
			)
				.map(byte => byte.toString(16).padStart(2, '0'))
				.join('');
		},
		{assetName: name, id: storyId, modulePath: STORE_MODULE, tuning: TUNING}
	);
}

/**
 * Undo the background removal: drop the cutout and the tuning that described it.
 *
 * `sidecars: {cutout: null}` is the whole of commit "cutout undo: null drops the sidecar"
 * — `undefined` would mean "I did not touch it" and leave the alpha map on disk and in the
 * manifest, which is how the manifest used to keep the server's orphan sweep off bytes
 * nobody wanted any more. `src` is deliberately not named, so it stays.
 */
async function undoCutout(
	page: Page,
	storyId: string,
	name: string
): Promise<void> {
	await page.evaluate(
		async ({assetName, id, modulePath}) => {
			const module = await import(modulePath);
			const store = module.slidersAssetStore(id);
			const meta = (await store.list({includePoseImages: true})).find(
				(asset: {name: string}) => asset.name === assetName
			);

			if (!meta) {
				throw new Error(`No asset called "${assetName}" to restore.`);
			}

			const bytes = await store.get(meta.id);

			await store.replace(
				meta.id,
				new File([bytes], `${meta.name}.webp`, {type: meta.mime}),
				{sidecars: {cutout: null}}
			);
			module.refreshAssetLibrary();
		},
		{assetName: name, id: storyId, modulePath: STORE_MODULE}
	);
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/**
 * Alice publishes a story with one picture in it; Bob checks it out and parks in it.
 *
 * Returns the story id, which is also the asset library's scope on both sides.
 */
async function shareStoryWithArt(
	alice: Editor,
	bob: Editor,
	server: TestServer
): Promise<string> {
	await newStory(alice.page, STORY);
	await uploadAssets(alice.page, [assetFixture(`${ASSET}.png`)]);
	await expect(
		alice.page.locator('.sliders-tile', {hasText: ASSET})
	).toBeVisible({timeout: 30000});
	await alice.page.keyboard.press('Escape');

	await openPassageEditor(alice.page, 'Untitled Passage');
	await typePassage(alice.page, SCENE_TEXT);

	await goToLibrary(alice.page);
	await publishStory(alice.page, STORY);
	await expectSyncState(alice.page, STORY, 'idle');

	// The manifest is written after the blobs it names, so one asset in the index means
	// the bytes are already up.
	await expect
		.poll(async () => (await server.storyNamed(STORY))?.assetCount ?? 0, {
			message: 'the picture never reached the server',
			timeout: 30000
		})
		.toBe(1);

	await refreshServer(bob.page);
	await expect(ghostCard(bob.page, STORY)).toBeVisible({timeout: 20000});
	await bob.page.getByTestId('ghost-checkout').click();
	await expect(bob.page.getByTestId('story-group-synced')).toContainText(
		STORY,
		{timeout: 60000}
	);
	// The card has to finish moving out of the ghost group before anything clicks it: a
	// select that lands mid-move leaves the Story tab's buttons disabled.
	await expect(ghostCard(bob.page, STORY)).toHaveCount(0, {timeout: 60000});

	const storyId = (await server.storyNamed(STORY))!.id;

	// `slidersAssetStore` is keyed by story id, not by the route, so Bob's library reads
	// fine from the library screen — and waiting here keeps the checkout's download off
	// the same tick as the click below.
	await expect
		.poll(async () => (await assetNamed(bob.page, storyId, ASSET))?.name, {
			message: "bob's checkout never brought the picture",
			timeout: 60000
		})
		.toBe(ASSET);

	await enterStory(bob.page, STORY);

	return storyId;
}

/**
 * Wait for Alice's library to be on the server, then make Bob go and get it.
 *
 * The reload is not decoration and it is not impatience. A provenance-only change moves
 * neither `assetCount` nor `assetBytes`, and those two numbers ARE the index signature
 * that gates the poll's pull (`use-server-sync.ts`, the effect on `index`). So the poll
 * can never see such a change — not on its 5 minute socket cadence, not when the author
 * clicks Refresh From Server — and the websocket `assets` event is the only wake-up there
 * is. That event is missed often enough to be the normal case, because writing a sidecar
 * broadcasts twice, once for the blob and once for the manifest, and the pull the first
 * one starts is still in flight when the second arrives, where `assetPulls` drops it.
 *
 * A reload recovers because a fresh mount has an empty signature map and first sight
 * counts as a change. The test named after this defect asserts the behaviour that is
 * wanted instead, and is expected to fail until it is fixed.
 */
async function bobFetchesAssets(
	bob: Editor,
	server: TestServer,
	storyId: string,
	expectOnServer: (manifest: ServerManifest) => boolean
): Promise<void> {
	await expect
		.poll(async () => expectOnServer(await serverManifest(server, storyId)), {
			message: "alice's change never reached the server",
			timeout: 60000
		})
		.toBe(true);

	await bob.page.reload();
	await waitForLibrary(bob.page);
}

// ---------------------------------------------------------------------------

test.describe('Assets: provenance across two editors', () => {
	/**
	 * Story 1. Alice's edit settings and her anchor reach Bob, and not merely the pixels.
	 *
	 * `edits` and `origin` are two halves of one claim and they travel differently. `edits`
	 * rides the save that writes the bytes; `origin` is metadata on a second call after it,
	 * and it is the field that never synced at all before these commits — the pull's
	 * question used to be "are the bytes here", an edited picture's bytes ARE here, and so
	 * the answer was "nothing to do" forever.
	 */
	test('Edit settings and the anchor reach the other editor', async ({
		alice,
		bob,
		server
	}) => {
		const storyId = await shareStoryWithArt(alice, bob, server);

		// Nothing is claimed yet, which is what makes the assertion below a change rather
		// than a coincidence.
		expect((await assetNamed(bob.page, storyId, ASSET))?.edits).toBeUndefined();

		await seedEdits(alice.page, storyId, ASSET, 1.6, {x: 0, y: 0});

		const edited = await assetNamed(alice.page, storyId, ASSET);

		expect(edited?.edits?.gamma).toBe(1.6);
		expect(edited?.origin).toEqual({x: 0, y: 0});

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.some(asset => asset.edits?.gamma === 1.6)
		);

		await expect
			.poll(
				async () => (await assetNamed(bob.page, storyId, ASSET))?.edits?.gamma,
				{message: "alice's edit settings never landed on bob", timeout: 60000}
			)
			.toBe(1.6);

		const landed = await assetNamed(bob.page, storyId, ASSET);

		expect(landed?.origin, 'the anchor is provenance too').toEqual({
			x: 0,
			y: 0
		});
		// The bytes never moved, which is the point: this is the case a pull keyed on
		// content alone answered "nothing to do" to, every time, forever.
		expect(landed?.hash).toBe(edited?.hash);
		// One `street-dusk`, not the old one plus a copy.
		expect(
			(await libraryAssets(bob.page, storyId)).filter(
				asset => asset.name === ASSET
			)
		).toHaveLength(1);
	});

	/**
	 * Story 2. The `cutout` blob itself crosses, readable, and `src` does not.
	 *
	 * Two claims in one test because they are one decision. `sidecarSyncs` is a per-kind
	 * allow list, and a test that only checked the cutout would pass just as happily if
	 * everything synced — including the un-edited original, routinely 16 MB, that is
	 * supposed to stay on the machine that made it.
	 */
	test('The cutout blob crosses and the src sidecar does not', async ({
		alice,
		bob,
		server
	}) => {
		const storyId = await shareStoryWithArt(alice, bob, server);
		const cutoutHash = await seedCutout(alice.page, storyId, ASSET);
		const source = await assetNamed(alice.page, storyId, ASSET);

		expect(source?.sidecars.cutout?.blobHash).toBe(cutoutHash);
		expect(source?.sidecars.src?.blobHash).toBeDefined();

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.some(asset => asset.sidecars?.cutout !== undefined)
		);

		await expect
			.poll(
				async () =>
					(
						await assetNamed(bob.page, storyId, ASSET)
					)?.sidecars.cutout?.blobHash,
				{message: 'the cutout never landed on bob', timeout: 60000}
			)
			.toBe(cutoutHash);

		const landed = await assetNamed(bob.page, storyId, ASSET);

		// Readable and not merely recorded: the manifest entry and the blob behind it
		// agree, so Bob can re-open the edit rather than only be told one happened.
		expect(landed?.sidecars.cutout?.hash).toBe(cutoutHash);
		expect(
			landed?.tuning,
			'settings without their map describe nothing'
		).toEqual(TUNING);
		expect(landed?.sidecars.src, 'src is not a syncing kind').toBeUndefined();
	});

	/**
	 * Story 3. The undo travels: Alice drops the cutout and Bob's goes too, manifest entry
	 * and blob together.
	 *
	 * The deletion is the feature. A pull that only ever ADDED would leave the far side
	 * holding an alpha map for a background that is back, and the manifest entry is what
	 * keeps the server's orphan sweep off those bytes — so the omission has to travel as a
	 * decision, not as silence.
	 */
	test('Undoing the cutout removes it on the other side too', async ({
		alice,
		bob,
		server
	}) => {
		const storyId = await shareStoryWithArt(alice, bob, server);
		const cutoutHash = await seedCutout(alice.page, storyId, ASSET);

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.some(asset => asset.sidecars?.cutout !== undefined)
		);
		await expect
			.poll(
				async () =>
					(
						await assetNamed(bob.page, storyId, ASSET)
					)?.sidecars.cutout?.blobHash,
				{message: 'the cutout never landed on bob', timeout: 60000}
			)
			.toBe(cutoutHash);

		await undoCutout(alice.page, storyId, ASSET);

		const restored = await assetNamed(alice.page, storyId, ASSET);

		expect(restored?.sidecars.cutout).toBeUndefined();
		expect(
			restored?.sidecars.src,
			'the undo drops one kind, not both'
		).toBeDefined();

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.every(asset => asset.sidecars?.cutout === undefined)
		);

		await expect
			.poll(
				async () =>
					(
						await assetNamed(bob.page, storyId, ASSET)
					)?.sidecars.cutout,
				{message: "bob's cutout never went away", timeout: 60000}
			)
			.toBeUndefined();

		// The tuning goes with it, and the picture stays.
		const landed = await assetNamed(bob.page, storyId, ASSET);

		expect(landed?.tuning).toBeUndefined();
		expect(landed?.name).toBe(ASSET);
	});

	/**
	 * Story 4, and the one no unit test can see: once the change has landed, the two
	 * editors go QUIET.
	 *
	 * A pull that reports a change fires a library refresh, which schedules a push, which
	 * moves the manifest rev, which wakes the other client into pulling. So a provenance
	 * comparison that can never be satisfied is not a slightly noisy diff; it is two
	 * browsers pushing art at each other every three seconds, on every synced story, until
	 * a tab is closed (ARCHITECTURE § Sync model, rule 3). The rev is where that shows, and
	 * one push after a landing pull is correct — it is the second and the twentieth that
	 * are the bug.
	 */
	test('Both editors go quiet once the edit has landed', async ({
		alice,
		bob,
		server
	}) => {
		// Proving quiet costs up to three 12s windows on top of a checkout, which on a
		// loaded box is more than the project's 180s.
		test.setTimeout(300000);

		const storyId = await shareStoryWithArt(alice, bob, server);
		const cutoutHash = await seedCutout(alice.page, storyId, ASSET);

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.some(asset => asset.sidecars?.cutout !== undefined)
		);
		await expect
			.poll(
				async () =>
					(
						await assetNamed(bob.page, storyId, ASSET)
					)?.sidecars.cutout?.blobHash,
				{message: 'the cutout never landed on bob', timeout: 60000}
			)
			.toBe(cutoutHash);

		// This is the one place in the suite that cannot wait on an observable, and it is
		// worth being exact about why: a rev that has not moved YET and a rev that never
		// will look identical, so only elapsed time tells them apart. The window is
		// 12s — four times ASSET_SYNC_DEBOUNCE_MS (3s), which covers both sides' debounce
		// plus a round trip between them.
		//
		// One window is not the test, though. The landing pull is ALLOWED one push: it
		// changed the library, and a library that changed is pushed. That push lands a
		// second or two after the blob does, and a single window opened before it would
		// read one legitimate write as a loop. So windows are taken until one of them comes
		// out still — a ping-pong never gives one, because it writes every three seconds
		// for as long as both tabs are open — and only then is the real assertion made,
		// over a second, independent window.
		let settled = 0;

		await expect
			.poll(
				async () => {
					const before = await manifestRev(server, storyId);

					await alice.page.waitForTimeout(12000);
					settled = await manifestRev(server, storyId);
					return settled === before;
				},
				{
					intervals: [0],
					message: 'the manifest rev never stopped moving',
					timeout: 120000
				}
			)
			.toBe(true);

		await alice.page.waitForTimeout(12000);

		expect(
			await manifestRev(server, storyId),
			'the two editors are still pushing art at each other'
		).toBe(settled);

		// And the silence is agreement rather than one side having thrown the sidecar away.
		expect(
			(await assetNamed(alice.page, storyId, ASSET))?.sidecars.cutout?.blobHash
		).toBe(cutoutHash);
		expect(
			(await assetNamed(bob.page, storyId, ASSET))?.sidecars.cutout?.blobHash
		).toBe(cutoutHash);
	});

	/**
	 * DEFECT, written as the behaviour that is wanted. A peer with the story open does not
	 * learn of a provenance-only change until its page is reloaded.
	 *
	 * Two things have to be wrong at once for this to bite, and both are:
	 *
	 * - The poll cannot see it. The index signature that gates an asset pull is
	 *   `assetCount:assetBytes`, and a provenance-only change moves neither — the server
	 *   sums `m.infos()`, which is the assets' own bytes and not their sidecars'. So the
	 *   signature is unchanged, the effect on `index` skips the story, and that is true of
	 *   the 30s poll, the 5 minute socket-up poll and the Refresh From Server button
	 *   alike. Measured: 30s of polling plus an explicit refresh, and Bob's library never
	 *   moved.
	 * - The socket event that COULD see it is routinely lost. Writing a sidecar broadcasts
	 *   `assets` twice, once for the blob PUT and once for the manifest PUT; the pull the
	 *   first one starts is still in flight when the second lands, and `pullAssets` drops a
	 *   re-entrant call rather than queueing it.
	 *
	 * Everything downstream is fine — the same change lands, blob and all, the moment the
	 * page is reloaded, which is what the four tests above use. So this is a wake-up bug,
	 * not a landing bug. The fix is on one of the two halves: put something in the index
	 * signature that a provenance change moves, or make a dropped pull re-arm itself.
	 */
	test('A peer sees a provenance change without reloading', async ({
		alice,
		bob,
		server
	}) => {
		test.fail();

		const storyId = await shareStoryWithArt(alice, bob, server);
		const cutoutHash = await seedCutout(alice.page, storyId, ASSET);

		await expect
			.poll(
				async () =>
					(
						await serverManifest(server, storyId)
					).assets.some(asset => asset.sidecars?.cutout !== undefined),
				{message: "alice's cutout never reached the server", timeout: 60000}
			)
			.toBe(true);

		// No reload and no Refresh click: the change bus is supposed to be enough, and it
		// is for story text (`server-sync.spec.ts`, "Edit flows across"). Bob is also sent
		// back to the library and asked to refresh, so this fails for the whole of what a
		// person can do short of reloading, not only for the passive path.
		await refreshServer(bob.page);

		await expect
			.poll(
				async () =>
					(
						await assetNamed(bob.page, storyId, ASSET)
					)?.sidecars.cutout?.blobHash,
				{
					message: 'a live peer never learned of the cutout',
					timeout: 60000
				}
			)
			.toBe(cutoutHash);
	});

	/**
	 * DEFECT, written as the behaviour that is wanted, and the worse of the two: overwriting
	 * a picture IN PLACE does not reach the other editor — and the other editor then pushes
	 * its stale library back, destroying the edit on the server.
	 *
	 * Observed, with the rev read every five seconds: Alice's save lands at rev 2, complete
	 * with the new hash, `edits` and `origin`. Bob pulls it, `planBundle` hits a name clash
	 * — his library already has a different image called `street-dusk` — and settles it the
	 * way it always has, by keeping the local copy and dropping the incoming one. The bytes
	 * never land, so `landProvenance` finds no twin for them and lands nothing either. But
	 * `changed` is `downloaded.length > 0`, and the download DID happen, so the pull reports
	 * a change, fires a library refresh, and pushes. Bob's manifest still describes the old
	 * picture. Rev 3 is Alice's edit gone.
	 *
	 * `changed` being read off what the store holds rather than off what the pull meant to
	 * do is exactly the rule the provenance half of this feature was careful about. The
	 * bytes half still reports the intent, and a download `planBundle` then discards is
	 * precisely where the two differ.
	 *
	 * This is the ordinary way an author edits art — crop it, brighten it, keep the name so
	 * the scenes that write `bg: street-dusk` follow along — so it is worth more than the
	 * cosmetic reading: today, doing that on one machine silently reverts it from the other.
	 */
	test('Overwriting a picture in place reaches the other editor', async ({
		alice,
		bob,
		server
	}) => {
		test.fail();

		const storyId = await shareStoryWithArt(alice, bob, server);

		await enterStory(alice.page, STORY);

		const assets = await openAssetManager(alice.page);

		await assets
			.locator('.sliders-tile', {hasText: ASSET})
			.getByRole('button', {name: 'Edit Image'})
			.click();

		const editor: Locator = alice.page.getByRole('dialog', {
			name: `Edit ${ASSET}`
		});

		// The canvas carries the pixels every control works on; a save before it exists
		// would write `edits` over nothing.
		await expect(editor.locator('.asset-editor-canvas canvas')).toBeVisible({
			timeout: 30000
		});
		await editor.getByRole('slider', {name: /Gamma/}).fill('1.6');
		// The anchor lives in the Sizing tool, and its nine presets beat clicking the
		// canvas: a preset is an exact fraction, so the value that arrives can be asserted
		// rather than approximated.
		await editor.getByRole('radio', {name: /^Sizing/}).click();
		await editor.getByRole('button', {name: 'Top left', exact: true}).click();
		await editor.getByRole('button', {name: 'Overwrite Original'}).click();
		await alice.page.getByRole('button', {name: 'OK', exact: true}).click();
		await expect(editor).toBeHidden({timeout: 30000});
		await alice.page.keyboard.press('Escape');

		const edited = await assetNamed(alice.page, storyId, ASSET);

		expect(edited?.edits?.gamma).toBe(1.6);
		expect(edited?.origin).toEqual({x: 0, y: 0});

		// Alice's push does land. Everything that fails, fails after this line.
		await expect
			.poll(
				async () =>
					(
						await serverManifest(server, storyId)
					).assets.find(asset => asset.name === ASSET)?.edits?.gamma,
				{message: "alice's edit never reached the server", timeout: 60000}
			)
			.toBe(1.6);

		await bobFetchesAssets(bob, server, storyId, manifest =>
			manifest.assets.some(asset => asset.edits?.gamma === 1.6)
		);

		await expect
			.poll(async () => (await assetNamed(bob.page, storyId, ASSET))?.hash, {
				message: 'the overwritten picture never landed on bob',
				timeout: 45000
			})
			.toBe(edited?.hash);
		expect((await assetNamed(bob.page, storyId, ASSET))?.edits?.gamma).toBe(
			1.6
		);
	});
});
