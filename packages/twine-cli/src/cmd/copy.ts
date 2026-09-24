/**
 * `copy` — clone a story on the server (spec 12 §6).
 *
 * A copy is a *different* story, so everything that identifies one is minted fresh: the
 * story uuid, the IFID — an IFID is meant to stay stable across import and export of the
 * same story, which is exactly why a fork of it must not inherit one — and every passage
 * id, because passage ids are per story and a second story handing out the same ones makes
 * every receipt and every sync record ambiguous. Names, positions, tags and text cross
 * verbatim, and the new story starts its own rev chain at 1. A `from:` names a passage, so
 * it resolves in the copy exactly as it did in the original.
 */

import {randomUUID} from 'node:crypto';
import {parseRef, resolve} from '../ref';
import {CliError, EXIT} from '../types';
import type {AssetMetaRow, Ctx, Manifest, PassageObject, StoryBody} from '../types';

export const name = 'copy';
export const summary =
	'Clone a story server-side: new id, new ifid, new passage ids';

const USAGE =
	'usage: twine-cli copy <story>[@rev] --name "<name>" [--assets copy|link|none]';

/** What `--assets` may say. `copy` is the default because it is the answer people mean. */
export type AssetMode = 'copy' | 'link' | 'none';

export interface CloneOptions {
	/** Name of the new story. Required — two stories with one name confuse the editor. */
	name: string;
	/** Injected by tests so ids are predictable; production uses `crypto.randomUUID`. */
	uuid?: () => string;
}

export interface CloneResult {
	body: StoryBody;
	/** old passage id -> new passage id. */
	passageIds: Map<string, string>;
}

/**
 * Everything about a copy that does not need the server. Pure, and exported for that
 * reason: the id minting is where this command can actually be wrong, and it is testable against a fixture body with no store in sight.
 */
export function cloneBody(body: StoryBody, opts: CloneOptions): CloneResult {
	const uuid = opts.uuid ?? randomUUID;
	const storyId = uuid();
	const passages: PassageObject[] = Array.isArray(body.passages)
		? body.passages
		: [];
	const passageIds = new Map(passages.map(passage => [passage.id, uuid()]));

	const nextPassages = passages.map(passage => ({
		...passage,
		id: passageIds.get(passage.id) as string,
		// Passages carry the id of their story; leaving the old one behind would point
		// every passage of the copy at the story it was copied from.
		story: storyId
	}));

	// `sync` and `selected` are each editor's own business (spec 11) — the server strips
	// `sync` anyway, and inheriting someone's selection is noise in every diff.
	const {sync: _sync, selected: _selected, ...rest} = body;

	const next: StoryBody = {
		...rest,
		id: storyId,
		// Twine writes IFIDs uppercase; a lowercase one is legal but looks foreign next to
		// every story the editor made.
		ifid: uuid().toUpperCase(),
		name: opts.name,
		lastUpdate: new Date().toISOString(),
		passages: nextPassages,
		startPassage: startPassageOf(body, passageIds, nextPassages)
	};

	return {body: next, passageIds};
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const input = args[0];

	if (!input) {
		throw new CliError(USAGE, EXIT.usage);
	}

	const wanted = (flag(ctx, 'name') ?? '').trim();

	if (wanted === '') {
		throw new CliError(`copy needs a name.\n${USAGE}`, EXIT.usage);
	}

	const mode = (flag(ctx, 'assets') ?? 'copy') as AssetMode;

	if (mode !== 'copy' && mode !== 'link' && mode !== 'none') {
		throw new CliError(
			`--assets must be copy, link or none, not "${mode}"`,
			EXIT.usage
		);
	}

	const ref = parseRef(input);
	// One call reads the story and, when the ref carried `@37`, the body as it was then.
	const from = await resolve(ctx.source, ref);
	const sourceId = from.meta.id;
	const rev = 'rev' in ref ? ref.rev : undefined;

	// The editor refuses to create a second story with an existing name, so a copy that
	// took one would produce a library nobody can navigate.
	const taken = (await ctx.source.list(false)).find(
		story => !story.deleted && story.name.toLowerCase() === wanted.toLowerCase()
	);

	if (taken) {
		throw new CliError(
			`there is already a story named "${taken.name}" (${taken.id})`,
			EXIT.usage
		);
	}

	const clone = cloneBody(from.body, {name: wanted});

	// If-Match "0" is the whole point of writing it here: a story that does not exist is
	// rev 0 on the server, so this says "create this, never overwrite". A fresh uuid should
	// never collide, and on the day one does a 412 beats replacing someone's story.
	const written = await ctx.write.putStory(clone.body.id, clone.body, 0);

	const assets = await copyAssets(ctx, sourceId, clone.body.id, mode);

	if (ctx.json) {
		ctx.out(
			JSON.stringify({
				id: clone.body.id,
				ifid: clone.body.ifid,
				name: clone.body.name,
				rev: written.rev,
				from: {story: sourceId, rev: rev ?? null},
				passages: clone.body.passages.length,
				assets
			})
		);
	} else {
		report(ctx, clone, written.rev, sourceId, rev, mode, assets);
	}

	// The story is written either way; a blob that did not make it is still a broken copy,
	// and a script that only looks at the exit code has to hear about it.
	return assets.failed.length > 0 ? EXIT.server : EXIT.ok;
}

function startPassageOf(
	body: StoryBody,
	passageIds: Map<string, string>,
	passages: PassageObject[]
): string {
	const old = typeof body.startPassage === 'string' ? body.startPassage : '';
	const mapped = passageIds.get(old);

	if (mapped) {
		return mapped;
	}

	// A story whose start passage does not exist opens on nothing, so a copy of a story
	// that was already broken that way is fixed here rather than inherited.
	return passages[0]?.id ?? '';
}

// ---------------------------------------------------------------------------
// Assets
// ---------------------------------------------------------------------------

interface AssetReport {
	mode: AssetMode;
	/** Blobs re-uploaded under the new story id. */
	copied: number;
	/** Manifest entries carried over without their bytes. */
	linked: number;
	bytes: number;
	/** Manifest entries the source store has no bytes for. Not this command's fault. */
	absent: string[];
	/** Entries that should have copied and did not. */
	failed: {id: string; reason: string}[];
}

async function copyAssets(
	ctx: Ctx,
	sourceId: string,
	targetId: string,
	mode: AssetMode
): Promise<AssetReport> {
	const result: AssetReport = {
		mode,
		copied: 0,
		linked: 0,
		bytes: 0,
		absent: [],
		failed: []
	};

	if (mode === 'none') {
		// An empty manifest still has to be written: the new story otherwise inherits
		// nothing at all and the first asset upload has no manifest to join.
		await ctx.write.putManifest(targetId, emptyManifest(), 0);
		return result;
	}

	const manifest = await ctx.source.manifest(sourceId);
	const absent = new Set(manifest.missing ?? []);
	const rows: AssetMetaRow[] = [];

	for (const row of manifest.assets) {
		if (mode === 'link') {
			// Ids are kept, in both modes, because a manifest entry is the only thing that
			// names a blob: `link` needs the copy's row to point at the source's file, and
			// making `copy` differ would be a second rule for no gain — asset ids are
			// scoped to a story, so there is nothing to collide with.
			rows.push(row);
			result.linked++;
			continue;
		}

		if (absent.has(row.id)) {
			result.absent.push(row.id);
			rows.push(row);
			continue;
		}

		try {
			const bytes = await ctx.source.assetBytes(sourceId, row.id);

			await ctx.write.putAsset(targetId, row.id, bytes, row.hash, row.mime);
			result.copied++;
			result.bytes += bytes.length;
		} catch (error) {
			result.failed.push({id: row.id, reason: String(error)});
		}

		rows.push(row);
	}

	// Manifest after the blobs it names (spec 11): a manifest that lands first advertises
	// art that is not there yet, and every reader treats that as missing.
	await ctx.write.putManifest(
		targetId,
		{...emptyManifest(), assets: rows, characters: manifest.characters},
		0
	);

	return result;
}

function emptyManifest(): Manifest {
	return {version: 1, assets: [], characters: [], rev: 0, missing: []};
}

// ---------------------------------------------------------------------------
// Output
// ---------------------------------------------------------------------------

function report(
	ctx: Ctx,
	clone: CloneResult,
	rev: number,
	sourceId: string,
	sourceRev: number | undefined,
	mode: AssetMode,
	assets: AssetReport
): void {
	const from = sourceRev === undefined ? sourceId : `${sourceId}@${sourceRev}`;

	ctx.out(
		`${clone.body.name}  ${clone.body.id}  rev ${rev}  copied from ${from}`
	);
	ctx.out(`  ifid      ${clone.body.ifid}`);
	ctx.out(`  passages  ${clone.body.passages.length}, all with new ids`);

	if (mode === 'none') {
		ctx.out('  assets    none — the new story starts with an empty manifest');
	} else if (mode === 'link') {
		ctx.out(
			`  assets    ${assets.linked} manifest entries linked, no bytes copied`
		);
		ctx.out(
			'            blobs still live under the source story, so the copy reads as missing until they are uploaded'
		);
	} else {
		ctx.out(`  assets    ${assets.copied} copied, ${formatBytes(assets.bytes)}`);
	}

	if (sourceRev !== undefined) {
		ctx.out(
			`  note      assets came from the current manifest; the store keeps no manifest per revision here`
		);
	}

	for (const id of assets.absent) {
		ctx.out(`  ! asset ${id}: no bytes in the source store, entry copied anyway`);
	}

	for (const failure of assets.failed) {
		ctx.out(`  ! asset ${failure.id}: ${failure.reason}`);
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${(bytes / 1024).toFixed(1)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// ---------------------------------------------------------------------------
// Flags
// ---------------------------------------------------------------------------

function flag(ctx: Ctx, key: string): string | undefined {
	const value = ctx.flags[key];

	return typeof value === 'string' ? value : undefined;
}
