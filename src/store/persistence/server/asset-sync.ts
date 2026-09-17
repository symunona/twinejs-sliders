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
import type {AssetMeta, Character} from '@sliders/scene-types';
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
	/**
	 * The library is byte-for-byte what `fingerprint` said last time, so nothing was
	 * uploaded and no manifest was written. The autosave path leans on this: it calls after
	 * every push, and almost every push follows a text edit that touched no art.
	 */
	unchanged: boolean;
	/** Pass back as `lastFingerprint` to get the skip above. */
	fingerprint: string;
}

export interface SyncStoryAssetsOptions {
	client: ServerClient;
	story: Story;
	store: AssetStore;
	/** Manifest rev this client last saw, for `If-Match`. */
	ifMatch?: number;
	/**
	 * `fingerprint` from the last successful sync of this story. Equal means skip, with no
	 * network at all. Only ever set it from a sync that finished — a run that uploaded
	 * blobs and then failed to write the manifest must not be remembered as done.
	 */
	lastFingerprint?: string;
	onProgress?: (progress: AssetSyncProgress) => void;
}

/**
 * Stable JSON, so the fingerprint does not move when a store implementation happens to
 * hand its keys back in a different order.
 */
function stable(value: unknown): string {
	if (Array.isArray(value)) {
		return `[${value.map(stable).join(',')}]`;
	}

	if (value && typeof value === 'object') {
		const entries = Object.entries(value as Record<string, unknown>)
			.filter(([, item]) => item !== undefined)
			.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));

		return `{${entries
			.map(([key, item]) => `${JSON.stringify(key)}:${stable(item)}`)
			.join(',')}}`;
	}

	return JSON.stringify(value) ?? 'null';
}

/** What a manifest write would say, as one comparable string. */
export function manifestFingerprint(
	assets: AssetMeta[],
	characters: Character[]
): string {
	return stable([
		[...assets].map(stable).sort(),
		[...characters].map(stable).sort()
	]);
}

export async function syncStoryAssets(
	options: SyncStoryAssetsOptions
): Promise<AssetSyncResult> {
	const {client, ifMatch, lastFingerprint, onProgress, story, store} = options;
	const report = (progress: AssetSyncProgress) => onProgress?.(progress);

	report({done: 0, phase: 'scan', total: 1});

	// The MANIFEST IS THE LIBRARY, not the subset the scenes happen to name today. Art is
	// uploaded before the scene that uses it is written at least as often as the other way
	// round, and a manifest built from `collectAssetRefs` drops exactly that art — the
	// author's picture is in the editor, absent from the server, and nothing says so.
	// References are still resolved below, but only to report the names that resolve to
	// nothing.
	const assets = await store.list({includeFrames: true});
	const characters = await store.listCharacters();
	const fingerprint = manifestFingerprint(assets, characters);

	if (lastFingerprint !== undefined && lastFingerprint === fingerprint) {
		report({done: 1, phase: 'scan', total: 1});

		return {
			assetCount: assets.length,
			characterCount: characters.length,
			fingerprint,
			missingLocally: [],
			rev: 0,
			skipped: assets.map(meta => meta.id),
			unchanged: true,
			unresolved: [],
			uploaded: []
		};
	}

	const refs = collectAssetRefs(story);
	const resolved = await resolveBundleRefs(store, refs);

	report({done: 1, phase: 'scan', total: 1});
	report({done: 0, phase: 'diff', total: 1});

	const diff = await client.diffAssets(
		story.id,
		assets.map(meta => ({
			bytes: meta.bytes,
			hash: meta.hash,
			id: meta.id
		}))
	);

	report({done: 1, phase: 'diff', total: 1});

	// `stale` is present-under-a-different-hash, which for our purposes is missing: the
	// bytes the manifest names are not the bytes the server holds.
	const wanted = new Set([...diff.missing, ...diff.stale]);
	const byId = new Map<string, AssetMeta>(assets.map(meta => [meta.id, meta]));
	const toUpload = assets.filter(meta => wanted.has(meta.id));
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
		{assets, characters, version: 1},
		ifMatch
	);

	report({done: 1, phase: 'manifest', total: 1});

	return {
		assetCount: assets.length,
		characterCount: characters.length,
		fingerprint,
		missingLocally,
		rev: result?.rev ?? 0,
		skipped: [...byId.keys()].filter(id => !wanted.has(id)),
		unchanged: false,
		unresolved: resolved.unresolved,
		uploaded
	};
}
