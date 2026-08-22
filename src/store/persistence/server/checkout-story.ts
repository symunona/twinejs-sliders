/**
 * Checking a server story out into the local library (spec 11).
 *
 * Text first, art after: the editor opens as soon as the passages land and the pictures
 * fill in behind it. Art is downloaded eagerly rather than on demand because a story whose
 * backgrounds resolve to nothing is indistinguishable, to the person looking at it, from a
 * story that is broken.
 *
 * The art half goes through `planBundle` / `applyBundlePlan` — the same rules bundle import
 * follows. Re-deriving "what happens when an incoming asset clashes with a local one" here
 * would be a second answer to a question spec 08 already settled, and the two would
 * disagree in exactly the case that loses someone's artwork.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta} from '@sliders/scene-types';
import {applyBundlePlan, planBundle} from '../../../util/sliders-bundle';
import type {BundleAsset} from '../../../util/sliders-bundle';
import {slidersAssetStore} from '../../../dialogs/sliders-assets/asset-store-context';
import {unusedName} from '../../../util/unused-name';
import type {StoriesDispatch, Story} from '../../stories';
import type {ServerClient} from './client';
import {storyHash, updateSyncRecord} from './sync-record';

export interface CheckoutProgress {
	phase: 'story' | 'assets';
	done: number;
	total: number;
}

export interface CheckoutResult {
	story: Story;
	rev: number;
	/** Asset ids the server has no bytes for, or could not send. Never thrown. */
	missingAssets: string[];
	/** Ids whose bytes actually came down the wire. */
	downloaded: string[];
	/** Everything `planBundle` wanted the author to know. */
	warnings: string[];
}

export interface CheckoutStoryOptions {
	client: ServerClient;
	storyId: string;
	dispatch: StoriesDispatch;
	/** Current local stories, for the id and name checks. */
	stories: Story[];
	/** Defaults to this story's own library. Injected in tests. */
	store?: AssetStore;
	onProgress?: (progress: CheckoutProgress) => void;
}

/**
 * `putAsset` treats two assets as the same file only when hash *and* owning character
 * match. Same key `planBundle` uses — see the note there.
 */
function dedupeKey(meta: Pick<AssetMeta, 'hash' | 'ownerCharacter'>): string {
	return `${meta.hash} ${meta.ownerCharacter ?? ''}`;
}

export async function checkoutStory(
	options: CheckoutStoryOptions
): Promise<CheckoutResult> {
	const {client, dispatch, onProgress, stories, storyId} = options;
	const store = options.store ?? slidersAssetStore(storyId);

	onProgress?.({done: 0, phase: 'story', total: 1});

	const fetched = await client.getStory(storyId);

	if (fetched === 'not-modified') {
		// Only sent when we ask with `If-None-Match`, which a checkout never does.
		throw new Error(
			'The server said the story was unchanged, but we have no copy.'
		);
	}

	const {rev, story} = fetched;
	const existing = stories.find(local => local.id === story.id);

	// The server's id and ifid are kept: they are what makes this the same story as
	// everyone else's copy. Only the name can be adjusted, and only because the reducer
	// silently refuses a duplicate name rather than failing loudly.
	const name = unusedName(
		story.name,
		stories.filter(local => local.id !== story.id).map(local => local.name)
	);
	const local: Story = {...story, name, sync: true};

	if (existing) {
		dispatch({props: {...local}, storyId: story.id, type: 'updateStory'});
	} else {
		dispatch({props: local, type: 'createStory'});
	}

	updateSyncRecord(story.id, {
		conflictClient: undefined,
		conflictRev: undefined,
		lastError: undefined,
		lastPulledAt: Date.now(),
		pushedHash: storyHash(local),
		rev,
		state: 'idle'
	});

	onProgress?.({done: 1, phase: 'story', total: 1});

	const {downloaded, missingAssets, warnings} = await checkoutAssets({
		client,
		onProgress,
		store,
		storyId: story.id
	});

	return {downloaded, missingAssets, rev, story: local, warnings};
}

/**
 * Downloads every asset the local store lacks and hands the lot to the bundle importer.
 *
 * Split out so the "resume a half-finished checkout" case is one call, and so tests can
 * drive the asset half without a stories dispatch.
 */
export async function checkoutAssets(options: {
	client: ServerClient;
	storyId: string;
	store: AssetStore;
	onProgress?: (progress: CheckoutProgress) => void;
}): Promise<{
	downloaded: string[];
	missingAssets: string[];
	warnings: string[];
}> {
	const {client, onProgress, store, storyId} = options;
	const missingAssets: string[] = [];
	const downloaded: string[] = [];
	let manifest;

	try {
		manifest = await client.getManifest(storyId);
	} catch (error) {
		// A story with no manifest yet is a story published before assets existed on it.
		// Nothing to download, and nothing worth failing the checkout over.
		return {downloaded, missingAssets, warnings: [messageOf(error)]};
	}

	const assets = manifest.assets ?? [];
	const serverMissing = new Set(manifest.missing ?? []);
	const total = assets.length;

	onProgress?.({done: 0, phase: 'assets', total});

	const localByKey = new Map<string, AssetMeta>();

	for (const meta of await store.list({includeFrames: true})) {
		if (!localByKey.has(dedupeKey(meta))) {
			localByKey.set(dedupeKey(meta), meta);
		}
	}

	const contents: BundleAsset[] = [];
	let done = 0;

	for (const meta of assets) {
		done += 1;

		if (serverMissing.has(meta.id)) {
			// The server told us up front it does not have these bytes — an old revision
			// whose art the orphan sweep took. Say so; do not try to fetch it.
			missingAssets.push(meta.id);
			onProgress?.({done, phase: 'assets', total});
			continue;
		}

		const twin = localByKey.get(dedupeKey(meta));

		if (twin) {
			// Already here. Its bytes still have to ride along in `contents`, because
			// `planBundle` builds the id map that repoints character frames from exactly
			// this list — leave it out and every frame pointing at it is dropped.
			const blob = await store.get(twin.id);

			if (blob) {
				contents.push({blob, meta});
				onProgress?.({done, phase: 'assets', total});
				continue;
			}
		}

		try {
			const blob = await client.getAssetBlob(storyId, meta.id);

			contents.push({blob, meta});
			downloaded.push(meta.id);
		} catch {
			// One picture that would not come down must not cost the author the other
			// thirty, or the story text. Report it and carry on.
			missingAssets.push(meta.id);
		}

		onProgress?.({done, phase: 'assets', total});
	}

	if (contents.length === 0 && (manifest.characters ?? []).length === 0) {
		return {downloaded, missingAssets, warnings: []};
	}

	const plan = await planBundle(store, {
		assets: contents,
		characters: manifest.characters ?? []
	});

	await applyBundlePlan(store, plan);

	return {downloaded, missingAssets, warnings: plan.warnings};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
