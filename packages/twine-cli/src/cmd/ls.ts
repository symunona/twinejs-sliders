/**
 * `ls` — one line per story (spec 12 §1).
 *
 * The counts all come from `meta.json`, which the store keeps current for exactly this: a
 * library listing must not have to open a single body.
 */

import {slug} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx, StoryMeta} from '../types';

export const name = 'ls';
export const summary = 'one line per story: ref, name, rev, passages, assets, size, tokens';

function size(bytes: number): string {
	if (bytes >= 1_000_000) {
		return `${(bytes / 1_000_000).toFixed(1)} MB`;
	}

	if (bytes >= 1_000) {
		return `${Math.round(bytes / 1_000)} KB`;
	}

	return `${bytes} B`;
}

/** `~15k`, from `chars / 4` over the stored body — the same estimate `map` prints. */
export function tokens(bytes: number): string {
	const estimate = Math.round(bytes / 4);

	return estimate >= 1000 ? `~${Math.round(estimate / 1000)}k` : `~${estimate}`;
}

/**
 * The shortest thing that still resolves back to this story: the name's slug when no other
 * story shares it, the id's first eight characters otherwise. Printing a ref nobody can type
 * back would make the column decoration.
 */
export function refFor(story: StoryMeta, all: StoryMeta[]): string {
	const wanted = slug(story.name);

	if (wanted !== '' && all.filter(other => slug(other.name) === wanted).length === 1) {
		return wanted;
	}

	return story.id.slice(0, 8);
}

export async function run(ctx: Ctx): Promise<number> {
	const includeDeleted = ctx.flags.deleted === true;
	const stories = await ctx.source.list(includeDeleted);
	const sort = typeof ctx.flags.sort === 'string' ? ctx.flags.sort : 'rev';

	switch (sort) {
		case 'name':
			stories.sort((a, b) => a.name.localeCompare(b.name));
			break;
		case 'bytes':
			stories.sort((a, b) => b.bytes + b.assetBytes - (a.bytes + a.assetBytes));
			break;
		case 'rev':
			// Newest write first, which is what `list` already hands back.
			break;
		default:
			throw new CliError(`--sort takes rev, name or bytes, not "${sort}"`, EXIT.usage);
	}

	if (ctx.json) {
		for (const story of stories) {
			process.stdout.write(
				`${JSON.stringify({...story, ref: refFor(story, stories)})}\n`
			);
		}

		return EXIT.ok;
	}

	if (stories.length === 0) {
		ctx.out('no stories');

		return EXIT.ok;
	}

	const rows = stories.map(story => ({
		assets: `${story.assetCount} assets`,
		name: story.name + (story.deleted ? '  (deleted)' : ''),
		passages: `${story.passageCount} passages`,
		ref: refFor(story, stories),
		rev: `rev ${story.rev}`,
		size: size(story.bytes + story.assetBytes),
		tokens: tokens(story.bytes)
	}));
	const width = (key: keyof (typeof rows)[0]) =>
		rows.reduce((max, row) => Math.max(max, row[key].length), 0);
	const widths = {
		assets: width('assets'),
		name: width('name'),
		passages: width('passages'),
		ref: width('ref'),
		rev: width('rev')
	};

	for (const row of rows) {
		ctx.out(
			[
				row.ref.padEnd(widths.ref),
				row.name.padEnd(widths.name),
				row.rev.padStart(widths.rev),
				row.passages.padStart(widths.passages),
				row.assets.padStart(widths.assets),
				row.size.padStart(8),
				row.tokens.padStart(6)
			].join('  ')
		);
	}

	return EXIT.ok;
}
