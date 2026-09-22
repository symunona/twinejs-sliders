/**
 * `map` — the thing to read before deciding anything (spec 12 §2).
 *
 * Everything here is one screen of stdout, because its whole purpose is to be read in full by
 * something with a budget. The two numbers that steer what happens next are the token
 * estimate (under 50k, `cat --all` and read the lot; over, pick three passages) and
 * `scene @12`, which is the scene block's start line *inside that passage* — so the next step
 * is a `Read` with an offset rather than a second `cat`.
 *
 * The walk itself is `@sliders/story-map`, shared with the editor's voice panel. This file
 * is the I/O around it: resolve a ref, fetch a body and a manifest, pick the mode label.
 */

import {buildStoryMap, renderStoryMap} from '@sliders/story-map';
import {loadCatalog} from '../assets';
import {refFor} from './ls';
import {resolve} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'map';
export const summary = 'the story map: passages, scenes, assets, lint in one screen';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const spec = args[0];

	if (!spec) {
		throw new CliError('map <story>', EXIT.usage);
	}

	const {body, meta, rev} = await resolve(ctx.source, spec);
	const stories = await ctx.source.list(true);
	const ref = refFor(meta, stories);
	const catalog = await loadCatalog(ctx.source, meta.id).catch(() => undefined);
	const map = buildStoryMap({catalog, ref, rev, story: body});

	if (ctx.json) {
		// One JSONL record per passage: the map, minus the layout, for something that is
		// going to filter it anyway.
		for (const passage of map.passages) {
			process.stdout.write(`${JSON.stringify(passage)}\n`);
		}

		return EXIT.ok;
	}

	for (const line of renderStoryMap(map, {mode: ctx.source.mode})) {
		ctx.out(line);
	}

	return EXIT.ok;
}
