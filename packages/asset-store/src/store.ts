import type {
	AssetId,
	AssetMeta,
	Character
} from '@sliders/scene-types';
import {
	AssetFilter,
	AssetManifest,
	AssetStore,
	BackendKind,
	PutAssetOptions,
	PutAssetResult,
	StorageBackend
} from './asset-store.types';
import {blobBytes} from './blob-bytes';
import {migrateCharacter} from './characters';
import {contentHash, nameFromFilename, uniqueAssetId, uniqueName} from './ids';
import {prepareUpload} from './transcode';

/**
 * A character with spec 04's defaults: origin at the feet, and no frames yet.
 *
 * No rig either, because there is nothing to rig — anchors belong to frames, and the first
 * frame added brings its own (`newFrameAnchors`).
 */
export function defaultCharacter(id: string, name?: string): Character {
	return {
		id,
		name: name ?? id,
		size: {w: 512, h: 1024},
		origin: {x: 0.5, y: 1},
		frames: {},
		tags: []
	};
}

function matchesFilter(meta: AssetMeta, filter: AssetFilter): boolean {
	if (!filter.includeFrames && meta.ownerCharacter) {
		return false;
	}

	if (filter.kind && meta.kind !== filter.kind) {
		return false;
	}

	if (
		filter.search &&
		!meta.name.toLowerCase().includes(filter.search.trim().toLowerCase())
	) {
		return false;
	}

	if (filter.tags?.length && !filter.tags.every(tag => meta.tags.includes(tag))) {
		return false;
	}

	return true;
}

/**
 * Platform-independent half of the asset library. Sniffing, transcoding, hashing and id
 * assignment all happen here; the backend only moves bytes.
 */
export class BackedAssetStore implements AssetStore {
	readonly backend: BackendKind;
	readonly scope: string;

	private manifest?: AssetManifest;
	private urls = new Map<AssetId, string>();
	/** Serializes manifest read-modify-write cycles. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private storage: StorageBackend, scope = '') {
		this.backend = storage.kind;
		this.scope = scope;
	}

	private async load(): Promise<AssetManifest> {
		if (!this.manifest) {
			this.manifest = await this.storage.readManifest();
			this.manifest.assets ??= {};
			this.manifest.characters ??= {};
		}

		return this.manifest;
	}

	/** Runs `body` with exclusive access to the manifest, then persists it. */
	private mutate<T>(body: (manifest: AssetManifest) => T | Promise<T>): Promise<T> {
		const run = this.queue.then(async () => {
			const manifest = await this.load();
			const result = await body(manifest);

			await this.storage.writeManifest(manifest);
			return result;
		});

		// Keep the chain alive even if this operation rejects.
		this.queue = run.catch(() => undefined);
		return run;
	}

	/**
	 * Every name a scene block can write. Asset names and character ids share one namespace,
	 * because that is how a scene reads them: `bg: lamp` and an `entities:` entry called
	 * `mira` are looked up against both.
	 *
	 * Frames count. They are ordinary assets and `bg:` may legitimately name one, so a frame
	 * called `tavern` is as much a clash as a backdrop called `tavern`.
	 */
	private namesIn(manifest: AssetManifest, except?: string): Set<string> {
		const taken = new Set<string>();

		for (const meta of Object.values(manifest.assets)) {
			if (meta.id !== except) {
				taken.add(meta.name);
			}
		}

		for (const id of Object.keys(manifest.characters)) {
			if (id !== except) {
				taken.add(id);
			}
		}

		return taken;
	}

	async takenNames(): Promise<Set<string>> {
		return this.namesIn(await this.load());
	}

	async putAsset(
		file: File,
		options: PutAssetOptions = {}
	): Promise<PutAssetResult> {
		const prepared = await prepareUpload(file);
		const hash = await contentHash(await blobBytes(prepared.blob));

		return await this.mutate(async manifest => {
			const existing = Object.values(manifest.assets).find(
				asset =>
					asset.hash === hash &&
					asset.ownerCharacter === options.ownerCharacter
			);

			if (existing) {
				return {id: existing.id, meta: existing, duplicate: true, transcoded: false};
			}

			const id = uniqueAssetId(Object.keys(manifest.assets));
			const meta: AssetMeta = {
				id,
				// Numbered rather than rejected: an upload is a bulk act — a folder of forty
				// sprites, half of them called `idle` — and stopping the drop on the first
				// clash would be useless. A rename is where the loud failure belongs.
				name: uniqueName(
					options.name ?? nameFromFilename(file.name),
					this.namesIn(manifest)
				),
				kind: options.kind ?? (options.ownerCharacter ? 'frame' : 'bg'),
				tags: options.tags ?? [],
				animated: prepared.animated,
				w: prepared.width,
				h: prepared.height,
				bytes: prepared.blob.size,
				hash,
				mime: prepared.mime,
				ownerCharacter: options.ownerCharacter,
				sourceAsset: options.sourceAsset,
				origin: options.origin
			};

			await this.storage.writeBlob(id, prepared.blob);
			manifest.assets[id] = meta;

			return {id, meta, duplicate: false, transcoded: prepared.transcoded};
		});
	}

	async importAsset(meta: AssetMeta, blob: Blob): Promise<AssetMeta> {
		return await this.mutate(async manifest => {
			// No prepareUpload, no re-hash: these bytes came out of a library and the
			// importer already checked them against the bundle manifest. Deduping and
			// name clashes are its calls too, so both are deliberately absent here.
			const id = manifest.assets[meta.id]
				? uniqueAssetId(Object.keys(manifest.assets))
				: meta.id;
			const copy = JSON.parse(JSON.stringify(meta)) as AssetMeta;
			const stored: AssetMeta = {...copy, id};

			await this.storage.writeBlob(id, blob);
			manifest.assets[id] = stored;

			// No revoke(): the id is either fresh or was free, so nothing can be
			// cached under it.
			return stored;
		});
	}

	async put(file: File, options?: PutAssetOptions): Promise<AssetId> {
		return (await this.putAsset(file, options)).id;
	}

	async get(id: AssetId): Promise<Blob | undefined> {
		return await this.storage.readBlob(id);
	}

	async url(id: AssetId): Promise<string | undefined> {
		const cached = this.urls.get(id);

		if (cached) {
			return cached;
		}

		const blob = await this.storage.readBlob(id);

		if (!blob) {
			return undefined;
		}

		const url = URL.createObjectURL(blob);

		this.urls.set(id, url);
		return url;
	}

	async meta(id: AssetId): Promise<AssetMeta | undefined> {
		return (await this.load()).assets[id];
	}

	async list(filter: AssetFilter = {}): Promise<AssetMeta[]> {
		const manifest = await this.load();

		return Object.values(manifest.assets)
			.filter(meta => matchesFilter(meta, filter))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async replace(id: AssetId, file: File): Promise<AssetMeta> {
		const prepared = await prepareUpload(file);
		const hash = await contentHash(await blobBytes(prepared.blob));
		const updated = await this.mutate(async manifest => {
			const existing = manifest.assets[id];

			if (!existing) {
				throw new Error(`There is no asset with ID ${id}.`);
			}

			// Identity--id, name, kind, tags, owner--is the author's. Everything
			// else describes the bytes, and the bytes just changed.
			const meta: AssetMeta = {
				...existing,
				animated: prepared.animated,
				bytes: prepared.blob.size,
				h: prepared.height,
				hash,
				mime: prepared.mime,
				w: prepared.width
			};

			await this.storage.writeBlob(id, prepared.blob);
			manifest.assets[id] = meta;
			return meta;
		});

		// The cached object URL still points at the old bytes.
		this.revoke(id);
		return updated;
	}

	async update(id: AssetId, changes: Partial<AssetMeta>): Promise<AssetMeta> {
		return await this.mutate(manifest => {
			const existing = manifest.assets[id];

			if (!existing) {
				throw new Error(`There is no asset with ID ${id}.`);
			}

			if (changes.name !== undefined && changes.name !== existing.name) {
				// Loud, not numbered. `putAsset` may quietly pick `lamp-2` because nobody
				// typed `lamp`; here somebody did, and handing them a different name would
				// leave every scene that says `lamp` pointing at the other asset.
				if (this.namesIn(manifest, id).has(changes.name)) {
					throw new Error(
						`Something else in this library is already called ${changes.name}.`
					);
				}
			}

			const updated = {...existing, ...changes, id};

			manifest.assets[id] = updated;
			return updated;
		});
	}

	async remove(id: AssetId): Promise<void> {
		await this.mutate(async manifest => {
			delete manifest.assets[id];

			for (const character of Object.values(manifest.characters)) {
				for (const [frameName, frame] of Object.entries(character.frames)) {
					if (frame.asset === id) {
						delete character.frames[frameName];
					}
				}
			}

			await this.storage.deleteBlob(id);
		});

		this.revoke(id);
	}

	async putCharacter(character: Character): Promise<Character> {
		return await this.mutate(manifest => {
			// Migrated on the way in as well as on the way out, so the first save after an
			// upgrade is what actually cleans the manifest up.
			const stored: Character = migrateCharacter(
				JSON.parse(JSON.stringify(character))
			);

			// Saving over an existing character is an update and always allowed. A NEW id
			// that an asset name already answers to is not: scenes address both out of one
			// namespace, so one of the two would become undrawable.
			if (
				!manifest.characters[stored.id] &&
				this.namesIn(manifest).has(stored.id)
			) {
				throw new Error(
					`Something else in this library is already called ${stored.id}.`
				);
			}

			manifest.characters[stored.id] = stored;

			// Frames belong to their character. Keep ownership on the asset metadata in
			// sync so the flat library keeps hiding them.

			for (const frame of Object.values(stored.frames)) {
				const meta = manifest.assets[frame.asset];

				if (meta) {
					meta.ownerCharacter = stored.id;
					meta.kind = 'frame';
				}
			}

			return stored;
		});
	}

	async getCharacter(id: string): Promise<Character | undefined> {
		const stored = (await this.load()).characters[id];

		// Anchors used to live on the character. Everything downstream — the renderer, the
		// editor, the bundle writer — sees only today's shape.
		return stored && migrateCharacter(stored);
	}

	async character(id: string): Promise<Character | undefined> {
		return await this.getCharacter(id);
	}

	async listCharacters(): Promise<Character[]> {
		const manifest = await this.load();

		return Object.values(manifest.characters)
			.map(migrateCharacter)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	async removeCharacter(id: string): Promise<void> {
		const orphaned = await this.mutate(manifest => {
			const character = manifest.characters[id];

			if (!character) {
				return [];
			}

			const assetIds = Object.values(character.frames).map(frame => frame.asset);

			delete manifest.characters[id];

			for (const assetId of assetIds) {
				delete manifest.assets[assetId];
			}

			return assetIds;
		});

		for (const assetId of orphaned) {
			await this.storage.deleteBlob(assetId);
			this.revoke(assetId);
		}
	}

	private revoke(id: AssetId) {
		const url = this.urls.get(id);

		if (url) {
			URL.revokeObjectURL(url);
			this.urls.delete(id);
		}
	}
}
