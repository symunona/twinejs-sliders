/**
 * `revs` — the version history of one story (spec 12 §1, command 14).
 *
 * Newest first, one line per version, current version at the top marked `now`. The current
 * body is not a snapshot — it is `story.json` — but a history that hides it is a history
 * where the version people are looking at is missing, which reads as data loss (spec 11).
 * The server already leads with it; the row is synthesised here only when whatever answered
 * did not, so local mode reading `revs/index.json` off disk lists the same thing.
 */

import {resolveStory} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx, RevisionRow, StoryMeta} from '../types';

export const name = 'revs';
export const summary = 'List the versions of a story, newest first';

const USAGE = 'usage: twine-cli revs <story> [--json]';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const input = args[0];

	if (!input) {
		throw new CliError(USAGE, EXIT.usage);
	}

	const meta = await resolveStory(ctx.source, input);
	const storyId = meta.id;
	const rows = withCurrent(await ctx.source.revisions(storyId), meta);

	if (ctx.json) {
		// JSONL: one record per line, so `head`, `grep` and a streaming reader all work
		// without anyone parsing an array.
		for (const row of rows) {
			ctx.out(JSON.stringify({...row, current: row.rev === meta.rev}));
		}

		return EXIT.ok;
	}

	if (rows.length === 0) {
		ctx.out(`${meta.name}  ${storyId}  no versions`);
		return EXIT.ok;
	}

	ctx.out(`${meta.name}  ${storyId}  ${rows.length} versions`);

	for (const row of rows) {
		ctx.out(
			[
				`  ${String(row.rev).padStart(5)}`,
				when(row.at),
				(row.client || '—').padEnd(16),
				formatBytes(row.bytes).padStart(9),
				`${row.passages} passages`,
				row.rev === meta.rev ? 'now' : '',
				row.restoredFrom ? `restored from ${row.restoredFrom}` : ''
			]
				.filter(part => part !== '')
				.join('  ')
		);
	}

	return EXIT.ok;
}

/**
 * The list with the story's current version at the front, unless it is already there.
 *
 * Deliberately tolerant: `GET /revisions` includes the current row, a reader of
 * `revs/index.json` does not, and `revs` should print the same table either way.
 */
function withCurrent(rows: RevisionRow[], meta: StoryMeta): RevisionRow[] {
	const sorted = [...rows].sort((a, b) => b.rev - a.rev);

	if (meta.deleted || sorted.some(row => row.rev === meta.rev)) {
		return sorted;
	}

	return [
		{
			rev: meta.rev,
			at: meta.updatedAt,
			client: meta.lastClient,
			bytes: meta.bytes,
			hash: '',
			passages: meta.passageCount
		},
		...sorted
	];
}

/** ISO timestamps are for machines; this list is read by a person scanning for "when". */
function when(at: string): string {
	const parsed = new Date(at);

	if (Number.isNaN(parsed.getTime())) {
		return (at || '—').padEnd(16);
	}

	return parsed.toISOString().replace('T', ' ').slice(0, 16);
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
