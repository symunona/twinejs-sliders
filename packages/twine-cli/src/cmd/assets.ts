/**
 * `assets <story> [--scene <id>] [--all-frames] [--unused] [--missing] [--fetch -o <dir>]`
 * — spec 12 §4.
 *
 * Two questions. "What is here" is a manifest listing. "What does this scene reach" is the
 * resolution in `../assets`, and it is the one worth having: every row is either a real path
 * an agent can `Read` and feed to an image model, or the reason there is no path yet, which
 * is the work list.
 *
 * Local mode prints the store's own blob path and copies nothing. Bytes only move on
 * `--fetch`, because a store on this machine has already put the file where it belongs and
 * a second copy is just a stale one waiting to happen.
 */

import {mkdirSync, writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {Scene} from '@sliders/scene-types';
import {catalogRows, loadCatalog, referencedAssetIds, resolveSceneAssets} from '../assets';
import type {AssetRow} from '../assets';
import {resolve} from '../ref';
import {EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'assets';
export const summary = 'what exists, what a scene needs, with real paths';

const EXTENSIONS: Record<string, string> = {
	'image/apng': 'apng',
	'image/gif': 'gif',
	'image/jpeg': 'jpg',
	'image/png': 'png',
	'image/webp': 'webp'
};

function extensionFor(mime: string): string {
	return EXTENSIONS[mime] ?? 'bin';
}

/** The right-hand column: a path, or the reason there is none yet. */
function whereOf(row: AssetRow): string {
	if (row.present === 'unknown') {
		return 'NOT IN MANIFEST';
	}

	if (row.present === 'missing-blob') {
		return 'MISSING BLOB';
	}

	return row.path ?? '(remote — use --fetch)';
}

function humanBytes(bytes: number): string {
	if (bytes >= 1024 * 1024) {
		return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
	}

	return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function pad(value: string, width: number): string {
	return value.length >= width ? value : value + ' '.repeat(width - value.length);
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const positional = args.filter(arg => !arg.startsWith('-'));
	const target = positional[0];

	if (target === undefined) {
		ctx.out('usage: twine-cli assets <story> [--scene <id>] [--all-frames] [--unused] [--missing]');

		return EXIT.usage;
	}

	const sceneId = typeof ctx.flags.scene === 'string' ? ctx.flags.scene : undefined;
	const allFrames = ctx.flags['all-frames'] === true;
	const onlyUnused = ctx.flags.unused === true;
	const onlyMissing = ctx.flags.missing === true;
	const fetch = ctx.flags.fetch === true;
	const outDir = typeof ctx.flags.o === 'string' ? ctx.flags.o : undefined;

	const {body, meta: story} = await resolve(ctx.source, target);
	const storyId = story.id;
	const catalog = await loadCatalog(ctx.source, storyId);

	// Every scene in the story, once — needed for the `from:` walk and for "unused".
	const scenes = new Map<string, Scene>();
	const all: Scene[] = [];

	for (const passage of body.passages ?? []) {
		const block = extractSceneBlock(passage.text ?? '');

		if (!block) {
			continue;
		}

		const scene = parseScene(block.text).scene;

		all.push(scene);

		if (scene.id !== undefined && !scenes.has(scene.id)) {
			scenes.set(scene.id, scene);
		}
	}

	let rows: AssetRow[];

	if (sceneId !== undefined) {
		const scene = scenes.get(sceneId);

		if (!scene) {
			ctx.out(`no scene '${sceneId}' in ${target}`);

			return EXIT.notFound;
		}

		rows = resolveSceneAssets(scene, catalog, {
			allFrames,
			scenes: id => scenes.get(id)
		});
	} else {
		rows = catalogRows(catalog);
	}

	if (onlyMissing) {
		rows = rows.filter(row => row.present !== 'present');
	}

	if (onlyUnused) {
		const used = referencedAssetIds(all, catalog);

		rows = rows.filter(row => row.id !== '' && !used.has(row.id));
	}

	// Only the listing can say "unused"; inside a scene every row is used by definition.
	const unused =
		sceneId === undefined && !onlyUnused
			? referencedAssetIds(all, catalog)
			: undefined;

	if (fetch) {
		if (outDir === undefined) {
			ctx.out('--fetch needs -o <dir>');

			return EXIT.usage;
		}

		mkdirSync(outDir, {recursive: true});

		for (const row of rows) {
			if (row.id === '' || row.present !== 'present') {
				continue;
			}

			const blob = catalog.byId.get(row.id);
			const file = join(outDir, `${row.id}.${extensionFor(blob?.mime ?? '')}`);

			writeFileSync(file, await ctx.source.assetBytes(storyId, row.id));

			if (!ctx.quiet) {
				ctx.out(file);
			}
		}

		return EXIT.ok;
	}

	for (const row of rows) {
		if (ctx.json) {
			ctx.out(
				JSON.stringify({
					bytes: row.bytes,
					hash: row.hash,
					id: row.id,
					inherited: row.inherited,
					kind: row.kind,
					name: row.name,
					path: row.path,
					present: row.present,
					via: row.via
				})
			);
			continue;
		}

		const blob = row.id === '' ? undefined : catalog.byId.get(row.id);
		const columns = [
			pad(row.id === '' ? '—' : row.id, 8),
			pad(row.kind, 7),
			pad(row.name, 20)
		];

		if (sceneId === undefined) {
			columns.push(
				pad(blob ? `${blob.w}x${blob.h}` : '', 10),
				pad(humanBytes(row.bytes), 9)
			);
		}

		columns.push(whereOf(row));

		if (row.via !== '') {
			columns.push(`  ${row.via}${row.inherited ? ' (inherited)' : ''}`);
		}

		if (unused && row.id !== '' && !unused.has(row.id)) {
			columns.push('  unused');
		}

		ctx.out(columns.join(' ').trimEnd());
	}

	return EXIT.ok;
}
