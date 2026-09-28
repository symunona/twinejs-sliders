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
 *
 * Guard 2 asks about bytes AND about provenance. Bytes alone was the original question
 * and it was too narrow by exactly one case, the common one: an author edits a picture on
 * one machine, and the second machine — which already holds those bytes, under a
 * different id, under a different name — decided it had nothing to do and never learned
 * that the edit existed, let alone how to undo it. Which fields are compared, and the
 * reason each excluded one is excluded, is `AssetProvenance` in `checkout-story.ts`. That
 * list is load-bearing: widen it and the guard stops guarding.
 */

import type {AssetStore} from '@sliders/asset-store';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {upgradeCharacter} from '@sliders/scene-types';
import {
	checkoutAssets,
	dedupeKey,
	fastForwardOf,
	provenanceOf,
	sameProvenance,
	serverHashes
} from './checkout-story';
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
	/**
	 * Sidecar keys (`<id>.<kind>`) the manifest named and the server would not hand over.
	 * Its own channel for the reason `asset-sync.ts` keeps one: a lost sidecar costs the
	 * ability to re-open an edit, a lost asset costs the picture, and a report that says
	 * the same thing about both is lying about one of them.
	 */
	missingSidecars: string[];
	warnings: string[];
	/**
	 * The local library actually gained something — bytes, a character, or another
	 * device's edit settings. ONLY then is a library refresh worth firing: a refresh
	 * schedules a push, and a push that uploads nothing still writes a manifest, which is
	 * another client's cue to pull.
	 *
	 * Read off what the store HOLDS after the pull, never off what the pull meant to do.
	 * `landProvenance` re-reads each asset it writes for exactly that reason.
	 */
	changed: boolean;
	/** Nothing was fetched at all — same rev, or nothing missing locally. */
	skipped: boolean;
}

export interface PullStoryAssetsResult extends AssetPullResult {
	/**
	 * Asset id → hash this client now agrees with the server on. Keep it and pass it back
	 * as `syncedHashes`. Echoes the input when no manifest was read or the rev had not
	 * moved -- nothing was learned, so the old base stands.
	 */
	syncedHashes: Map<string, string>;
	/**
	 * LOCAL asset id → name this client now agrees with the server on. Keep it and pass
	 * it back as `syncedNames`. See `followRenames`.
	 */
	syncedNames: Map<string, string>;
	/** LOCAL ids this run renamed to the server's name. */
	renamed: string[];
}

export interface PullStoryAssetsOptions {
	client: ServerClient;
	storyId: string;
	store: AssetStore;
	/** `rev` from the last pull or push of this story's manifest. */
	lastRev?: number;
	onProgress?: (progress: AssetPullProgress) => void;
	/**
	 * Asset id → hash as of this client's last successful pull or push, in memory only.
	 * Tells "the server replaced these bytes" from "I did". See `fastForwardOf`.
	 */
	syncedHashes?: ReadonlyMap<string, string>;
	/**
	 * LOCAL asset id → name as of this client's last pull or push, in memory only. Tells
	 * "the server renamed this" from "I did". See `followRenames`.
	 */
	syncedNames?: ReadonlyMap<string, string>;
}

/**
 * Brings the server's asset NAMES down onto the local twins that hold the same bytes.
 *
 * A name is not a cosmetic label: scene YAML addresses art by it, and the story text that
 * syncs verbatim is written against the server's names. Left out of the compare -- as it
 * was, `AssetProvenance` excludes it -- a rename on one machine reached the server and
 * stopped there. The other machine kept drawing `? prop drone-side` against text that said
 * `drone-side`, and its next push wrote its stale name back over the rename.
 *
 * Three-way, like `fastForwardOf` for bytes. `syncedNames` is the name both sides last
 * agreed on. The local name still equal to it (or no base at all -- a fresh tab) means
 * the server moved and this side follows. A local name that moved off it is a rename this
 * side made and has not pushed yet: kept, and the push carries it. So two machines settle
 * on the last rename written, and one that changed nothing never pushes a name back.
 *
 * No ping-pong: a rename here reports `changed`, the push that follows writes the same
 * names, and the other side finds nothing to follow.
 *
 * Pose images are skipped: their names are derived from the character and the pose, and
 * the cast compare owns them. A twin is matched by id first, then by bytes only when the
 * pairing is unambiguous -- two manifest rows or two local assets with the same bytes
 * could otherwise trade names on every pull.
 */
async function followRenames(
	manifest: AssetManifest,
	store: AssetStore,
	syncedNames?: ReadonlyMap<string, string>
): Promise<{
	renamed: string[];
	syncedNames: Map<string, string>;
	warnings: string[];
}> {
	const agreed = new Map(syncedNames ?? []);
	const renamed: string[] = [];
	const warnings: string[] = [];
	const serverMissing = new Set(manifest.missing ?? []);
	const rows = (manifest.assets ?? []).filter(
		meta => !serverMissing.has(meta.id) && !meta.ownerCharacter
	);
	const local = (await store.list({includePoseImages: true})).filter(
		meta => !meta.ownerCharacter
	);
	const localByKey = new Map<string, AssetMeta[]>();
	const rowsPerKey = new Map<string, number>();

	for (const meta of local) {
		localByKey.set(dedupeKey(meta), [
			...(localByKey.get(dedupeKey(meta)) ?? []),
			meta
		]);
	}

	for (const row of rows) {
		rowsPerKey.set(dedupeKey(row), (rowsPerKey.get(dedupeKey(row)) ?? 0) + 1);
	}

	const used = new Set<string>();

	for (const row of rows) {
		const candidates = localByKey.get(dedupeKey(row)) ?? [];
		const same = candidates.find(meta => meta.name === row.name);

		if (same) {
			agreed.set(same.id, same.name);
			used.add(same.id);
			continue;
		}

		const twin =
			candidates.find(meta => meta.id === row.id) ??
			(candidates.length === 1 && rowsPerKey.get(dedupeKey(row)) === 1
				? candidates[0]
				: undefined);

		if (!twin || used.has(twin.id)) {
			continue;
		}

		used.add(twin.id);

		const base = agreed.get(twin.id);

		if (base !== undefined && base !== twin.name) {
			// Renamed here since the last sync. The push will carry it.
			continue;
		}

		try {
			await store.update(twin.id, {name: row.name});
			renamed.push(twin.id);
			agreed.set(twin.id, row.name);
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);

			warnings.push(
				`"${twin.name}" was renamed to "${row.name}" on the server, but that ` +
					`name is taken here, so it kept its old name. (${reason})`
			);
		}
	}

	return {renamed, syncedNames: agreed, warnings};
}

/**
 * A character as the pull compares it: id plus pose NAMES.
 *
 * Deliberately not the asset ids. `planBundle` repoints an incoming pose image at whatever
 * local asset carries the same bytes, so two libraries holding the same artwork routinely
 * spell the same character with different ids — comparing those would report a change on
 * every poll and re-import the whole cast each time.
 */
function castShape(characters: Character[]): string {
	return characters
		.map(
			character =>
				`${character.id}:${Object.keys(upgradeCharacter(character).poses ?? {})
					.sort()
					.join(',')}`
		)
		.sort()
		.join('|');
}

/**
 * Which manifest entries are worth asking the server about: the ones whose bytes are not
 * here, and the ones whose bytes ARE here under someone else's provenance.
 *
 * The second half exists because an edit does not move an asset's bytes. Crop, brightness
 * and a background removal are all recorded beside the picture — `edits`, `tuning`, a
 * `cutout` sidecar — and the finished pixels are what the hash covers. Keyed on
 * `dedupeKey` alone, a machine that already holds those pixels answers "nothing to do"
 * every time, forever, and the author's second computer can look at the edited picture
 * but never re-open the edit.
 *
 * `dedupeKey` still does the MATCHING, though: ids diverge permanently between two
 * libraries, so the local twin is the asset with the same bytes and owner, never the one
 * with the same id. See `AssetProvenance` for the whole compared surface.
 *
 * Ids the server lists in `missing` are dropped from both halves. It is telling us it has
 * no bytes for them; the manifest row is all that is left of that asset, and comparing a
 * local twin against it would ask for a download that 404s on every poll.
 *
 * A row with no twin that is a newer version of a local asset THIS device replaced since
 * the last sync (`ahead`) is not wanted either: pulling it would undo the local edit, and
 * asking every poll would download bytes the checkout then drops.
 */
function needsPull(
	manifest: AssetManifest,
	local: AssetMeta[],
	syncedHashes?: ReadonlyMap<string, string>
): AssetMeta[] {
	const here = new Map<string, AssetMeta>();
	const byId = new Map(local.map(meta => [meta.id, meta]));
	const serverMissing = new Set(manifest.missing ?? []);

	for (const meta of local) {
		if (!here.has(dedupeKey(meta))) {
			here.set(dedupeKey(meta), meta);
		}
	}

	return (manifest.assets ?? []).filter(meta => {
		if (serverMissing.has(meta.id)) {
			return false;
		}

		const twin = here.get(dedupeKey(meta));

		if (!twin) {
			return fastForwardOf(meta, byId, syncedHashes)?.kind !== 'ahead';
		}

		return !sameProvenance(provenanceOf(meta), provenanceOf(twin));
	});
}

export async function pullStoryAssets(
	options: PullStoryAssetsOptions
): Promise<PullStoryAssetsResult> {
	const {client, lastRev, onProgress, store, storyId, syncedHashes} = options;
	const nothing = (
		rev: number,
		agreed: ReadonlyMap<string, string> = syncedHashes ?? new Map()
	): PullStoryAssetsResult => ({
		changed: false,
		downloaded: [],
		missing: [],
		missingSidecars: [],
		renamed: [],
		rev,
		skipped: true,
		syncedHashes: new Map(agreed),
		syncedNames: new Map(options.syncedNames ?? []),
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

	const local = await store.list({includePoseImages: true});
	const wanted = needsPull(manifest, local, syncedHashes);
	const castMoved =
		castShape(manifest.characters ?? []) !==
		castShape(await store.listCharacters());

	if (wanted.length === 0 && !castMoved) {
		// Every row agrees or is local-ahead; either way the server's hash is the base.
		// Bytes agreeing says nothing about names, though -- a rename moves no bytes.
		const names = await followRenames(manifest, store, options.syncedNames);

		if (names.renamed.length === 0 && names.warnings.length === 0) {
			return {
				...nothing(manifest.rev, serverHashes(manifest)),
				syncedNames: names.syncedNames
			};
		}

		return {
			changed: names.renamed.length > 0,
			downloaded: [],
			missing: [],
			missingSidecars: [],
			renamed: names.renamed,
			rev: manifest.rev,
			skipped: false,
			syncedHashes: serverHashes(manifest),
			syncedNames: names.syncedNames,
			warnings: names.warnings
		};
	}

	const {
		downloaded,
		fastForwarded,
		missingAssets,
		missingSidecars,
		provenanceApplied,
		stored,
		syncedHashes: agreed,
		warnings
	} = await checkoutAssets({
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
		storyId,
		syncedHashes
	});
	// After the checkout: an asset that just arrived already carries the server's name,
	// and a fast-forward may have been what made a twin findable at all.
	const names = await followRenames(manifest, store, options.syncedNames);

	return {
		// `stored` and `provenanceApplied`, never "we fetched something" or "something
		// differed". Both are read off what the library HOLDS once the pull is done.
		//
		// A fetched asset the plan then dropped -- its name taken locally by different
		// bytes -- used to count here, and it cost the other editor their work: the
		// change fired a refresh, the refresh scheduled a push, and the push wrote this
		// library's older manifest over the one they had just published. A sidecar the
		// server will not hand over is the same shape of mistake with a slower fuse: the
		// difference cannot be closed by any pull, so reporting it would push, wake the
		// peer, and arrive back here on the next rev with the same unfetchable blob. Both
		// stand unreported here and are named in `missingSidecars` and `warnings` instead.
		changed:
			stored.length > 0 ||
			fastForwarded.length > 0 ||
			provenanceApplied.length > 0 ||
			names.renamed.length > 0 ||
			castMoved,
		downloaded,
		missing: missingAssets,
		missingSidecars,
		renamed: names.renamed,
		rev: manifest.rev,
		skipped: false,
		syncedHashes: agreed,
		syncedNames: names.syncedNames,
		warnings: [...warnings, ...names.warnings]
	};
}
