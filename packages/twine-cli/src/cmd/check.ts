/**
 * `check` — the three-way test with no write (spec 12 §3).
 *
 * Same comparison `put` makes, so the answer is the answer: `fresh` and `stale-elsewhere`
 * both mean the put will land, `conflict` means it will not. Worth running before a long edit
 * as much as before the put itself.
 */

import {readFile, readdir, stat} from 'node:fs/promises';
import {join} from 'node:path';
import {parse, threeWay} from '../passage';
import {resolveStory} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'check';
export const summary = 'is my copy still current? read-only';

async function checkFile(ctx: Ctx, file: string, showName: boolean): Promise<number> {
	const {receipt} = parse(await readFile(file, 'utf8'));
	const meta = await resolveStory(ctx.source, {kind: 'story', story: receipt.story});
	const body = await ctx.source.body(meta.id);
	const state = threeWay(body, receipt, meta.rev);
	let detail: string;

	switch (state) {
		case 'fresh':
			detail = `rev ${meta.rev}, passage unchanged`;
			break;
		case 'stale-elsewhere':
			detail = `rev ${meta.rev}, other passages moved — your put still safe`;
			break;
		default:
			detail = `rev ${meta.rev}, ${receipt.passage} changed by ${meta.lastClient} at ${meta.updatedAt}`;
	}

	if (ctx.json) {
		process.stdout.write(
			`${JSON.stringify({
				file,
				hash: receipt.hash,
				passage: receipt.passage,
				rev: meta.rev,
				state,
				stampedRev: receipt.rev,
				story: meta.id
			})}\n`
		);
	} else {
		ctx.out(`${state.padEnd(16)} ${detail}${showName ? `  (${file})` : ''}`);
	}

	return state === 'conflict' ? EXIT.conflict : EXIT.ok;
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const target = args[0];

	if (!target) {
		throw new CliError('check <file|dir>', EXIT.usage);
	}

	const info = await stat(target).catch(() => undefined);

	if (!info) {
		throw new CliError(`no such file: ${target}`, EXIT.notFound);
	}

	if (!info.isDirectory()) {
		return checkFile(ctx, target, false);
	}

	const entries = await readdir(target, {withFileTypes: true});
	let worst: number = EXIT.ok;

	for (const entry of entries) {
		if (!entry.isFile()) {
			continue;
		}

		const path = join(target, entry.name);

		try {
			worst = Math.max(worst, await checkFile(ctx, path, true));
		} catch (error) {
			if (error instanceof CliError && error.message.startsWith('not a `cat` receipt')) {
				continue;
			}

			throw error;
		}
	}

	return worst;
}
