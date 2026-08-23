/**
 * `rm` — tombstone a story, or erase it (spec 12 §1, command 13).
 *
 * `--yes` is required and there is no prompt. An agent runs this command, and a prompt in
 * front of a non-interactive caller is either ignored or hangs; a flag it has to type is
 * the same guard without either failure mode.
 *
 * The default is a tombstone, which is recoverable: the body and the asset bytes go, but
 * `meta.json` and `revs/` stay, so every editor learns the story was deleted and a
 * republish (`PUT ?revive=1`) continues the same rev chain. `--purge` removes the
 * directory, history included, and is the one thing here that cannot be undone.
 */

import {resolveStory} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'rm';
export const summary = 'Delete a story: tombstone by default, --purge to erase it';

const USAGE = 'usage: twine-cli rm <story> [--purge] --yes';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const input = args[0];

	if (!input) {
		throw new CliError(USAGE, EXIT.usage);
	}

	const purge = truthy(ctx.flags.purge);

	if (!truthy(ctx.flags.yes) && !truthy(ctx.flags.y)) {
		throw new CliError(
			purge
				? `rm --purge erases the story and its whole history. Add --yes to mean it.\n${USAGE}`
				: `rm needs --yes.\n${USAGE}`,
			EXIT.usage
		);
	}

	// Resolving reads the metadata, which has to happen first anyway: after the delete
	// there is no name left to report, and a story that is not there should say so before
	// anything is written.
	const meta = await resolveStory(ctx.source, input);
	const storyId = meta.id;

	if (meta.deleted && !purge) {
		ctx.out(`${meta.name}  ${storyId}  already a tombstone, nothing to do`);
		return EXIT.ok;
	}

	await ctx.write.deleteStory(storyId, purge);

	if (ctx.json) {
		ctx.out(
			JSON.stringify({
				id: storyId,
				name: meta.name,
				rev: meta.rev,
				deleted: true,
				purged: purge
			})
		);
	} else if (purge) {
		ctx.out(`${meta.name}  ${storyId}  purged — body, assets and history are gone`);
	} else {
		ctx.out(
			`${meta.name}  ${storyId}  deleted at rev ${meta.rev} — history kept, republish to bring it back`
		);
	}

	return EXIT.ok;
}

function truthy(value: string | boolean | undefined): boolean {
	return value === true || value === 'true' || value === '';
}
