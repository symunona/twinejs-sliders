/**
 * `put` — take a passage back (spec 12 §3).
 *
 * The rule that makes this safe is that `put` checks the *passage*, not the story. A story
 * rev is story-wide, so plain `If-Match` would call a conflict every time somebody touched a
 * different passage; the stamped hash of this passage decides instead, and the rev is only
 * there to make the write itself atomic.
 *
 * Two consequences:
 *
 *   - the text is spliced into the body as it is *now*, so edits made elsewhere while the
 *     file was in hand survive. A passage a colleague added meanwhile is untouched, because
 *     nothing here reassembles a story from files — absence never deletes.
 *   - between reading the body and writing it, a write can land. `If-Match` catches it, and
 *     the answer is one retry: re-read, re-hash, try again, then stop. Bounded, no loop.
 */

import {createHash} from 'node:crypto';
import {readFile, readdir} from 'node:fs/promises';
import {extname, join} from 'node:path';
import {addPassage, parse, removePassage, splice, threeWay} from '../passage';
import type {PassageEdits} from '../passage';
import {parseRef, pickAsset, resolveStory} from '../ref';
import {HttpError} from '../source/http';
import {CliError, EXIT} from '../types';
import type {AssetMetaRow, Ctx, Receipt} from '../types';

export const name = 'put';
export const summary = 'splice a passage back into the story and write it through the API';

/** How many lines of a conflict to show before it stops being a report and becomes a file. */
const DIFF_LINES = 12;

/**
 * A conflict report, not a merge tool: trim the shared head and tail, print what is left.
 * Enough to see whether the other edit and yours are the same thought.
 */
function diff(theirs: string, mine: string): string[] {
	const a = theirs.split('\n');
	const b = mine.split('\n');
	let head = 0;

	while (head < a.length && head < b.length && a[head] === b[head]) {
		head++;
	}

	let tail = 0;

	while (
		tail < a.length - head &&
		tail < b.length - head &&
		a[a.length - 1 - tail] === b[b.length - 1 - tail]
	) {
		tail++;
	}

	const out = [
		...a.slice(head, a.length - tail).map(line => `  - ${line}`),
		...b.slice(head, b.length - tail).map(line => `  + ${line}`)
	];

	return out.length > DIFF_LINES
		? [...out.slice(0, DIFF_LINES), `  … ${out.length - DIFF_LINES} more lines`]
		: out;
}

interface PutResult {
	code: number;
	state: 'fresh' | 'stale-elsewhere' | 'conflict';
	rev?: number;
}

/** The three-way test plus the write, with the single bounded retry spec 12 §3 allows. */
async function applyPassage(
	ctx: Ctx,
	storyId: string,
	receipt: Receipt,
	text: string,
	label: string
): Promise<PutResult> {
	for (let attempt = 0; ; attempt++) {
		const meta = await ctx.source.meta(storyId);
		const body = await ctx.source.body(storyId);
		const state = threeWay(body, receipt, meta.rev);

		if (state === 'conflict') {
			const current = (body.passages ?? []).find(p => p.name === receipt.passage);

			ctx.out(
				`conflict  rev ${meta.rev}, ${receipt.passage} changed by ${meta.lastClient} at ${meta.updatedAt}`
			);

			if (current) {
				for (const line of diff(current.text, text)) {
					ctx.out(line);
				}
			} else {
				ctx.out(`  ${receipt.passage} is not in the story any more`);
			}

			return {code: EXIT.conflict, state};
		}

		const next = splice(body, receipt.passage, text, receipt);

		try {
			const written = await ctx.write.putStory(storyId, next, meta.rev);

			ctx.out(`${state === 'fresh' ? 'wrote' : 'wrote (rebased)'}  ${label}  rev ${written.rev}`);

			return {code: EXIT.ok, rev: written.rev, state};
		} catch (error) {
			// 412 means a write landed between the read and the write. One retry, then stop.
			if (error instanceof HttpError && error.status === 412 && attempt === 0) {
				continue;
			}

			if (error instanceof HttpError && error.status === 412) {
				ctx.out(`conflict  ${label}: the story moved twice while writing`);

				return {code: EXIT.conflict, state: 'conflict'};
			}

			throw error;
		}
	}
}

async function putOne(ctx: Ctx, file: string, storySpec?: string): Promise<PutResult> {
	const {receipt, text} = parse(await readFile(file, 'utf8'));
	const meta = await resolveStory(ctx.source, {
		kind: 'story',
		story: storySpec ?? receipt.story
	});

	return applyPassage(ctx, meta.id, receipt, text, `${file} → ${receipt.passage}`);
}

async function putAll(ctx: Ctx, dir: string, storySpec?: string): Promise<number> {
	const entries = await readdir(dir, {withFileTypes: true});
	let worst: number = EXIT.ok;

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}

		const path = join(dir, entry.name);
		let result: PutResult;

		try {
			result = await putOne(ctx, path, storySpec);
		} catch (error) {
			// Files `cat` did not hand out are skipped, not failed: a directory of edits is
			// allowed to hold notes.
			if (error instanceof CliError && error.message.startsWith('not a `cat` receipt')) {
				ctx.out(`skip      ${path}  no receipt`);
				continue;
			}

			throw error;
		}

		worst = Math.max(worst, result.code);
	}

	return worst;
}

const MIME_BY_EXT: Record<string, string> = {
	'.gif': 'image/gif',
	'.jpeg': 'image/jpeg',
	'.jpg': 'image/jpeg',
	'.png': 'image/png',
	'.webp': 'image/webp'
};

/**
 * Upload bytes for an asset. A known name or id replaces the bytes and keeps the id — ids are
 * identity, the hash is content (spec 03) — and an unknown name creates an entry.
 *
 * Dimensions are only known for an asset that already exists: reading them out of the bytes
 * would mean a decoder for four formats, and the editor rewrites them the first time it
 * renders the picture.
 */
async function putAsset(
	ctx: Ctx,
	storySpec: string,
	assetSpec: string,
	file: string
): Promise<number> {
	const meta = await resolveStory(ctx.source, {kind: 'story', story: storySpec});
	const manifest = await ctx.source.manifest(meta.id);
	const bytes = await readFile(file);
	const hash = createHash('sha256').update(bytes).digest('hex');
	const mime = MIME_BY_EXT[extname(file).toLowerCase()] ?? 'application/octet-stream';

	let asset: AssetMetaRow | undefined;

	try {
		asset = pickAsset(manifest, assetSpec);
	} catch (error) {
		if (!(error instanceof CliError) || error.code !== EXIT.notFound) {
			throw error;
		}
	}

	const kind = typeof ctx.flags.kind === 'string' ? ctx.flags.kind : (asset?.kind ?? 'object');
	const taken = new Set(manifest.assets.map(entry => entry.id));
	let id = asset?.id;

	while (!id) {
		const candidate = `a_${createHash('sha256')
			.update(`${hash}${taken.size}${Math.random()}`)
			.digest('hex')
			.slice(0, 4)}`;

		if (!taken.has(candidate)) {
			id = candidate;
		}
	}

	// Blobs first, manifest second — the store's own ordering, so a manifest never names
	// bytes that are not there yet.
	await ctx.write.putAsset(meta.id, id, bytes, hash, mime);

	const row: AssetMetaRow = {
		bytes: bytes.length,
		h: asset?.h ?? 0,
		hash,
		id,
		kind,
		mime,
		name: asset?.name ?? assetSpec,
		tags: asset?.tags ?? [],
		w: asset?.w ?? 0
	};

	if (asset?.ownerCharacter) {
		row.ownerCharacter = asset.ownerCharacter;
	}

	const assets = asset
		? manifest.assets.map(entry => (entry.id === id ? row : entry))
		: [...manifest.assets, row];

	await ctx.write.putManifest(meta.id, {...manifest, assets}, manifest.rev);
	ctx.out(`wrote  ${meta.name}:${row.name}  ${id}  ${bytes.length} bytes`);

	return EXIT.ok;
}

/**
 * `put --new`: a passage that does not exist yet, from a file that has no receipt.
 *
 * A receipt describes what the store handed out, and nothing was handed out here, so the
 * file may be plain text. Front matter is honoured when present — that is how a create can
 * also set tags and a position — but never required.
 */
async function createPassage(ctx: Ctx, spec: string, file: string): Promise<number> {
	const ref = parseRef(spec);

	if (ref.kind !== 'passage') {
		throw new CliError('put --new needs <story>/<passage name>', EXIT.usage);
	}

	const meta = await resolveStory(ctx.source, ref.story);
	const body = await ctx.source.body(meta.id);
	const raw = await readFile(file, 'utf8');

	// Front matter is optional here, so a parse failure means "plain text", not an error.
	let text = raw;
	let edits: PassageEdits | undefined;

	if (raw.startsWith('---\n')) {
		try {
			const parsed = parse(raw);

			text = parsed.text;
			edits = {name: parsed.receipt.name, tags: parsed.receipt.tags, at: parsed.receipt.at};
		} catch {
			text = raw;
		}
	}

	const name = edits?.name ?? ref.passage;
	const written = await ctx.write.putStory(
		meta.id,
		addPassage(body, name, text, edits ? {...edits, name} : undefined),
		meta.rev
	);

	ctx.out(`created  ${meta.name}/${name}  rev ${written.rev}`);

	return EXIT.ok;
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const deleting = typeof ctx.flags.delete === 'string' ? ctx.flags.delete : undefined;

	if (deleting !== undefined) {
		const spec = args[0];

		if (!spec) {
			throw new CliError('put <story> --delete "<passage>"', EXIT.usage);
		}

		// Deletion is explicit or it does not happen: `put --all` never removes a passage
		// just because no file mentioned it.
		const meta = await resolveStory(ctx.source, spec);
		const body = await ctx.source.body(meta.id);
		const written = await ctx.write.putStory(
			meta.id,
			removePassage(body, deleting),
			meta.rev
		);

		ctx.out(`deleted  ${deleting}  rev ${written.rev}`);

		return EXIT.ok;
	}

	if (ctx.flags.new === true) {
		const [spec, file] = args;

		if (!spec || !file) {
			throw new CliError('put <story>/<passage> <file> --new', EXIT.usage);
		}

		return createPassage(ctx, spec, file);
	}

	if (ctx.flags.all === true) {
		const [first, second] = args;
		const dir = second ?? first;

		if (!dir) {
			throw new CliError('put <story> --all <dir>', EXIT.usage);
		}

		return putAll(ctx, dir, second ? first : undefined);
	}

	const [first, second] = args;

	if (!first) {
		throw new CliError('put <ref> <file>', EXIT.usage);
	}

	if (second) {
		const ref = parseRef(first);

		if (ref.kind === 'asset') {
			return putAsset(ctx, ref.story, ref.asset, second);
		}

		// A passage ref alongside a file is a story hint; the receipt still names the passage,
		// so a file cannot be written over a passage it was not taken from.
		return (await putOne(ctx, second, ref.story)).code;
	}

	return (await putOne(ctx, first)).code;
}
