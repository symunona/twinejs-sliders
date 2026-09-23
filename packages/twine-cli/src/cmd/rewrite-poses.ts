/**
 * `rewrite-poses <story> [--dry-run]` — rename the retired scene keys in every passage:
 * `frame:` -> `pose:`, `frameLoop:` -> `poseLoop:`, and `frame` in an `ease:` map.
 *
 * Opt-in and never needed: the old keys parse forever. This exists so a story can be
 * brought onto one vocabulary in one go instead of one `info` fix at a time.
 *
 * The parser decides what to rename, not a regexp. Every retired key it reads comes back
 * as a `retired-key` finding with a one-token fix, so a `frame:` inside dialogue, a comment
 * or a passage name is never touched — the parser never read those as keys.
 */

import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {SceneFix} from '@sliders/scene-types';
import {resolve} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'rewrite-poses';
export const summary = 'rename frame:/frameLoop: to pose:/poseLoop: in every scene (opt-in)';

const USAGE = 'usage: twine-cli rewrite-poses <story> [--dry-run]';

/** 1-indexed line/col -> offset into `text`. */
function offsetOf(text: string, line: number, col: number): number {
	let offset = 0;

	for (let current = 1; current < line; current++) {
		const next = text.indexOf('\n', offset);

		if (next === -1) {
			return text.length;
		}

		offset = next + 1;
	}

	return offset + col - 1;
}

/**
 * One passage's text with every retired key renamed, and how many were.
 *
 * Fixes are applied last-first so an earlier splice never moves a later one, and each is
 * checked against `replaces` before it lands — the same guard the editor's Fix button uses.
 */
export function rewritePassagePoses(passageText: string): {
	text: string;
	count: number;
} {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return {count: 0, text: passageText};
	}

	const fixes = parseScene(block.text)
		.errors.filter(error => error.code === 'retired-key' && error.fix)
		.map(error => error.fix as SceneFix)
		.map(fix => ({
			fix,
			from: offsetOf(block.text, fix.line, fix.col),
			to: offsetOf(block.text, fix.endLine ?? fix.line, fix.endCol ?? fix.col)
		}))
		.sort((a, b) => b.from - a.from);

	let text = block.text;
	let count = 0;

	for (const {fix, from, to} of fixes) {
		if (text.slice(from, to) !== fix.replaces) {
			continue;
		}

		text = text.slice(0, from) + fix.text + text.slice(to);
		count++;
	}

	if (count === 0) {
		return {count: 0, text: passageText};
	}

	return {
		count,
		text:
			passageText.slice(0, block.offset) +
			text +
			passageText.slice(block.offset + block.text.length)
	};
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const target = args[0];

	if (target === undefined) {
		throw new CliError(USAGE, EXIT.usage);
	}

	const dryRun = ctx.flags['dry-run'] === true;
	const {body, meta} = await resolve(ctx.source, target);
	let total = 0;
	const touched: {name: string; count: number}[] = [];

	const passages = body.passages.map(passage => {
		const {count, text} = rewritePassagePoses(passage.text ?? '');

		if (count === 0) {
			return passage;
		}

		total += count;
		touched.push({count, name: passage.name});

		return {...passage, text};
	});

	if (ctx.json) {
		ctx.out(JSON.stringify({dryRun, passages: touched, renamed: total}));
	} else {
		for (const one of touched) {
			ctx.out(`${one.name}: ${one.count} key${one.count === 1 ? '' : 's'}`);
		}
	}

	if (total === 0) {
		if (!ctx.json && !ctx.quiet) {
			ctx.out('nothing to rename');
		}

		return EXIT.ok;
	}

	if (dryRun) {
		if (!ctx.json && !ctx.quiet) {
			ctx.out(`${total} key${total === 1 ? '' : 's'} would be renamed (dry run)`);
		}

		return EXIT.ok;
	}

	await ctx.write.putStory(meta.id, {...body, passages}, meta.rev);

	if (!ctx.json && !ctx.quiet) {
		ctx.out(`renamed ${total} key${total === 1 ? '' : 's'} in ${touched.length} passage${
			touched.length === 1 ? '' : 's'
		}`);
	}

	return EXIT.ok;
}
