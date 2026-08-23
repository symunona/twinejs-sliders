/**
 * `cat` — hand out passage text, or point at asset bytes (spec 12 §3).
 *
 * A passage lives as a JSON string inside `story.json`, so it is the one thing an agent
 * cannot read with `Read`. Everything `cat` writes carries its receipt, which is the whole of
 * the state this CLI keeps: no index, no sync record, delete the file and lose nothing.
 *
 * Assets are the opposite case. In local mode the blob is already a file with a real
 * extension, so `cat` prints its path instead of copying it — an image model wants a path,
 * and a copy would just be a second thing to keep current.
 */

import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {hashText, parse, stamp} from '../passage';
import {parseRef, pickAsset, resolve, slug} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx, PassageObject, StoryBody} from '../types';

export const name = 'cat';
export const summary = 'hand out a passage as text with its receipt, or locate an asset';

function stringFlag(ctx: Ctx, ...keys: string[]): string | undefined {
	for (const key of keys) {
		const value = ctx.flags[key];

		if (typeof value === 'string') {
			return value;
		}
	}

	return undefined;
}

/** One file per passage, named so a human can find it and a glob can collect it. */
export function fileNameFor(passage: PassageObject, all: PassageObject[]): string {
	const base = slug(passage.name) || passage.id;
	const clash = all.filter(other => (slug(other.name) || other.id) === base).length > 1;

	return `${clash ? `${base}-${passage.id.slice(0, 6)}` : base}.md`;
}

async function writeOut(path: string, contents: string): Promise<void> {
	await mkdir(join(path, '..'), {recursive: true});
	await writeFile(path, contents, 'utf8');
}

async function readIfPresent(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8');
	} catch {
		return undefined;
	}
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const spec = args[0];

	if (!spec) {
		throw new CliError('cat <ref> [-o file] [--all -o dir] [--refresh]', EXIT.usage);
	}

	const out = stringFlag(ctx, 'o', 'out');
	const refresh = ctx.flags.refresh === true;

	// `cat --refresh tmp/p.md` — the file names itself, which is the form that matters when
	// the ref that produced it is three commands ago.
	const existing = refresh ? await readIfPresent(spec) : undefined;
	const ref = existing
		? (() => {
				const {receipt} = parse(existing);

				return `${receipt.story}/${receipt.passage}`;
			})()
		: spec;
	const target = existing ? spec : out;
	const parsed = parseRef(ref);

	if (parsed.kind === 'asset') {
		return catAsset(ctx, parsed.story, parsed.asset, out);
	}

	const resolved = await resolve(ctx.source, parsed);

	if (ctx.flags.all === true) {
		return catAll(ctx, resolved.body, resolved.rev, out);
	}

	if (!resolved.passage) {
		throw new CliError(
			`"${spec}" names a story, not a passage — try "${spec}/<passage>" or --all -o <dir>`,
			EXIT.usage
		);
	}

	if (refresh && target) {
		// Refusing here is the point: `--refresh` exists so a stale copy is one command from
		// current, not so unsaved work is one command from gone.
		const onDisk = existing ?? (await readIfPresent(target));

		if (onDisk !== undefined) {
			const {receipt, text} = parse(onDisk);

			if (hashText(text) !== receipt.hash) {
				throw new CliError(
					`${target} has local edits — put or discard them before --refresh`,
					EXIT.conflict
				);
			}
		}
	}

	const contents = stamp(resolved.body, resolved.passage, resolved.rev);

	if (target) {
		await writeOut(target, contents);
		ctx.out(`${target}  ${resolved.passage.name}  rev ${resolved.rev}`);
	} else {
		process.stdout.write(contents);
	}

	return EXIT.ok;
}

async function catAll(
	ctx: Ctx,
	body: StoryBody,
	rev: number,
	dir: string | undefined
): Promise<number> {
	if (!dir) {
		throw new CliError('cat --all needs -o <dir>', EXIT.usage);
	}

	const passages = body.passages ?? [];

	await mkdir(dir, {recursive: true});

	for (const passage of passages) {
		const path = join(dir, fileNameFor(passage, passages));

		await writeFile(path, stamp(body, passage, rev), 'utf8');
		ctx.out(`${path}  ${passage.name}`);
	}

	ctx.out(`${passages.length} passages at rev ${rev}`);

	return EXIT.ok;
}

async function catAsset(
	ctx: Ctx,
	storySpec: string,
	assetSpec: string,
	out: string | undefined
): Promise<number> {
	const {meta} = await resolve(ctx.source, {kind: 'story', story: storySpec});
	const manifest = await ctx.source.manifest(meta.id);
	const asset = pickAsset(manifest, assetSpec);
	const path = await ctx.source.assetPath(meta.id, asset.id);

	if (path) {
		// Local mode: the blob is a file. Print where it is.
		process.stdout.write(`${path}\n`);

		return EXIT.ok;
	}

	if (!out) {
		throw new CliError(
			`${asset.id} is not a file on this machine — give -o <file> to fetch it`,
			EXIT.usage
		);
	}

	const bytes = await ctx.source.assetBytes(meta.id, asset.id);

	await mkdir(join(out, '..'), {recursive: true});
	await writeFile(out, bytes);
	ctx.out(`${out}  ${asset.id}  ${asset.name}  ${bytes.length} bytes`);

	return EXIT.ok;
}
