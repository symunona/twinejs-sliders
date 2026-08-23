/**
 * `Source` over the store's DATA_DIR (spec 12 §0).
 *
 * The server writes every file by temp-file + rename, so a reader on the same box sees a
 * whole old version or a whole new one and never half of either. That is the entire licence
 * for this class: no lock, no cache, no copy, just `readFileSync` on the same bytes the
 * server would have serialised over HTTP.
 *
 * The layout mirrors `server/store/store.go` exactly, including the `.gz` naming and the
 * closed set of blob extensions. It has to: a guess here reads the wrong file silently.
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {gunzipSync} from 'node:zlib';
import {CliError, EXIT} from '../types';
import type {Manifest, RevisionRow, Source, StoryBody, StoryMeta} from '../types';

/**
 * The names a blob can have on disk — `assetExtensions` in `server/store/assets.go`. Tried in
 * turn rather than globbed, so an asset id containing a dot cannot be mistaken for another
 * asset's extension.
 */
const ASSET_EXTENSIONS = ['.webp', '.png', '.jpg', '.gif', '.bin'];

async function readJson<T>(path: string): Promise<T | undefined> {
	try {
		return JSON.parse(await readFile(path, 'utf8')) as T;
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
			return undefined;
		}

		throw error;
	}
}

/** `revs/000042.json.gz` — six digits, zero padded, same as `revBodyPath` in Go. */
function revFileName(rev: number): string {
	return `${String(rev).padStart(6, '0')}.json.gz`;
}

/** meta.json carries more than StoryMeta; the extra fields are the store's business. */
interface StoredMeta extends StoryMeta {
	deletedAt?: string;
	hash?: string;
	restoredFrom?: number;
}

interface StoredManifest {
	version?: number;
	assets?: Manifest['assets'];
	characters?: unknown[];
	rev?: number;
}

export class LocalSource implements Source {
	readonly mode = 'local' as const;

	constructor(readonly dataDir: string) {}

	private storyDir(storyId: string): string {
		return join(this.dataDir, 'stories', storyId);
	}

	async list(includeDeleted = false): Promise<StoryMeta[]> {
		let entries: string[];

		try {
			entries = await readdir(join(this.dataDir, 'stories'));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				return [];
			}

			throw error;
		}

		const out: StoryMeta[] = [];

		for (const id of entries) {
			// A directory with no readable meta is not a story yet, or is mid-repair. The
			// server skips it for the same reason: one bad story must not break the library.
			const meta = await readJson<StoredMeta>(join(this.storyDir(id), 'meta.json'));

			if (!meta) {
				continue;
			}

			if (meta.deleted && !includeDeleted) {
				continue;
			}

			out.push({...meta, id});
		}

		out.sort((a, b) =>
			a.updatedAt === b.updatedAt
				? a.id.localeCompare(b.id)
				: b.updatedAt.localeCompare(a.updatedAt)
		);

		return out;
	}

	async meta(storyId: string): Promise<StoryMeta> {
		const meta = await readJson<StoredMeta>(join(this.storyDir(storyId), 'meta.json'));

		if (!meta) {
			throw new CliError(`no story ${storyId} in ${this.dataDir}`, EXIT.notFound);
		}

		return {...meta, id: storyId};
	}

	async body(storyId: string, rev?: number): Promise<StoryBody> {
		const meta = await this.meta(storyId);

		if (rev === undefined || rev === meta.rev) {
			if (meta.deleted) {
				throw new CliError(`story ${storyId} is deleted`, EXIT.notFound);
			}

			const body = await readJson<StoryBody>(join(this.storyDir(storyId), 'story.json'));

			if (!body) {
				throw new CliError(`story ${storyId} has no body on disk`, EXIT.notFound);
			}

			return body;
		}

		let gz: Buffer;

		try {
			gz = await readFile(join(this.storyDir(storyId), 'revs', revFileName(rev)));
		} catch (error) {
			if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
				throw new CliError(`story ${storyId} has no rev ${rev}`, EXIT.notFound);
			}

			throw error;
		}

		return JSON.parse(gunzipSync(gz).toString('utf8')) as StoryBody;
	}

	async manifest(storyId: string): Promise<Manifest> {
		const stored = await readJson<StoredManifest>(join(this.storyDir(storyId), 'assets.json'));
		const meta = await this.meta(storyId);
		const manifest: Manifest = {
			assets: stored?.assets ?? [],
			characters: stored?.characters ?? [],
			missing: [],
			rev: stored?.rev ?? meta.assetRev ?? 0,
			version: stored?.version ?? 1
		};

		// `missing` is a fact about the blobs on disk right now, which is why the server
		// computes it per response and never stores it. Same here.
		for (const asset of manifest.assets) {
			if (!(await this.assetPath(storyId, asset.id))) {
				manifest.missing.push(asset.id);
			}
		}

		return manifest;
	}

	async assetPath(storyId: string, assetId: string): Promise<string | undefined> {
		for (const ext of ASSET_EXTENSIONS) {
			const path = join(this.storyDir(storyId), 'assets', assetId + ext);

			try {
				const info = await stat(path);

				if (info.isFile()) {
					return path;
				}
			} catch {
				continue;
			}
		}

		return undefined;
	}

	async assetBytes(storyId: string, assetId: string): Promise<Buffer> {
		const path = await this.assetPath(storyId, assetId);

		if (!path) {
			throw new CliError(`asset ${assetId} has no bytes in the store`, EXIT.notFound);
		}

		return readFile(path);
	}

	async revisions(storyId: string): Promise<RevisionRow[]> {
		const meta = await this.meta(storyId);
		const index = (await readJson<RevisionRow[]>(
			join(this.storyDir(storyId), 'revs', 'index.json')
		)) ?? [];

		index.sort((a, b) => a.rev - b.rev);

		// The current version leads the list, exactly as `Store.Revisions` builds it: it is
		// story.json rather than a snapshot, but a version you cannot see reads as lost.
		const out: RevisionRow[] = [];

		if (!meta.deleted) {
			const stored = meta as StoredMeta;
			const current: RevisionRow = {
				at: meta.updatedAt,
				bytes: meta.bytes,
				client: meta.lastClient,
				hash: stored.hash ?? '',
				passages: meta.passageCount,
				rev: meta.rev
			};

			if (stored.restoredFrom) {
				current.restoredFrom = stored.restoredFrom;
			}

			out.push(current);
		}

		for (let i = index.length - 1; i >= 0; i--) {
			out.push(index[i]);
		}

		return out;
	}
}
