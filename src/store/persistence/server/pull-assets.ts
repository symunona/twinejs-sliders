/**
 * Pulling a story's art down AFTER the checkout that first brought it.
 *
 * Checkout was the only way art ever reached a client: `getAssetBlob` had exactly one
 * caller, and the `assets` websocket event only refreshed the index row's counts. So a
 * picture added by another editor — or by the CLI — never arrived in a browser that
 * already held the story. The card said "synced", the text kept flowing, and the stage
 * rendered `? bg forest` forever, with nothing in the UI able to fix it short of
 * unpublish-and-republish.
 *
 * The download itself is `checkoutAssets`, unchanged: same dedupe key, same
 * `planBundle`/`applyBundlePlan` rules. What this file adds is the decision to run it, and
 * that decision has to be cheap, because it is asked on every socket message and every
 * index poll. Two guards, in order:
 *
 * 1. The manifest REV. One small GET answers "has the server's art moved since the last
 *    time we looked", and almost always the answer is no.
 * 2. What the manifest holds versus what the local store holds. A rev can move for art
 *    this browser is the one that uploaded, so the rev alone would re-run the importer
 *    over a library that already matches.
 *
 * Guard 2 is what stops a ping-pong. A pull that changes the library fires
 * `refreshAssetLibrary`, and the sync hook pushes on that signal — so without it, two
 * clients would take turns pulling nothing and pushing a manifest at each other forever.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {checkoutAssets, dedupeKey} from './checkout-story';
import type {AssetDownloadProgress} from './checkout-story';
import type {ServerClient} from './client';
import type {AssetManifest} from './server.types';

export interface AssetPullProgress {
	phase: 'download';
	done: number;
	total: number;
}

export interface AssetPullResult {
	/** Manifest rev this ran against. Pass it back as `lastRev` next time. */
	rev: number;
	downloaded: string[];
	/** Ids the server could not hand over. Reported, never thrown. */
	missing: string[];
	warnings: string[];
	/**
	 * The local library actually gained something. ONLY then is a library refresh worth
	 * firing: a refresh schedules a push, and a push that uploads nothing still writes a
	 * manifest, which is another client's cue to pull.
	 */
	changed: boolean;
	/** Nothing was fetched at all — same rev, or nothing missing locally. */
	skipped: boolean;
}

export interface PullStoryAssetsOptions {
	client: ServerClient;
	storyId: string;
	store: AssetStore;
	/** `rev` from the last pull or push of this story's manifest. */
	lastRev?: number;
	onProgress?: (progress: AssetPullProgress) => void;
}

/**
 * A character as the pull compares it: id plus frame NAMES.
 *
 * Deliberately not the asset ids. `planBundle` repoints an incoming frame at whatever
 * local asset carries the same bytes, so two libraries holding the same artwork routinely
 * spell the same character with different ids — comparing those would report a change on
 * every poll and re-import the whole cast each time.
 */
function castShape(characters: Character[]): string {
	return characters
		.map(
			character =>
				`${character.id}:${Object.keys(character.frames ?? {})
					.sort()
					.join(',')}`
		)
		.sort()
		.join('|');
}

/** Which manifest entries have no local twin, and are worth asking the server for. */
function absentLocally(
	manifest: AssetManifest,
	local: AssetMeta[]
): AssetMeta[] {
	const here = new Set(local.map(dedupeKey));
	const serverMissing = new Set(manifest.missing ?? []);

	return (manifest.assets ?? []).filter(
		meta => !here.has(dedupeKey(meta)) && !serverMissing.has(meta.id)
	);
}

export async function pullStoryAssets(
	options: PullStoryAssetsOptions
): Promise<AssetPullResult> {
	const {client, lastRev, onProgress, store, storyId} = options;
	const nothing = (rev: number): AssetPullResult => ({
		changed: false,
		downloaded: [],
		missing: [],
		rev,
		skipped: true,
		warnings: []
	});

	let manifest: AssetManifest;

	try {
		manifest = await client.getManifest(storyId);
	} catch {
		// No manifest is the ordinary state of a story published before it had art. Not
		// worth an error row: the next pull asks again.
		return nothing(lastRev ?? 0);
	}

	if (lastRev !== undefined && manifest.rev === lastRev) {
		return nothing(manifest.rev);
	}

	const local = await store.list({includeFrames: true});
	const wanted = absentLocally(manifest, local);
	const castMoved =
		castShape(manifest.characters ?? []) !==
		castShape(await store.listCharacters());

	if (wanted.length === 0 && !castMoved) {
		return nothing(manifest.rev);
	}

	const {downloaded, missingAssets, warnings} = await checkoutAssets({
		client,
		manifest,
		onProgress: (progress: AssetDownloadProgress) =>
			onProgress?.({
				done: progress.done,
				phase: 'download',
				total: progress.total
			}),
		phase: 'download',
		store,
		storyId
	});

	return {
		changed: downloaded.length > 0 || castMoved,
		downloaded,
		missing: missingAssets,
		rev: manifest.rev,
		skipped: false,
		warnings
	};
}
