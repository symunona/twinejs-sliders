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
import {contentHash, nameFromFilename, uniqueAssetId} from './ids';
import {prepareUpload} from './transcode';

/** A character with spec 04's defaults: origin at the feet, a bubble anchor to drag. */
export function defaultCharacter(id: string, name?: string): Character {
	return {
		id,
		name: name ?? id,
		size: {w: 512, h: 1024},
		origin: {x: 0.5, y: 1},
		anchors: {bubble: {x: 0.5, y: 0.15}, mouth: {x: 0.5, y: 0.25}},
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

	private manifest?: AssetManifest;
	private urls = new Map<AssetId, string>();
	/** Serializes manifest read-modify-write cycles. */
	private queue: Promise<unknown> = Promise.resolve();

	constructor(private storage: StorageBackend) {
		this.backend = storage.kind;
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
				name: options.name ?? nameFromFilename(file.name),
				kind: options.kind ?? (options.ownerCharacter ? 'frame' : 'bg'),
				tags: options.tags ?? [],
				animated: prepared.animated,
				w: prepared.width,
				h: prepared.height,
				bytes: prepared.blob.size,
				hash,
				mime: prepared.mime,
				ownerCharacter: options.ownerCharacter,
				sourceAsset: options.sourceAsset
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
			const stored: Character = JSON.parse(JSON.stringify(character));

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
		return (await this.load()).characters[id];
	}

	async character(id: string): Promise<Character | undefined> {
		return await this.getCharacter(id);
	}

	async listCharacters(): Promise<Character[]> {
		const manifest = await this.load();

		return Object.values(manifest.characters).sort((a, b) =>
			a.name.localeCompare(b.name)
		);
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
