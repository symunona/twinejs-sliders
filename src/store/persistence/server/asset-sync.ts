/**
 * Pushing a story's art: work out what the story actually references, ask the server what
 * it is missing, upload only that, then write the manifest (spec 11).
 *
 * The reference scan is `collectAssetRefs` + `resolveBundleRefs`, unchanged — the same two
 * functions `.sliders.zip` export uses. A second implementation of "which assets does this
 * story need" would drift, and the way it would drift is by shipping a story whose
 * backgrounds are missing on the other side.
 *
 * Uploads are strictly one at a time. Six parallel 8 MB PUTs is how you get a proxy to
 * start dropping them, and there is nothing to gain: the manifest cannot be written until
 * the last blob has landed anyway.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta} from '@sliders/scene-types';
import {
	collectAssetRefs,
	resolveBundleRefs
} from '../../../util/sliders-bundle';
import type {Story} from '../../stories';
import type {ServerClient} from './client';

export interface AssetSyncProgress {
	phase: 'scan' | 'diff' | 'upload' | 'manifest';
	done: number;
	total: number;
	/** Name of the asset being uploaded, when there is one. */
	name?: string;
}

export interface AssetSyncResult {
	/** Asset ids whose bytes went up this time. */
	uploaded: string[];
	/** Asset ids the server already had. */
	skipped: string[];
	/** Ids the local store no longer has bytes for. Reported, never thrown. */
	missingLocally: string[];
	/** Names written in scene YAML that resolve to nothing here. */
	unresolved: string[];
	/** Rev of the manifest after the write. */
	rev: number;
	assetCount: number;
	characterCount: number;
}

export interface SyncStoryAssetsOptions {
	client: ServerClient;
	story: Story;
	store: AssetStore;
	/** Manifest rev this client last saw, for `If-Match`. */
	ifMatch?: number;
	onProgress?: (progress: AssetSyncProgress) => void;
}

export async function syncStoryAssets(
	options: SyncStoryAssetsOptions
): Promise<AssetSyncResult> {
	const {client, ifMatch, onProgress, story, store} = options;
	const report = (progress: AssetSyncProgress) => onProgress?.(progress);

	report({done: 0, phase: 'scan', total: 1});

	const refs = collectAssetRefs(story);
	const resolved = await resolveBundleRefs(store, refs);

	report({done: 1, phase: 'scan', total: 1});
	report({done: 0, phase: 'diff', total: 1});

	const diff = await client.diffAssets(
		story.id,
		resolved.assets.map(meta => ({
			bytes: meta.bytes,
			hash: meta.hash,
			id: meta.id
		}))
	);

	report({done: 1, phase: 'diff', total: 1});

	// `stale` is present-under-a-different-hash, which for our purposes is missing: the
	// bytes the manifest names are not the bytes the server holds.
	const wanted = new Set([...diff.missing, ...diff.stale]);
	const byId = new Map<string, AssetMeta>(
		resolved.assets.map(meta => [meta.id, meta])
	);
	const toUpload = resolved.assets.filter(meta => wanted.has(meta.id));
	const uploaded: string[] = [];
	const missingLocally: string[] = [];

	for (const [index, meta] of toUpload.entries()) {
		report({
			done: index,
			name: meta.name,
			phase: 'upload',
			total: toUpload.length
		});

		const blob = await store.get(meta.id);

		if (!blob) {
			// The manifest still names it. The server answers `missing` for it on the next
			// checkout, which is a truthful "this picture is gone" rather than a push that
			// refuses to finish.
			missingLocally.push(meta.id);
			continue;
		}

		await client.putAssetBlob(story.id, meta.id, blob, meta.hash, meta.mime);
		uploaded.push(meta.id);
	}

	report({done: toUpload.length, phase: 'upload', total: toUpload.length});
	report({done: 0, phase: 'manifest', total: 1});

	// Manifest last, always: it is the index a checkout reads, and one that names bytes
	// nobody has uploaded yet turns a race into a broken story.
	const result = await client.putManifest(
		story.id,
		{
			assets: resolved.assets,
			characters: resolved.characters,
			version: 1
		},
		ifMatch
	);

	report({done: 1, phase: 'manifest', total: 1});

	return {
		assetCount: resolved.assets.length,
		characterCount: resolved.characters.length,
		missingLocally,
		rev: result?.rev ?? 0,
		skipped: [...byId.keys()].filter(id => !wanted.has(id)),
		unresolved: resolved.unresolved,
		uploaded
	};
}
