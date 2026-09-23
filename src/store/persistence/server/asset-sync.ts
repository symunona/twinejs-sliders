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

import {sidecarKey, sidecarSyncs} from '@sliders/asset-store';
import type {AssetStore} from '@sliders/asset-store';
import type {
	AssetId,
	AssetMeta,
	Character,
	SidecarKind
} from '@sliders/scene-types';
import {
	collectAssetRefs,
	resolveBundleRefs
} from '../../../util/sliders-bundle';
import type {Story} from '../../stories';
import type {ServerClient} from './client';
import {stable} from './stable-json';

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
	/** Sidecar keys (`<id>.<kind>`) whose bytes went up this time. */
	uploadedSidecars: string[];
	/** Asset ids the server already had. */
	skipped: string[];
	/** Ids the local store no longer has bytes for. Reported, never thrown. */
	missingLocally: string[];
	/**
	 * Sidecar keys the manifest names but this device cannot produce. Separate from
	 * `missingLocally` on purpose: a lost sidecar costs re-editability, a lost asset
	 * costs the picture, and a UI that says the same thing about both is lying about one.
	 */
	missingSidecars: string[];
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
 * One blob the server may need: an asset's own bytes, or a sidecar an asset owns.
 *
 * Both go through the same diff and the same upload loop, because to the server they are
 * the same thing — a blob keyed by a string, with a hash to compare. Keeping two loops
 * would mean two round trips and two chances for the rules to drift apart.
 */
interface UploadRow {
	/** What the server keys this blob by: an asset id, or `<id>.<kind>`. */
	key: string;
	hash: string;
	bytes: number;
	mime: string;
	/** The asset's name, for the progress readout. Sidecars borrow their owner's. */
	name: string;
	/** Absent for an asset's own bytes. */
	sidecar?: {id: AssetId; kind: SidecarKind};
}

/**
 * Every blob worth offering the server, assets first.
 *
 * A sidecar joins only when its kind syncs AND its entry carries a `hash`. Both halves
 * matter and for different reasons. The kind is the size policy — `src` is the un-edited
 * original, routinely 16 MB, and wanted by nothing but the device that made the edit.
 * The hash is what `diffAssets` compares: offering a hashless row would ask the server to
 * vouch for bytes nobody measured, it answers `stale` to that, and the blob re-uploads on
 * every single push.
 *
 * `sidecarSyncs(kind)` and NOT `entry.sync`. The field records what the policy was when
 * the entry was written; the predicate is what it is now. They agree today, and the day
 * they stop — a kind opted in after entries for it already existed — reading the field
 * would quietly keep every one of those out of the push, with nothing to show for it.
 */
function uploadRows(assets: AssetMeta[]): UploadRow[] {
	const rows: UploadRow[] = [];

	for (const meta of assets) {
		rows.push({
			bytes: meta.bytes,
			hash: meta.hash,
			key: meta.id,
			mime: meta.mime,
			name: meta.name
		});
	}

	for (const meta of assets) {
		for (const [kind, entry] of Object.entries(meta.sidecars ?? {})) {
			if (!sidecarSyncs(kind) || !entry?.hash) {
				continue;
			}

			rows.push({
				bytes: entry.bytes ?? 0,
				hash: entry.hash,
				key: sidecarKey(meta.id, kind),
				mime: entry.mime ?? 'application/octet-stream',
				name: meta.name,
				sidecar: {id: meta.id, kind}
			});
		}
	}

	return rows;
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
	const assets = await store.list({includePoseImages: true});
	const characters = await store.listCharacters();
	const fingerprint = manifestFingerprint(assets, characters);

	if (lastFingerprint !== undefined && lastFingerprint === fingerprint) {
		report({done: 1, phase: 'scan', total: 1});

		return {
			assetCount: assets.length,
			characterCount: characters.length,
			fingerprint,
			missingLocally: [],
			missingSidecars: [],
			rev: 0,
			skipped: assets.map(meta => meta.id),
			unchanged: true,
			unresolved: [],
			uploaded: [],
			uploadedSidecars: []
		};
	}

	const refs = collectAssetRefs(story);
	const resolved = await resolveBundleRefs(store, refs);

	report({done: 1, phase: 'scan', total: 1});
	report({done: 0, phase: 'diff', total: 1});

	const rows = uploadRows(assets);

	const diff = await client.diffAssets(
		story.id,
		rows.map(row => ({bytes: row.bytes, hash: row.hash, id: row.key}))
	);

	report({done: 1, phase: 'diff', total: 1});

	// `stale` is present-under-a-different-hash, which for our purposes is missing: the
	// bytes the manifest names are not the bytes the server holds.
	const wanted = new Set([...diff.missing, ...diff.stale]);
	const toUpload = rows.filter(row => wanted.has(row.key));
	const uploaded: string[] = [];
	const uploadedSidecars: string[] = [];
	const missingLocally: string[] = [];
	const missingSidecars: string[] = [];

	for (const [index, row] of toUpload.entries()) {
		report({
			done: index,
			name: row.name,
			phase: 'upload',
			total: toUpload.length
		});

		const blob = row.sidecar
			? await store.sidecar(row.sidecar.id, row.sidecar.kind)
			: await store.get(row.key);

		if (!blob) {
			if (row.sidecar) {
				// A sidecar is a convenience — the finished picture is the asset's own bytes,
				// and those are uploaded above regardless. So a missing one is reported on its
				// own channel and costs the push nothing: the alternative, counting it among
				// the assets that are gone, would tell the author a picture had been lost
				// when only its re-edit base had.
				missingSidecars.push(row.key);
				continue;
			}

			// The manifest still names it. The server answers `missing` for it on the next
			// checkout, which is a truthful "this picture is gone" rather than a push that
			// refuses to finish.
			missingLocally.push(row.key);
			continue;
		}

		await client.putAssetBlob(story.id, row.key, blob, row.hash, row.mime);
		(row.sidecar ? uploadedSidecars : uploaded).push(row.key);
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
		missingSidecars,
		rev: result?.rev ?? 0,
		// Assets only. `skipped` answers "which pictures did the server already have",
		// and a sidecar is not a picture.
		skipped: assets.map(meta => meta.id).filter(id => !wanted.has(id)),
		unchanged: false,
		unresolved: resolved.unresolved,
		uploaded,
		uploadedSidecars
	};
}
