/**
 * `copy` — clone a story on the server (spec 12 §6).
 *
 * A copy is a *different* story, so everything that identifies one is minted fresh: the
 * story uuid, the IFID — an IFID is meant to stay stable across import and export of the
 * same story, which is exactly why a fork of it must not inherit one — and every passage
 * id, because passage ids are per story and a second story handing out the same ones makes
 * every receipt and every sync record ambiguous. Names, positions, tags and text cross
 * verbatim, and the new story starts its own rev chain at 1.
 *
 * Scene ids are the one thing kept by default. They are unique *within* a story (spec 02)
 * and the index is built per story, so two stories may both name a scene `tavern-night`
 * without either being wrong. `--reid <prefix>` opts into renaming them, and then it has to
 * rewrite every reference as well: a `from:` in some other passage still pointing at the
 * old id would resolve against nothing at all.
 *
 * That rewrite runs over the scene block as TEXT, line by line, rather than parsing the
 * YAML and printing it back. A round trip through the parser would reflow the author's
 * layout and drop every comment — a far bigger change to the passage than the one asked
 * for, and one that would show up in every diff of the copy forever after.
 */

import {randomUUID} from 'node:crypto';
import {extractSceneBlock, splitSceneRef} from '@sliders/scene-index';
import type {SceneBlock} from '@sliders/scene-index';
import {parseRef, resolve} from '../ref';
import {CliError, EXIT} from '../types';
import type {AssetMetaRow, Ctx, Manifest, PassageObject, StoryBody} from '../types';

export const name = 'copy';
export const summary =
	'Clone a story server-side: new id, new ifid, new passage ids';

const USAGE =
	'usage: twine-cli copy <story>[@rev] --name "<name>" [--reid <prefix>] [--assets copy|link|none]';

/** What `--assets` may say. `copy` is the default because it is the answer people mean. */
export type AssetMode = 'copy' | 'link' | 'none';

export interface CloneOptions {
	/** Name of the new story. Required — two stories with one name confuse the editor. */
	name: string;
	/** `--reid`. Prepended verbatim: `ep4-` turns `tavern-night` into `ep4-tavern-night`. */
	reid?: string;
	/** Injected by tests so ids are predictable; production uses `crypto.randomUUID`. */
	uuid?: () => string;
}

/** A scene reference `--reid` found but could not rename, and why. */
export interface UnrewrittenRef {
	passage: string;
	/** 1-indexed line within the passage text, so it can be read with an offset. */
	line: number;
	ref: string;
	reason: string;
}

export interface CloneResult {
	body: StoryBody;
	/** old passage id -> new passage id. */
	passageIds: Map<string, string>;
	/** old scene id -> new scene id. Empty unless `--reid` was given. */
	sceneIds: Map<string, string>;
	unrewritten: UnrewrittenRef[];
}

/**
 * Everything about a copy that does not need the server. Pure, and exported for that
 * reason: the id minting and the `--reid` rewrite are where this command can actually be
 * wrong, and both are testable against a fixture body with no store in sight.
 */
export function cloneBody(body: StoryBody, opts: CloneOptions): CloneResult {
	const uuid = opts.uuid ?? randomUUID;
	const storyId = uuid();
	const passages: PassageObject[] = Array.isArray(body.passages)
		? body.passages
		: [];
	const passageIds = new Map(passages.map(passage => [passage.id, uuid()]));
	const sceneIds = opts.reid
		? new Map(
				sceneIdsOf(passages).map(id => [id, `${opts.reid}${id}`] as const)
			)
		: new Map<string, string>();
	const unrewritten: UnrewrittenRef[] = [];

	const nextPassages = passages.map(passage => ({
		...passage,
		id: passageIds.get(passage.id) as string,
		// Passages carry the id of their story; leaving the old one behind would point
		// every passage of the copy at the story it was copied from.
		story: storyId,
		text: opts.reid
			? rewriteSceneIds(passage, sceneIds, unrewritten)
			: passage.text
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

	return {body: next, passageIds, sceneIds, unrewritten};
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

	const reid = flag(ctx, 'reid');
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

	const clone = cloneBody(from.body, {name: wanted, reid});

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
				scenes: Object.fromEntries(clone.sceneIds),
				assets,
				unrewritten: clone.unrewritten
			})
		);
	} else {
		report(ctx, clone, written.rev, sourceId, rev, mode, assets);
	}

	// The story is written either way; a blob that did not make it is still a broken copy,
	// and a script that only looks at the exit code has to hear about it.
	return assets.failed.length > 0 ? EXIT.server : EXIT.ok;
}

// ---------------------------------------------------------------------------
// Scene ids
// ---------------------------------------------------------------------------

/**
 * One `id:` or `from:` line of a scene block, with enough context to put it back.
 *
 * Only column-zero lines qualify. Both keys exist deeper in the grammar — `fx:` entries
 * carry an `id`, and nothing stops an author naming a cast entry `from` — and renaming one
 * of those would corrupt the scene rather than move it.
 */
interface KeyLine {
	/** 0-based line index within the scene block. */
	index: number;
	key: 'id' | 'from';
	value: string;
	/** The line rebuilt around a new scalar, keeping quoting and any trailing comment. */
	rewrite(next: string): string;
}

const KEY_LINE = /^(id|from)([ \t]*:[ \t]*)(.*)$/;

interface SceneScan {
	block: SceneBlock;
	lines: string[];
	keys: KeyLine[];
}

function scanSceneKeys(text: string): SceneScan | undefined {
	const block = extractSceneBlock(text);

	if (!block) {
		return undefined;
	}

	const lines = block.text.split('\n');
	const keys: KeyLine[] = [];

	lines.forEach((line, index) => {
		const match = KEY_LINE.exec(line);

		if (!match) {
			return;
		}

		const [, key, separator, rest] = match;
		const scalar = splitScalar(rest);

		keys.push({
			index,
			key: key as 'id' | 'from',
			value: scalar.value,
			rewrite: next =>
				`${key}${separator}${scalar.quote}${next}${scalar.quote}${scalar.suffix}`
		});
	});

	return {block, lines, keys};
}

/**
 * The scalar of a YAML value line, split from whatever follows it.
 *
 * `suffix` is everything after the scalar — the trailing whitespace and comment — kept
 * verbatim so a rename does not quietly reformat the line it touches.
 */
function splitScalar(rest: string): {
	quote: string;
	value: string;
	suffix: string;
} {
	const quote = rest[0] === '"' || rest[0] === "'" ? rest[0] : '';

	if (quote) {
		const end = rest.indexOf(quote, 1);

		if (end !== -1) {
			return {quote, value: rest.slice(1, end), suffix: rest.slice(end + 1)};
		}
	}

	// A `#` opens a comment only at the start of the value or after whitespace; inside a
	// plain scalar it is an ordinary character.
	const comment = /(^|[ \t])#/.exec(rest);
	const end = comment ? comment.index + comment[1].length : rest.length;
	const value = rest.slice(0, end).trimEnd();

	return {quote: '', value, suffix: rest.slice(value.length)};
}

/** Every scene id the story defines, in the order the passages define them. */
function sceneIdsOf(passages: PassageObject[]): string[] {
	const ids: string[] = [];

	for (const passage of passages) {
		const scan = scanSceneKeys(passage.text);

		for (const key of scan?.keys ?? []) {
			if (key.key === 'id' && key.value !== '' && !ids.includes(key.value)) {
				ids.push(key.value);
			}
		}
	}

	return ids;
}

/** YAML's several spellings of "no value", which are not scene references. */
const EMPTY_SCALARS = new Set(['', '~', 'null', 'Null', 'NULL']);

/**
 * One passage's scene block with every id and every reference to one renamed.
 *
 * References resolve against the whole story's id map, not this passage's, because that is
 * what `from:` means: `street` continuing from `tavern-night` two passages away is the
 * normal case, and it is the case a rename most easily breaks.
 */
function rewriteSceneIds(
	passage: PassageObject,
	sceneIds: Map<string, string>,
	unrewritten: UnrewrittenRef[]
): string {
	const scan = scanSceneKeys(passage.text);

	if (!scan) {
		return passage.text;
	}

	const {block, lines, keys} = scan;
	let changed = false;

	for (const key of keys) {
		if (EMPTY_SCALARS.has(key.value)) {
			continue;
		}

		// An `id:` is a definition, never `id@mark`; splitting one would eat a legal, if
		// odd, character out of the id.
		const {id, mark} =
			key.key === 'id' ? {id: key.value, mark: undefined} : splitSceneRef(key.value);
		const renamed = sceneIds.get(id);

		if (!renamed) {
			unrewritten.push({
				passage: passage.name,
				line: block.lineOffset + key.index + 1,
				ref: key.value,
				reason: `no scene in this story has id "${id}" — left as it was`
			});
			continue;
		}

		lines[key.index] = key.rewrite(mark ? `${renamed}@${mark}` : renamed);
		changed = true;
	}

	if (!changed) {
		return passage.text;
	}

	// Splice on character offsets so everything outside the block — vars section, prose,
	// links, other modifiers — survives byte for byte.
	return (
		passage.text.slice(0, block.offset) +
		lines.join('\n') +
		passage.text.slice(block.offset + block.text.length)
	);
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

	if (clone.sceneIds.size > 0) {
		ctx.out(`  scenes    ${clone.sceneIds.size} renamed`);
	}

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

	for (const ref of clone.unrewritten) {
		ctx.out(`  ! ${ref.passage}:${ref.line}  ${ref.ref} — ${ref.reason}`);
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
