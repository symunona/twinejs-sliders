/**
 * Sidecar shape maintenance: the index used to be a list of kinds (`['source','cutout']`)
 * and is now a record keyed by kind; the blobs used to be keyed `a_8f21#src` and are now
 * `a_8f21.src`.
 *
 * Unlike `migrateCharacter` this cannot be a reshape applied on every read. It MOVES
 * bytes — a sidecar left under its old key is orphaned, and nothing would ever look for
 * it again — so it runs once, when a manifest is first read, and the manifest goes
 * straight back to disk. Only assets that actually own sidecars do any work, and those
 * are only the edited ones.
 */

import type {AssetId, AssetMeta, SidecarEntries} from '@sliders/scene-types';
import {AssetManifest, StorageBackend} from './asset-store.types';
import {sidecarKey} from './ids';

/** An asset meta as it may still exist on disk, with the sidecar index as a list. */
type StoredMeta = Omit<AssetMeta, 'sidecars'> & {
	sidecars?: AssetMeta['sidecars'] | string[];
};

/**
 * The key the old `sidecarKey` produced — `#`, and `source` spelled `src` only in the
 * blob key. Kept here and nowhere else: this is the last code that has any business
 * knowing about it.
 */
function legacyKey(id: AssetId, kind: string): string {
	return `${id}#${kind === 'source' ? 'src' : 'cutout'}`;
}

/** What the old list called a kind, in today's spelling. */
function renameKind(kind: string): string {
	return kind === 'source' ? 'src' : kind;
}

/**
 * Brings every asset in `manifest` onto today's sidecar shape, renaming the blobs as it
 * goes. Reports whether anything changed, so an already-current manifest is not rewritten.
 *
 * Mutates `manifest` in place, the way the store's own mutations do.
 */
export async function migrateSidecars(
	manifest: AssetManifest,
	storage: Pick<StorageBackend, 'deleteBlob' | 'readBlob' | 'writeBlob'>
): Promise<boolean> {
	let changed = false;

	for (const meta of Object.values(manifest.assets ?? {}) as StoredMeta[]) {
		const legacy = meta.sidecars;

		if (!Array.isArray(legacy)) {
			continue;
		}

		const sidecars: SidecarEntries = {};

		for (const kind of legacy) {
			const blob = await storage.readBlob(legacyKey(meta.id, kind));

			// A listed kind whose blob has gone missing is dropped rather than carried
			// over. The manifest is what `sidecar()` and `remove()` trust, and an entry
			// naming a blob nobody can read is worse than no entry at all.
			if (!blob) {
				continue;
			}

			await storage.writeBlob(sidecarKey(meta.id, renameKind(kind)), blob);
			await storage.deleteBlob(legacyKey(meta.id, kind));
			// No hash, bytes or mime: nothing ever recorded them, and deriving them here
			// would mean reading every stored 16 MB original on the first open just to
			// fill a field. Such an entry names a real blob and simply cannot be diffed,
			// so it never syncs until the next save rewrites it.
			sidecars[renameKind(kind)] = {};
		}

		if (Object.keys(sidecars).length) {
			meta.sidecars = sidecars;
		} else {
			delete meta.sidecars;
		}

		changed = true;
	}

	return changed;
}
