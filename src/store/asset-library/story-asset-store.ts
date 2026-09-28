import {
	AssetRecipe,
	AssetRecord,
	CharacterRecord,
	CollectionRecord,
	LibraryEngine,
	LockedError,
	Resolver,
	sha256Hex,
	SidecarInput
} from '@sliders/asset-library';
import {
	AssetFilter,
	AssetStore,
	BackendKind,
	blobBytes,
	migrateCharacter,
	nameFromFilename,
	prepareUpload,
	PutAssetOptions,
	PutAssetResult,
	ReplaceAssetOptions,
	uniqueName
} from '@sliders/asset-store';
import type {
	AssetId,
	AssetKind,
	AssetMeta,
	Character,
	SidecarEntries,
	SidecarKind
} from '@sliders/scene-types';
import {poseAssets} from '@sliders/scene-types';
import {libraryEngine, onLibraryEngineChange, onLibraryEngineSwap} from './engine-registry';

/**
 * The old per-story `AssetStore`, over the shared library (asset-library-1-architecture.md).
 *
 * One story's RESOLVED VIEW: its own collection first, then the collections its binding
 * attaches, in order. First name wins; a later same-name asset is shadowed and hidden.
 * Every existing caller — dialogs, preview, packager — keeps the interface it had.
 *
 * - Ids are asset record uuids. Character ids are `charId`s (the scene name), as before.
 * - Writes land in the story's own collection. It and the story's binding are created the
 *   first time something is written.
 * - An edit to an asset that lives elsewhere, or that another story uses, never happens
 *   silently: without `{scope}` it throws `SharedAssetError`. `scope: 'all'` edits the
 *   shared record; `scope: 'fork'` copies it into the own collection under the same name
 *   (shadowing it for this story only) and edits the copy.
 */

export type EditScope = 'all' | 'fork';

export interface ScopeOptions {
	/** What to do when the target is shared. Required then; ignored otherwise. */
	scope?: EditScope;
}

export interface StoryUsage {
	storyId: string;
	/** Local story name, when this browser holds the story. */
	storyName?: string;
	/** Who last wrote that story's library binding. */
	by?: string;
}

export interface SharedInfo {
	kind: 'asset' | 'character';
	id: string;
	name: string;
	collection: {id: string; name: string; kind: string; locked: boolean};
	/** The home collection is not this story's own. */
	foreign: boolean;
	/** OTHER stories whose scenes use it (asset refs). */
	stories: StoryUsage[];
	shared: boolean;
	/** `scope: 'fork'` is possible (home is not the own collection). */
	canFork: boolean;
	/** `scope: 'all'` is possible (home collection not locked). */
	canUpdateAll: boolean;
}

/** An edit that would change other stories' art. Ask the author, then retry with scope. */
export class SharedAssetError extends Error {
	constructor(readonly info: SharedInfo) {
		super(
			`"${info.name}" is shared (${info.collection.name}${
				info.stories.length ? `, used by ${info.stories.length} other stories` : ''
			}): pass {scope: 'all'} or {scope: 'fork'}.`
		);
		this.name = 'SharedAssetError';
		Object.setPrototypeOf(this, SharedAssetError.prototype);
	}
}

export function isSharedAssetError(error: unknown): error is SharedAssetError {
	return error instanceof SharedAssetError;
}

/** `AssetMeta` plus where it lives. Extra fields; the old shape is untouched. */
export type LibraryAssetMeta = AssetMeta & {
	collection: string;
	collectionName: string;
	/** Home is this story's own collection. */
	own: boolean;
};

// ---------------------------------------------------------------------------
// Story names (for the own collection's name, and usage prompts)
// ---------------------------------------------------------------------------

export interface StoryDirectory {
	name(storyId: string): string | undefined;
}

let stories: StoryDirectory = {name: () => undefined};

/** The provider hands in a view of the stories state. */
export function setStoryDirectory(directory: StoryDirectory): void {
	stories = directory;
}

/** Name an own collection gets before its story is known (bundle import). */
export function placeholderCollectionName(storyId: string): string {
	return `story-${storyId.slice(0, 8)}`;
}

// ---------------------------------------------------------------------------
// Object URLs, shared by every facade, revoked when the asset's bytes move
// ---------------------------------------------------------------------------

const urls = new Map<string, {sha: string; url: string}>();

function revoke(id: string) {
	const entry = urls.get(id);

	if (entry) {
		URL.revokeObjectURL?.(entry.url);
		urls.delete(id);
	}
}

let urlWatch = false;

function watchUrls() {
	if (urlWatch) {
		return;
	}

	urlWatch = true;
	onLibraryEngineChange(event => {
		void libraryEngine().then(engine => {
			for (const id of event.ids) {
				const entry = urls.get(id);

				if (!entry) {
					continue;
				}

				const record = engine.get(id, 'asset');

				if (!record || record.deleted || record.blob !== entry.sha) {
					revoke(id);
				}
			}
		});
	});
	onLibraryEngineSwap(() => {
		for (const id of [...urls.keys()]) {
			revoke(id);
		}
	});
}

// ---------------------------------------------------------------------------
// Mapping
// ---------------------------------------------------------------------------

const RECIPE_KEYS = [
	'edits',
	'tuning',
	'mask',
	'effect',
	'walk',
	'origin'
] as const;

type RecipeKey = (typeof RECIPE_KEYS)[number];

function toMeta(
	record: AssetRecord,
	owner: string | undefined,
	collection: CollectionRecord | undefined,
	ownId: string | undefined
): LibraryAssetMeta {
	const recipe = record.recipe ?? {};
	const sidecars: SidecarEntries = {};

	for (const [kind, sha] of Object.entries(record.sidecars ?? {})) {
		sidecars[kind] = {hash: sha, sync: true};
	}

	const meta: LibraryAssetMeta = {
		animated: !!record.animated,
		bytes: record.bytes ?? 0,
		collection: record.collection,
		collectionName: collection?.name ?? '',
		h: record.h ?? 0,
		hash: record.blob,
		id: record.id,
		kind: (record.kind ?? 'object') as AssetKind,
		mime: record.mime ?? '',
		name: record.name,
		own: record.collection === ownId,
		tags: [...(record.tags ?? [])],
		w: record.w ?? 0
	};

	if (owner) {
		meta.ownerCharacter = owner;
	}

	if (record.sourceAsset) {
		meta.sourceAsset = record.sourceAsset;
	}

	if (typeof record.duration === 'number') {
		meta.duration = record.duration;
	}

	for (const key of RECIPE_KEYS) {
		if (recipe[key] !== undefined) {
			(meta as unknown as Record<string, unknown>)[key] = JSON.parse(
				JSON.stringify(recipe[key])
			);
		}
	}

	if (Object.keys(sidecars).length) {
		meta.sidecars = sidecars;
	}

	return meta;
}

const CHARACTER_ENVELOPE = [
	'id',
	'type',
	'rev',
	'deleted',
	'by',
	'at',
	'collection',
	'charId',
	'sourceCharacter'
];

function toCharacter(record: CharacterRecord): Character {
	const rest: Record<string, unknown> = {};

	for (const [key, value] of Object.entries(record)) {
		if (!CHARACTER_ENVELOPE.includes(key)) {
			rest[key] = JSON.parse(JSON.stringify(value ?? null)) ?? undefined;
		}
	}

	return migrateCharacter({
		origin: {x: 0.5, y: 1},
		size: {w: 512, h: 1024},
		tags: [],
		...rest,
		poses: (rest.poses as Character['poses']) ?? {},
		id: record.charId,
		name: record.charId
	} as Character);
}

/** Character → record fields (everything but the id, which is `charId`). */
function characterFields(character: Character): Record<string, unknown> {
	const rest = JSON.parse(JSON.stringify(character)) as Record<string, unknown>;

	delete rest.id;

	return rest;
}

function matchesFilter(meta: AssetMeta, filter: AssetFilter): boolean {
	if (!filter.includePoseImages && meta.ownerCharacter) {
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

async function blobInput(blob: Blob): Promise<SidecarInput> {
	return {
		bytes: new Uint8Array(await blobBytes(blob)),
		mime: blob.type || 'application/octet-stream'
	};
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

export interface StoryView {
	/** Undefined until the story has written anything. */
	own?: string;
	order: CollectionRecord[];
	collections: Map<string, CollectionRecord>;
	/** Visible assets, resolution order, shadowed ones left out. */
	assets: AssetRecord[];
	characters: CharacterRecord[];
	/** Name → winner (asset or character). */
	names: Set<string>;
	resolver: Resolver;
	/** Asset id → charId of a character whose poses use it. */
	owners: Map<string, string>;
}

export function storyView(engine: LibraryEngine, storyId: string): StoryView {
	const resolver = engine.resolver(storyId);
	const order = resolver.order();
	const binding = engine.binding(storyId);
	const collections = new Map(
		engine.collections().map(collection => [collection.id, collection])
	);
	const allAssets = engine.assets();
	const allCharacters = engine.characters();
	const names = new Set<string>();
	const assets: AssetRecord[] = [];
	const characters: CharacterRecord[] = [];

	for (const collection of order) {
		const here: (AssetRecord | CharacterRecord)[] = [
			...allAssets.filter(asset => asset.collection === collection.id),
			...allCharacters.filter(
				character => character.collection === collection.id
			)
		];
		const fresh: string[] = [];

		for (const record of here) {
			const name = record.type === 'asset' ? record.name : record.charId;

			if (names.has(name)) {
				continue;
			}

			fresh.push(name);

			if (record.type === 'asset') {
				assets.push(record);
			} else {
				characters.push(record);
			}
		}

		fresh.forEach(name => names.add(name));
	}

	const owners = new Map<string, string>();

	// View characters first: they are the ones this story draws.
	for (const character of [...characters, ...allCharacters]) {
		for (const pose of Object.values(character.poses ?? {})) {
			for (const id of poseAssets(pose)) {
				if (!owners.has(id)) {
					owners.set(id, character.charId);
				}
			}
		}
	}

	return {
		assets,
		characters,
		collections,
		names,
		order,
		own: binding?.own,
		owners,
		resolver
	};
}

// ---------------------------------------------------------------------------
// The facade
// ---------------------------------------------------------------------------

export class LibraryAssetStore implements AssetStore {
	readonly backend: BackendKind = 'indexeddb';

	/**
	 * `engineSource` defaults to the app's engine (registry). Tests hand in their own so
	 * two "browsers" can each have a facade.
	 */
	constructor(
		readonly scope: string,
		private engineSource: () => Promise<LibraryEngine> = libraryEngine
	) {
		if (engineSource === libraryEngine) {
			watchUrls();
		}
	}

	/** The story this facade is the view of. Same as `scope`. */
	get storyId(): string {
		return this.scope;
	}

	engine(): Promise<LibraryEngine> {
		return this.engineSource();
	}

	/** The resolved view right now. Read-only snapshot. */
	async view(): Promise<StoryView> {
		return storyView(await this.engine(), this.scope);
	}

	/** Collection ids this story sees, own first. For `useLibraryChange`. */
	async collectionIds(): Promise<string[]> {
		return (await this.view()).order.map(collection => collection.id);
	}

	/** The own collection id, creating it and the binding if needed. */
	async ownCollection(): Promise<string> {
		return this.ensureOwn(await this.engine());
	}

	private ensureOwn(engine: LibraryEngine): string {
		const existing = engine.binding(this.scope);

		if (existing) {
			return existing.own;
		}

		return engine.createStory(this.scope, {
			name:
				stories.name(this.scope)?.trim() ||
				placeholderCollectionName(this.scope)
		}).own;
	}

	private metaOf(
		engine: LibraryEngine,
		view: StoryView,
		record: AssetRecord
	): LibraryAssetMeta {
		return toMeta(
			record,
			view.owners.get(record.id) ??
				(typeof record.ownerCharacter === 'string'
					? record.ownerCharacter
					: undefined),
			view.collections.get(record.collection) ??
				engine.get(record.collection, 'collection'),
			view.own
		);
	}

	/** A live asset by uuid, anywhere in the library. */
	private assetRecord(
		engine: LibraryEngine,
		id: string
	): AssetRecord | undefined {
		const record = engine.get(id, 'asset');

		return record && !record.deleted ? record : undefined;
	}

	private requireAsset(engine: LibraryEngine, id: string): AssetRecord {
		const record = this.assetRecord(engine, id);

		if (!record) {
			throw new Error(`There is no asset with ID ${id}.`);
		}

		return record;
	}

	private characterRecord(
		engine: LibraryEngine,
		view: StoryView,
		key: string
	): CharacterRecord | undefined {
		const resolved = view.resolver.character(key);

		if (resolved) {
			return resolved;
		}

		const byId = engine.get(key, 'character');

		return byId && !byId.deleted ? byId : undefined;
	}

	// ---- shared-ness -------------------------------------------------------

	private usageOf(engine: LibraryEngine, assetIds: string[]): StoryUsage[] {
		const ids = new Set<string>();

		for (const assetId of assetIds) {
			engine.usage(assetId).forEach(id => ids.add(id));
		}

		ids.delete(this.scope);

		return [...ids].sort().map(storyId => ({
			by: engine.binding(storyId)?.by || undefined,
			storyId,
			storyName: stories.name(storyId)
		}));
	}

	private info(
		engine: LibraryEngine,
		kind: 'asset' | 'character',
		record: AssetRecord | CharacterRecord
	): SharedInfo {
		const own = engine.binding(this.scope)?.own;
		const collection = engine.get(record.collection, 'collection');
		const locked = !!collection?.locked;
		const foreign = record.collection !== own;
		const storyUsage =
			kind === 'asset'
				? this.usageOf(engine, [record.id])
				: this.usageOf(
						engine,
						Object.values((record as CharacterRecord).poses ?? {}).flatMap(
							poseAssets
						)
				  );

		return {
			canFork: foreign,
			canUpdateAll: !locked,
			collection: {
				id: record.collection,
				kind: collection?.kind ?? 'shared',
				locked,
				name: collection?.name ?? ''
			},
			foreign,
			id: record.id,
			kind,
			name: record.type === 'asset' ? record.name : record.charId,
			shared: foreign || storyUsage.length > 0,
			stories: storyUsage
		};
	}

	/** Would an edit to this asset (uuid or name) reach other stories? Never throws for shared. */
	async sharedInfo(idOrName: string): Promise<SharedInfo | undefined> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		const record =
			this.assetRecord(engine, idOrName) ?? view.resolver.asset(idOrName);

		if (record) {
			return this.info(engine, 'asset', record);
		}

		const character = this.characterRecord(engine, view, idOrName);

		return character && this.info(engine, 'character', character);
	}

	/**
	 * `direct` = edit the record itself; `fork` = copy into own first. Throws
	 * SharedAssetError (no scope) or LockedError (`all` on a locked collection).
	 */
	private decide(
		engine: LibraryEngine,
		kind: 'asset' | 'character',
		record: AssetRecord | CharacterRecord,
		options: ScopeOptions | undefined
	): 'direct' | 'fork' {
		const info = this.info(engine, kind, record);

		if (!info.shared) {
			return 'direct';
		}

		if (!options?.scope) {
			throw new SharedAssetError(info);
		}

		if (options.scope === 'fork') {
			if (!info.canFork) {
				throw new Error(
					`"${info.name}" already lives in this story's own collection; there is nothing to fork from.`
				);
			}

			return 'fork';
		}

		if (!info.canUpdateAll) {
			throw new LockedError(info.collection.name);
		}

		return 'direct';
	}

	/** Copies a shared asset into the own collection (same name, shadows). Returns the copy. */
	async forkAsset(id: string): Promise<LibraryAssetMeta> {
		const engine = await this.engine();

		this.ensureOwn(engine);

		const fork = engine.fork(id, this.scope);

		return this.metaOf(engine, storyView(engine, this.scope), fork);
	}

	private forkCharacter(
		engine: LibraryEngine,
		record: CharacterRecord
	): CharacterRecord {
		const own = this.ensureOwn(engine);
		const existing = engine
			.characters(own)
			.find(character => character.charId === record.charId);

		if (existing) {
			return existing;
		}

		const fields = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;

		for (const key of ['id', 'type', 'rev', 'deleted', 'by', 'at']) {
			delete fields[key];
		}

		return engine.putCharacter({
			...fields,
			charId: record.charId,
			collection: own,
			sourceCharacter: record.id
		});
	}

	// ---- reads --------------------------------------------------------------

	async takenNames(): Promise<Set<string>> {
		return new Set((await this.view()).names);
	}

	async list(filter: AssetFilter = {}): Promise<LibraryAssetMeta[]> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);

		return view.assets
			.map(record => this.metaOf(engine, view, record))
			.filter(meta => matchesFilter(meta, filter))
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * By uuid (any live asset — a pose may point outside the view), else by name through
	 * the story's resolution order, `coll/name` included.
	 */
	async meta(key: AssetId): Promise<LibraryAssetMeta | undefined> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		const record =
			this.assetRecord(engine, key) ?? view.resolver.asset(key);

		return record && this.metaOf(engine, view, record);
	}

	/** Name (plain or qualified) → asset, resolution order. Never by uuid. */
	async lookup(ref: string): Promise<LibraryAssetMeta | undefined> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		const record = view.resolver.asset(ref);

		return record && this.metaOf(engine, view, record);
	}

	async get(id: AssetId): Promise<Blob | undefined> {
		const engine = await this.engine();
		const record =
			this.assetRecord(engine, id) ??
			storyView(engine, this.scope).resolver.asset(id);

		if (!record) {
			return undefined;
		}

		try {
			const {bytes, mime} = await engine.blobBytes(record.blob);

			return new Blob([new Uint8Array(bytes)], {type: record.mime || mime});
		} catch (error) {
			console.warn(`asset library: no bytes for ${record.name}`, error);
			return undefined;
		}
	}

	async url(id: AssetId): Promise<string | undefined> {
		const engine = await this.engine();
		const record =
			this.assetRecord(engine, id) ??
			storyView(engine, this.scope).resolver.asset(id);

		if (!record) {
			return undefined;
		}

		const cached = urls.get(record.id);

		if (cached?.sha === record.blob) {
			return cached.url;
		}

		revoke(record.id);

		try {
			const {bytes, mime} = await engine.blobBytes(record.blob);
			const url = URL.createObjectURL(
				new Blob([new Uint8Array(bytes)], {type: record.mime || mime})
			);

			urls.set(record.id, {sha: record.blob, url});

			return url;
		} catch (error) {
			console.warn(`asset library: no bytes for ${record.name}`, error);
			return undefined;
		}
	}

	async sidecar(id: AssetId, kind: SidecarKind): Promise<Blob | undefined> {
		const engine = await this.engine();
		const record = this.assetRecord(engine, id);
		const sha = record?.sidecars?.[kind];

		if (!sha) {
			return undefined;
		}

		try {
			const {bytes, mime} = await engine.blobBytes(sha);

			return new Blob([new Uint8Array(bytes)], {type: mime});
		} catch {
			return undefined;
		}
	}

	async character(id: string): Promise<Character | undefined> {
		const engine = await this.engine();
		const record = this.characterRecord(
			engine,
			storyView(engine, this.scope),
			id
		);

		return record && toCharacter(record);
	}

	async getCharacter(id: string): Promise<Character | undefined> {
		return this.character(id);
	}

	async listCharacters(): Promise<Character[]> {
		return (await this.view()).characters
			.map(toCharacter)
			.sort((a, b) => a.name.localeCompare(b.name));
	}

	/**
	 * Qualified names (`coll/name`) for everything in the view's collections, and plain
	 * names two or more attached collections hold (not shadowed by own). For catalogs
	 * and lint.
	 */
	async nameIndex(): Promise<{
		qualifiedAssets: Record<string, string>;
		qualifiedCharacters: Record<string, string>;
		ambiguous: Record<string, string[]>;
		/** Assets hidden by an earlier same name: qualified access only. */
		shadowed: LibraryAssetMeta[];
	}> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		const qualifiedAssets: Record<string, string> = {};
		const qualifiedCharacters: Record<string, string> = {};
		const seen = new Map<string, string[]>();

		for (const collection of view.order) {
			for (const asset of engine.assets(collection.id)) {
				qualifiedAssets[`${collection.name}/${asset.name}`] = asset.id;
				seen.set(asset.name, [...(seen.get(asset.name) ?? []), collection.name]);
			}

			for (const character of engine.characters(collection.id)) {
				qualifiedCharacters[`${collection.name}/${character.charId}`] =
					character.charId;
				seen.set(character.charId, [
					...(seen.get(character.charId) ?? []),
					collection.name
				]);
			}
		}

		const ambiguous: Record<string, string[]> = {};
		const ownName = view.own ? view.collections.get(view.own)?.name : undefined;

		for (const [name, holders] of seen) {
			if (holders.length > 1 && holders[0] !== ownName) {
				ambiguous[name] = holders;
			}
		}

		const visible = new Set(view.assets.map(asset => asset.id));
		const shadowed = view.order
			.flatMap(collection => engine.assets(collection.id))
			.filter(asset => !visible.has(asset.id))
			.map(asset => this.metaOf(engine, view, asset));

		return {ambiguous, qualifiedAssets, qualifiedCharacters, shadowed};
	}

	/** Other stories using this asset. */
	async usage(assetId: string): Promise<StoryUsage[]> {
		return this.usageOf(await this.engine(), [assetId]);
	}

	// ---- writes -------------------------------------------------------------

	async putAsset(
		file: File,
		options: PutAssetOptions = {}
	): Promise<PutAssetResult & {meta: LibraryAssetMeta}> {
		const prepared = await prepareUpload(file);
		const bytes = new Uint8Array(await blobBytes(prepared.blob));
		const kind: AssetKind = prepared.audio
			? 'sound'
			: options.kind ?? (options.ownerCharacter ? 'frame' : 'bg');
		const engine = await this.engine();
		const own = this.ensureOwn(engine);
		const view = storyView(engine, this.scope);
		const sha = await sha256Hex(bytes);

		if (!options.allowDuplicate) {
			const existing = view.assets
				.map(record => this.metaOf(engine, view, record))
				.find(
					meta =>
						meta.hash === sha &&
						meta.kind === kind &&
						meta.ownerCharacter === options.ownerCharacter
				);

			if (existing) {
				return {
					duplicate: true,
					id: existing.id,
					meta: existing,
					transcoded: false
				};
			}
		}

		const sidecars: Record<string, SidecarInput> = {};

		for (const [sidecarKind, blob] of Object.entries(options.sidecars ?? {})) {
			if (blob) {
				sidecars[sidecarKind] = await blobInput(blob);
			}
		}

		const recipe: AssetRecipe = {};

		for (const key of RECIPE_KEYS) {
			if (options[key] !== undefined) {
				(recipe as Record<string, unknown>)[key] = options[key];
			}
		}

		const {asset} = await engine.addAsset(bytes, prepared.mime, {
			allowDuplicate: true,
			animated: prepared.animated,
			collection: own,
			h: prepared.height,
			kind,
			name: uniqueName(
				options.name ?? nameFromFilename(file.name),
				view.names
			),
			tags: options.tags ?? [],
			w: prepared.width,
			...(prepared.duration !== undefined
				? {duration: prepared.duration}
				: {}),
			...(options.ownerCharacter
				? {ownerCharacter: options.ownerCharacter}
				: {}),
			...(options.sourceAsset ? {sourceAsset: options.sourceAsset} : {}),
			...(Object.keys(recipe).length ? {recipe} : {}),
			...(Object.keys(sidecars).length ? {sidecars} : {})
		});

		const meta = this.metaOf(engine, storyView(engine, this.scope), asset!);

		return {
			duplicate: false,
			id: meta.id,
			meta,
			transcoded: prepared.transcoded
		};
	}

	async put(file: File, options?: PutAssetOptions): Promise<AssetId> {
		return (await this.putAsset(file, options)).id;
	}

	/**
	 * Bundle import. Bytes verbatim, no dedupe. The id is kept only when it is a free
	 * uuid; otherwise a fresh one is minted and handed back (the importer repoints poses).
	 * Recipe fields that describe an edit (`edits`, `tuning`, `mask`) and sidecars are
	 * stripped, as before: a bundle ships baked bytes.
	 */
	async importAsset(meta: AssetMeta, blob: Blob): Promise<LibraryAssetMeta> {
		const engine = await this.engine();
		const own = this.ensureOwn(engine);
		const bytes = new Uint8Array(await blobBytes(blob));
		const uuid =
			/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
				meta.id
			) && !engine.get(meta.id, 'asset')
				? meta.id
				: undefined;
		const recipe: AssetRecipe = {};

		for (const key of ['effect', 'walk', 'origin'] as RecipeKey[]) {
			if (meta[key] !== undefined) {
				(recipe as Record<string, unknown>)[key] = JSON.parse(
					JSON.stringify(meta[key])
				);
			}
		}

		const {asset} = await engine.addAsset(
			bytes,
			meta.mime || blob.type || 'application/octet-stream',
			{
				allowDuplicate: true,
				animated: !!meta.animated,
				collection: own,
				h: meta.h,
				kind: meta.kind,
				name: meta.name,
				tags: [...(meta.tags ?? [])],
				w: meta.w,
				...(uuid ? {id: uuid} : {}),
				...(meta.duration !== undefined ? {duration: meta.duration} : {}),
				...(meta.ownerCharacter
					? {ownerCharacter: meta.ownerCharacter}
					: {}),
				...(meta.sourceAsset && this.assetRecord(engine, meta.sourceAsset)
					? {sourceAsset: meta.sourceAsset}
					: {}),
				...(Object.keys(recipe).length ? {recipe} : {})
			}
		);

		return this.metaOf(engine, storyView(engine, this.scope), asset!);
	}

	async replace(
		id: AssetId,
		file: File,
		options: ReplaceAssetOptions & ScopeOptions = {}
	): Promise<LibraryAssetMeta> {
		const prepared = await prepareUpload(file);
		const bytes = new Uint8Array(await blobBytes(prepared.blob));
		const engine = await this.engine();
		let target = this.requireAsset(engine, id);

		if (this.decide(engine, 'asset', target, options) === 'fork') {
			target = engine.fork(target.id, this.scope);
		}

		const entries = Object.entries(options.sidecars ?? {});
		const offered = entries.filter(([, blob]) => blob) as [string, Blob][];
		const dropped = entries
			.filter(([, blob]) => blob === null)
			.map(([kind]) => kind);
		const existing = target.sidecars ?? {};
		const sidecars: Record<string, SidecarInput | null> = {};

		if (
			!offered.length &&
			!dropped.length &&
			!options.edits &&
			!options.tuning &&
			!options.mask
		) {
			// A re-upload, not an edit: the old sidecars describe thrown-away pixels.
			for (const kind of Object.keys(existing)) {
				sidecars[kind] = null;
			}
		} else {
			for (const kind of dropped) {
				sidecars[kind] = null;
			}

			for (const [kind, blob] of offered) {
				// `src` is write-once: it is the un-edited picture.
				if (kind === 'src' && existing.src) {
					continue;
				}

				sidecars[kind] = await blobInput(blob);
			}
		}

		const updated = await engine.replaceBlob(target.id, bytes, prepared.mime, {
			recipe: {
				edits: options.edits,
				mask: options.mask,
				tuning: options.tuning
			},
			sidecars
		});
		const measured = engine.updateAsset(updated.id, {
			animated: prepared.animated,
			h: prepared.height,
			w: prepared.width,
			...(prepared.duration !== undefined
				? {duration: prepared.duration}
				: {duration: undefined})
		});

		revoke(target.id);

		return this.metaOf(engine, storyView(engine, this.scope), measured);
	}

	async update(
		id: AssetId,
		changes: Partial<AssetMeta>,
		options: ScopeOptions = {}
	): Promise<LibraryAssetMeta> {
		const engine = await this.engine();
		let target = this.requireAsset(engine, id);

		if (this.decide(engine, 'asset', target, options) === 'fork') {
			target = engine.fork(target.id, this.scope);
		}

		const view = storyView(engine, this.scope);

		if (changes.name !== undefined && changes.name !== target.name) {
			// Loud, not numbered: somebody typed this name.
			const names = new Set(view.names);

			names.delete(target.name);

			if (names.has(changes.name) || engine.assets(target.collection).some(
				asset => asset.id !== target.id && asset.name === changes.name
			)) {
				throw new Error(
					`Something else in this library is already called ${changes.name}.`
				);
			}
		}

		const patch: Record<string, unknown> = {};
		const recipe: Record<string, unknown> = {};

		for (const [key, value] of Object.entries(changes)) {
			if ((RECIPE_KEYS as readonly string[]).includes(key)) {
				recipe[key] = value;
			} else if (
				['name', 'kind', 'tags', 'ownerCharacter', 'sourceAsset', 'animated', 'duration'].includes(key)
			) {
				patch[key] = value;
			}
		}

		if (Object.keys(recipe).length) {
			patch.recipe = recipe;
		}

		const updated = engine.updateAsset(target.id, patch);

		return this.metaOf(engine, storyView(engine, this.scope), updated);
	}

	async remove(id: AssetId, options: ScopeOptions = {}): Promise<void> {
		const engine = await this.engine();
		const target = this.assetRecord(engine, id);

		if (!target) {
			return;
		}

		if (this.decide(engine, 'asset', target, options) === 'fork') {
			throw new Error(
				`"${target.name}" lives in ${
					engine.get(target.collection, 'collection')?.name ?? 'another collection'
				}; it cannot be removed from one story. Detach the collection instead.`
			);
		}

		// Poses that drew it lose that image (a shorter sequence, or no pose).
		for (const character of engine.characters()) {
			let changed = false;
			const poses = JSON.parse(JSON.stringify(character.poses ?? {})) as Character['poses'];

			for (const [poseName, pose] of Object.entries(poses)) {
				if (pose.asset === id) {
					delete poses[poseName];
					changed = true;
				} else if (pose.steps?.some(step => step.asset === id)) {
					const steps = pose.steps.filter(step => step.asset !== id);

					if (steps.length) {
						pose.steps = steps;
					} else {
						delete poses[poseName];
					}

					changed = true;
				}
			}

			if (changed) {
				engine.putCharacter({...character, poses});
			}
		}

		engine.delete(id, 'asset');
		revoke(id);
	}

	async putCharacter(
		character: Character,
		options: ScopeOptions = {}
	): Promise<Character> {
		const engine = await this.engine();
		const own = this.ensureOwn(engine);
		const view = storyView(engine, this.scope);
		const stored = migrateCharacter(
			JSON.parse(JSON.stringify(character)) as Character
		);
		let record = view.resolver.character(stored.id);

		if (!record && view.names.has(stored.id)) {
			throw new Error(
				`Something else in this library is already called ${stored.id}.`
			);
		}

		if (record && this.decide(engine, 'character', record, options) === 'fork') {
			record = this.forkCharacter(engine, record);
		}

		const saved = engine.putCharacter({
			...characterFields(stored),
			charId: stored.id,
			collection: record?.collection ?? own,
			...(record ? {id: record.id} : {})
		});

		this.stampPoseOwners(engine, saved);

		return toCharacter(saved);
	}

	/** Pose images in the own collection learn their owner, and become `frame`s. */
	private stampPoseOwners(engine: LibraryEngine, character: CharacterRecord) {
		const own = engine.binding(this.scope)?.own;

		for (const pose of Object.values(character.poses ?? {})) {
			for (const assetId of poseAssets(pose)) {
				const asset = this.assetRecord(engine, assetId);

				if (
					asset &&
					asset.collection === own &&
					(asset.ownerCharacter !== character.charId || asset.kind !== 'frame')
				) {
					engine.updateAsset(asset.id, {
						kind: 'frame',
						ownerCharacter: character.charId
					});
				}
			}
		}
	}

	/**
	 * Rename keeps the record (uuid, poses, pose images). The old put-new + remove-old
	 * pair deleted the pose images both characters shared.
	 */
	async renameCharacter(
		oldId: string,
		newId: string,
		options: ScopeOptions = {}
	): Promise<Character> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		let record = view.resolver.character(oldId);

		if (!record) {
			throw new Error(`There is no character ${oldId}.`);
		}

		if (oldId === newId) {
			return toCharacter(record);
		}

		if (view.names.has(newId)) {
			throw new Error(
				`Something else in this library is already called ${newId}.`
			);
		}

		if (this.decide(engine, 'character', record, options) === 'fork') {
			record = this.forkCharacter(engine, record);
		}

		const renamed = engine.rename(record.id, newId) as CharacterRecord;

		this.stampPoseOwners(engine, renamed);

		return toCharacter(renamed);
	}

	async removeCharacter(id: string, options: ScopeOptions = {}): Promise<void> {
		const engine = await this.engine();
		const view = storyView(engine, this.scope);
		const record = view.resolver.character(id);

		if (!record) {
			return;
		}

		if (this.decide(engine, 'character', record, options) === 'fork') {
			throw new Error(
				`${id} lives in another collection; it cannot be removed from one story. Detach the collection instead.`
			);
		}

		const images = Object.values(record.poses ?? {}).flatMap(poseAssets);

		engine.delete(record.id, 'character');

		// Its pose images go too — unless another character still draws them (a rename
		// done as put-new + remove-old, or two characters sharing art).
		const stillUsed = new Set(
			engine
				.characters()
				.flatMap(other => Object.values(other.poses ?? {}).flatMap(poseAssets))
		);

		for (const assetId of new Set(images)) {
			const asset = this.assetRecord(engine, assetId);

			if (asset && asset.collection === record.collection && !stillUsed.has(assetId)) {
				engine.delete(assetId, 'asset');
				revoke(assetId);
			}
		}
	}

	async applySyncedProvenance(): Promise<AssetMeta> {
		throw new Error('Old asset sync is gone: the library syncs records.');
	}

	async applySyncedBytes(): Promise<AssetMeta> {
		throw new Error('Old asset sync is gone: the library syncs records.');
	}
}

const facades = new Map<string, LibraryAssetStore>();

/** One facade per story id. Cheap: all state lives in the engine. */
export function storyAssetStore(storyId: string): LibraryAssetStore {
	let store = facades.get(storyId);

	if (!store) {
		store = new LibraryAssetStore(storyId);
		facades.set(storyId, store);
	}

	return store;
}

export function resetStoryAssetStoresForTests(): void {
	facades.clear();

	for (const id of [...urls.keys()]) {
		revoke(id);
	}
}
