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
 *
 * Pixels are not the whole of an asset, though, and the bundle path carries only pixels.
 * An asset that has been through the asset editor also has `edits`, `tuning` and a
 * `cutout` sidecar, and `importAsset` strips all three on purpose — a bundle ships baked
 * bytes, so keeping the settings would tell the editor to render an edit the pixels
 * already contain. Sync is the opposite case: the sidecars can come down the wire too, so
 * they are fetched beside the picture and landed afterwards through
 * `applySyncedProvenance`. That is the difference between the far side SEEING an edit and
 * being able to UNDO it.
 */

import {sidecarKey, sidecarSyncs} from '@sliders/asset-store';
import type {AssetStore} from '@sliders/asset-store';
import type {
	AssetId,
	AssetMeta,
	CutoutTuning,
	Frac2,
	ImageEdits,
	SidecarKind
} from '@sliders/scene-types';
import {applyBundlePlan, planBundle} from '../../../util/sliders-bundle';
import type {BundleAsset} from '../../../util/sliders-bundle';
import {slidersAssetStore} from '../../../dialogs/sliders-assets/asset-store-context';
import {unusedName} from '../../../util/unused-name';
import type {StoriesDispatch, Story} from '../../stories';
import type {ServerClient} from './client';
import type {AssetManifest} from './server.types';
import {deleteSyncRecord, storyHash, updateSyncRecord} from './sync-record';
import {stable} from './stable-json';

export interface CheckoutProgress {
	phase: 'story' | 'assets';
	done: number;
	total: number;
}

/**
 * Downloading art, either half of it: `assets` is a checkout, which blocks the story card,
 * and `download` is a later pull into a story already on screen, which must not.
 */
export interface AssetDownloadProgress {
	phase: 'assets' | 'download';
	done: number;
	total: number;
}

export interface CheckoutResult {
	story: Story;
	rev: number;
	/** Asset ids the server has no bytes for, or could not send. Never thrown. */
	missingAssets: string[];
	/**
	 * Sidecar keys (`<id>.<kind>`) the manifest named and the server would not hand over.
	 * Separate from `missingAssets` for the reason `asset-sync.ts` keeps its own channel:
	 * a lost sidecar costs re-editability, a lost asset costs the picture.
	 */
	missingSidecars: string[];
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
export function dedupeKey(
	meta: Pick<AssetMeta, 'hash' | 'ownerCharacter'>
): string {
	return `${meta.hash} ${meta.ownerCharacter ?? ''}`;
}

// ---------------------------------------------------------------------------
// Provenance — what a synced asset carries besides its pixels
// ---------------------------------------------------------------------------

/**
 * The ONLY thing a pull compares between a manifest entry and the local asset holding the
 * same bytes, and the only thing it writes back: `edits`, `tuning`, `origin`, and the
 * content hash of every sidecar whose kind syncs.
 *
 * Every exclusion below is deliberate, and the reason is always the same one
 * (ARCHITECTURE § Sync model, rule 3). A pull that reports `changed` fires
 * `refreshAssetLibrary`, which schedules a push, which bumps the server's asset rev,
 * which wakes the other client's socket into pulling — unconditionally, with no signature
 * check. So a field that two libraries holding the same artwork differ on FOREVER is not
 * a slightly noisy comparison; it is two clients pushing art at each other every three
 * seconds, on every synced story, until a tab is closed.
 *
 * - `id`: libraries mint their own, and `planBundle` re-ids on collision. Assets are
 *   matched by `dedupeKey` — same bytes, same owner — and the manifest's id is never
 *   written onto a local asset.
 * - `sourceAsset`: an id too, remapped or dropped per library. Guaranteed to differ.
 * - `name`, `kind`, `tags`, `w`, `h`, `bytes`, `mime`, `animated`, `duration`:
 *   legitimately different names and measurements for the same bytes.
 *   `pull-assets.test.ts` pins exactly such a pair as "nothing to do".
 * - sidecars of a kind that does not sync: `src` is the unedited original, routinely
 *   16 MB, and `sidecarSyncs('src')` is false — so A's manifest names it and B's never
 *   can. Asymmetric by construction, permanently.
 * - sidecar entries with no `hash`: `migrateSidecars` turns the old `SidecarKind[]` into
 *   entries that name the blob and nothing else, because nothing ever measured it.
 *   `asset-sync.ts` will not upload one, so its bytes are not on the server and no pull
 *   could land them; hashed on one side and bare on the other, it would read as a
 *   difference that no round trip can ever close. "No hash" is therefore nothing to
 *   compare rather than a difference — which leaves such a sidecar exactly where it was
 *   before any of this existed, until the next save rewrites the entry with a hash.
 *
 * The kinds are chosen by `sidecarSyncs(kind)` and never by the entry's own `sync` field:
 * the predicate is the live policy, the field is a record of the policy when the entry
 * was written, and a migrated entry does not carry one at all.
 */
export interface AssetProvenance {
	edits?: ImageEdits;
	tuning?: CutoutTuning;
	origin?: Frac2;
	/** Syncable, hashed sidecar kinds only, by content hash. */
	sidecars: Record<string, string>;
}

/** The sidecars of `meta` that a pull can see at all: syncable kinds, by hash. */
export function syncableSidecarHashes(meta: AssetMeta): Record<string, string> {
	const hashes: Record<string, string> = {};

	for (const [kind, entry] of Object.entries(meta.sidecars ?? {})) {
		if (entry?.hash && sidecarSyncs(kind)) {
			hashes[kind] = entry.hash;
		}
	}

	return hashes;
}

/** An asset's provenance as it stands, local or incoming. */
export function provenanceOf(meta: AssetMeta): AssetProvenance {
	return {
		edits: meta.edits,
		origin: meta.origin,
		sidecars: syncableSidecarHashes(meta),
		tuning: meta.tuning
	};
}

export function sameProvenance(
	a: AssetProvenance,
	b: AssetProvenance
): boolean {
	return stable(a) === stable(b);
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

	// A checkout takes the server's copy wholesale, so whatever this browser thought it
	// knew about the story is void — including a rev left over from a different backend,
	// whose counter has nothing to do with this one's. Records are monotonic in `rev`
	// (`sync-record.ts`); dropping the record first is the explicit escape from that, the
	// same one `publish()` uses.
	deleteSyncRecord(story.id);
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

	const {downloaded, missingAssets, missingSidecars, warnings} =
		await checkoutAssets({
			client,
			onProgress: progress =>
				onProgress?.({
					done: progress.done,
					phase: 'assets',
					total: progress.total
				}),
			store,
			storyId: story.id
		});

	return {
		downloaded,
		missingAssets,
		missingSidecars,
		rev,
		story: local,
		warnings
	};
}

/**
 * Sidecar blobs for one manifest entry, by kind, plus whatever would not come down.
 *
 * Three filters, and each one removes a GET that could only end badly:
 *
 * - `sidecarSyncs(kind)`: the live policy, and never the entry's own `sync` field. That
 *   field records what the policy was when the entry was written, and a migrated entry
 *   has none at all — reading it would refuse to fetch a `cutout` that syncs today.
 * - `entry.hash`: `asset-sync.ts` refuses to upload a hashless entry, so its bytes are
 *   not on the server and the key names nothing. See `AssetProvenance`.
 * - a local twin already holding that kind at that hash: the bytes are here. The landing
 *   below reads them out of the store rather than off the wire.
 *
 * A sidecar that will not download is reported and costs the asset nothing — the finished
 * picture is the asset's own bytes, and those are fetched by the loop that calls this.
 */
async function fetchSidecars(options: {
	client: ServerClient;
	storyId: string;
	meta: AssetMeta;
	twin?: AssetMeta;
	missingSidecars: string[];
}): Promise<Map<SidecarKind, Blob>> {
	const {client, meta, missingSidecars, storyId, twin} = options;
	const blobs = new Map<SidecarKind, Blob>();
	const held = twin ? syncableSidecarHashes(twin) : {};

	for (const [kind, entry] of Object.entries(meta.sidecars ?? {})) {
		if (!entry?.hash || !sidecarSyncs(kind)) {
			continue;
		}

		if (held[kind] === entry.hash) {
			continue;
		}

		const key = sidecarKey(meta.id, kind);

		try {
			blobs.set(kind, await client.getAssetBlob(storyId, key));
		} catch {
			missingSidecars.push(key);
		}
	}

	return blobs;
}

/**
 * Lands another device's provenance onto the local assets holding the same bytes.
 *
 * Runs AFTER the bundle plan, over a freshly listed library, because both halves need it:
 * an asset the plan has just imported is stripped of `edits`, `tuning` and `sidecars` by
 * `importAsset` — correctly, a bundle ships baked bytes and no sidecars — and an asset
 * that was already here was never touched by the plan at all. Either way this is the only
 * step that makes the artwork re-editable on the far side.
 *
 * Matching is by `dedupeKey`, and the id handed to the store is the LOCAL one. The
 * manifest's id belongs to another library (see `AssetProvenance`).
 */
async function landProvenance(options: {
	assets: AssetMeta[];
	arrived: Map<string, Map<SidecarKind, Blob>>;
	store: AssetStore;
	warnings: string[];
}): Promise<string[]> {
	const {arrived, assets, store, warnings} = options;
	const applied: string[] = [];

	if (assets.length === 0) {
		return applied;
	}

	const localByKey = new Map<string, AssetMeta>();

	for (const meta of await store.list({includeFrames: true})) {
		if (!localByKey.has(dedupeKey(meta))) {
			localByKey.set(dedupeKey(meta), meta);
		}
	}

	const spokenFor = new Set<AssetId>();

	for (const incoming of assets) {
		const local = localByKey.get(dedupeKey(incoming));

		// No twin means the bytes did not land — a download that failed, or a name clash
		// `planBundle` settled in the local copy's favour. Nothing to put provenance on.
		// Two manifest entries with identical bytes and owner collapse onto one local
		// asset; first wins, as it does everywhere else the dedupe key is used.
		if (!local || spokenFor.has(local.id)) {
			continue;
		}

		const {blobs, target} = await landingFor(incoming, local, arrived, store);

		if (sameProvenance(target, provenanceOf(local))) {
			continue;
		}

		spokenFor.add(local.id);

		try {
			const stored = await store.applySyncedProvenance(local.id, {
				edits: target.edits,
				origin: target.origin,
				sidecars: blobs,
				tuning: target.tuning
			});

			// Rule 1 of the sync model in its asset form: what is reported is what the store
			// now holds, never what it was asked to hold. `changed` is read off this, and a
			// `changed` the library did not actually earn is the ping-pong — it would fire a
			// refresh, push, and come straight back round on the next rev.
			if (!sameProvenance(target, provenanceOf(stored))) {
				warnings.push(
					`The edit settings for "${local.name}" could not be brought over from the server. Its picture is fine; re-opening it in the asset editor may not start from where the other device left off.`
				);
				continue;
			}

			applied.push(local.id);
		} catch (error) {
			// Same bargain the download loop strikes: one asset whose settings would not
			// land must not cost the author the other thirty, or the story text.
			warnings.push(
				`The edit settings for "${local.name}" could not be saved: ${messageOf(
					error
				)}`
			);
		}
	}

	return applied;
}

/**
 * What this pull can actually put onto `local`, given which sidecar blobs it got hold of.
 *
 * The target is the incoming provenance, except that a syncable sidecar whose blob is
 * neither here nor arrived is left as it stands. The distinction is the difference
 * between the two things a manifest's silence can mean:
 *
 * - the manifest does not name the kind at all → the author deleted it. The blob is left
 *   out, `applySyncedProvenance` reconciles it away, and that is how "A undid the
 *   background removal" reaches B.
 * - the manifest names it and the bytes would not come down → nothing was undone, we just
 *   could not fetch it. Hand the store the blob it already has, so the reconcile does not
 *   read a failed GET as a deletion.
 *
 * A local sidecar with no hash is the one thing this loses. It is invisible to the compare
 * (see `AssetProvenance`), so it never causes a landing on its own — but it is not named
 * here either, so a landing for some other reason takes it with it. Deliberate: handing
 * the store the blob would have it measured and written back with a hash, which is a
 * difference on the NEXT pull and the same deletion one round later, after a push and a
 * wake-up on the far side. Only a `cutout` can be lost this way — `src` does not sync, and
 * `applySyncedProvenance` leaves kinds that do not sync alone.
 */
async function landingFor(
	incoming: AssetMeta,
	local: AssetMeta,
	arrived: Map<string, Map<SidecarKind, Blob>>,
	store: AssetStore
): Promise<{
	blobs: Partial<Record<SidecarKind, Blob>>;
	target: AssetProvenance;
}> {
	const here = syncableSidecarHashes(local);
	const fetched = arrived.get(incoming.id);
	const blobs: Partial<Record<SidecarKind, Blob>> = {};
	const target: AssetProvenance = {
		edits: incoming.edits,
		origin: incoming.origin,
		sidecars: {},
		tuning: incoming.tuning
	};

	for (const [kind, hash] of Object.entries(syncableSidecarHashes(incoming))) {
		const blob = fetched?.get(kind);

		if (blob) {
			target.sidecars[kind] = hash;
			blobs[kind] = blob;
			continue;
		}

		const stored = here[kind] ? await store.sidecar(local.id, kind) : undefined;

		if (stored) {
			target.sidecars[kind] = here[kind];
			blobs[kind] = stored;
		}
	}

	return {blobs, target};
}

/**
 * Downloads every asset the local store lacks and hands the lot to the bundle importer,
 * then lands the provenance — edit settings and sidecar blobs — that travelled with them.
 *
 * Split out so the "resume a half-finished checkout" case is one call, and so tests can
 * drive the asset half without a stories dispatch.
 */
export async function checkoutAssets(options: {
	client: ServerClient;
	storyId: string;
	store: AssetStore;
	/**
	 * Already fetched by the caller. The pull path reads the manifest first to learn its
	 * rev — one GET, not two, and the rev is how it decides there is nothing to do.
	 */
	manifest?: AssetManifest;
	/** What to call this in progress reports. Defaults to a checkout. */
	phase?: 'assets' | 'download';
	onProgress?: (progress: AssetDownloadProgress) => void;
}): Promise<{
	downloaded: string[];
	missingAssets: string[];
	missingSidecars: string[];
	/** LOCAL ids whose edit settings or sidecars this run brought over. */
	provenanceApplied: string[];
	warnings: string[];
}> {
	const {client, onProgress, store, storyId} = options;
	const phase = options.phase ?? 'assets';
	const missingAssets: string[] = [];
	const missingSidecars: string[] = [];
	const downloaded: string[] = [];
	/** Sidecar blobs that came down, by manifest asset id, then by kind. */
	const arrived = new Map<string, Map<SidecarKind, Blob>>();
	let manifest = options.manifest;

	try {
		manifest = manifest ?? (await client.getManifest(storyId));
	} catch (error) {
		// A story with no manifest yet is a story published before assets existed on it.
		// Nothing to download, and nothing worth failing the checkout over.
		return {
			downloaded,
			missingAssets,
			missingSidecars,
			provenanceApplied: [],
			warnings: [messageOf(error)]
		};
	}

	const assets = manifest.assets ?? [];
	const serverMissing = new Set(manifest.missing ?? []);
	const total = assets.length;

	onProgress?.({done: 0, phase, total});

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
			onProgress?.({done, phase, total});
			continue;
		}

		const twin = localByKey.get(dedupeKey(meta));
		// Already here. Its bytes still have to ride along in `contents`, because
		// `planBundle` builds the id map that repoints character frames from exactly this
		// list — leave it out and every frame pointing at it is dropped.
		let blob = twin ? await store.get(twin.id) : undefined;

		if (!blob) {
			try {
				blob = await client.getAssetBlob(storyId, meta.id);
				downloaded.push(meta.id);
			} catch {
				// One picture that would not come down must not cost the author the other
				// thirty, or the story text. Report it and carry on.
				missingAssets.push(meta.id);
			}
		}

		if (blob) {
			contents.push({blob, meta});

			// After the picture, and for an asset that was already here just as much as for
			// one that just arrived — that second case is the whole point. A library holding
			// the bytes was the one thing that used to end this loop early, and it is exactly
			// the library whose sidecars are missing, because nothing before this ever
			// fetched them. The far side got the pixels and lost the edit that made them.
			const sidecars = await fetchSidecars({
				client,
				meta,
				missingSidecars,
				storyId,
				twin
			});

			if (sidecars.size > 0) {
				arrived.set(meta.id, sidecars);
			}
		}

		onProgress?.({done, phase, total});
	}

	const warnings: string[] = [];

	if (contents.length > 0 || (manifest.characters ?? []).length > 0) {
		const plan = await planBundle(store, {
			assets: contents,
			characters: manifest.characters ?? []
		});

		await applyBundlePlan(store, plan);
		warnings.push(...plan.warnings);
	}

	// `missing` again: the server has already said it holds no bytes for these, so their
	// manifest row describes an asset nobody can produce. Letting it through here would
	// compare a local twin against a ghost and report a difference on every single pull.
	const provenanceApplied = await landProvenance({
		arrived,
		assets: assets.filter(meta => !serverMissing.has(meta.id)),
		store,
		warnings
	});

	return {
		downloaded,
		missingAssets,
		missingSidecars,
		provenanceApplied,
		warnings
	};
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
