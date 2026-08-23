/**
 * `restore` — put an old version of a story back (spec 12 §1, command 15).
 *
 * Restore is an ordinary write on the server: it bumps the rev, snapshots the body it
 * replaced and broadcasts, so open editors pull it like any other change and the version
 * restored over is itself one command from coming back. Nothing is destroyed, which is why
 * this command asks for no confirmation.
 *
 * The one thing that can be lost is art. Blobs orphaned longer than `ORPHAN_TTL` are swept,
 * so a body older than that can land on pictures the store no longer holds — the server
 * answers `missingAssets` for exactly that, and it is the part of the output worth reading.
 */

import {parseRef, resolveStory} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'restore';
export const summary = 'Restore an old revision as a new one on top';

const USAGE = 'usage: twine-cli restore <story> --rev N   (or: twine-cli restore <story>@N)';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const input = args[0];

	if (!input) {
		throw new CliError(USAGE, EXIT.usage);
	}

	const ref = parseRef(input);
	const meta = await resolveStory(ctx.source, ref);
	const storyId = meta.id;
	// `restore ep3@37` and `restore ep3 --rev 37` are the same sentence; both spellings
	// turn up in scripts, and refusing one is a footgun for no gain.
	const rev = revOf(ctx, 'rev' in ref ? ref.rev : undefined);
	const result = await ctx.write.restore(storyId, rev);

	if (ctx.json) {
		ctx.out(JSON.stringify({id: storyId, name: meta.name, ...result}));
		return EXIT.ok;
	}

	ctx.out(
		`${meta.name}  ${storyId}  rev ${result.rev}  restored from rev ${result.restoredFrom}`
	);
	ctx.out(
		`  rev ${meta.rev} is now in the history — restore it to undo this`
	);

	if (result.missingAssets.length > 0) {
		ctx.out(
			`  ! ${result.missingAssets.length} assets from that version are no longer in the store:`
		);

		for (const id of result.missingAssets) {
			ctx.out(`      ${id}`);
		}
	}

	return EXIT.ok;
}

function revOf(ctx: Ctx, fromRef: number | undefined): number {
	const flag = ctx.flags.rev;
	const raw = typeof flag === 'string' ? Number.parseInt(flag, 10) : fromRef;

	if (raw === undefined || !Number.isInteger(raw) || raw < 1) {
		throw new CliError(`restore needs the revision to restore.\n${USAGE}`, EXIT.usage);
	}

	return raw;
}
