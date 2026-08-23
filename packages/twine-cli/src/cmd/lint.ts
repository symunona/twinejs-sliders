/**
 * `lint [<story>|<file>] [--after <file>] [--fix]` — spec 12 §5.
 *
 * Three modes, one library. `lint tmp/p.md` runs tier 1 on a file in hand and never opens a
 * socket, which is what makes it usable as the step before every `put`. `lint ep3` runs all
 * four against the store. `lint ep3 --after tmp/p.md` runs all four over the body with that
 * file already spliced in — the honest pre-flight, because a passage that lints clean on its
 * own can still break a `from:` chain or an asset reference once it lands.
 */

import {existsSync, readFileSync, statSync, writeFileSync} from 'node:fs';
import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit, setEntityKey} from '@sliders/scene-edit';
import {parseScene} from '@sliders/scene-schema';
import {loadCatalog, unusedAssets} from '../assets';
import type {AssetCatalog} from '../assets';
import {formatFinding, hasErrors, lintPassageText, lintStory} from '../lint';
import type {LintFinding} from '../lint';
import {resolve} from '../ref';
import {EXIT} from '../types';
import type {Ctx, StoryBody} from '../types';

export const name = 'lint';
export const summary = 'scene YAML, cross-passage, links and assets';

interface CatFile {
	/** Passage text with the receipt removed. */
	text: string;
	/** The receipt itself, kept verbatim so `--fix` can write the file back around it. */
	header: string;
	/** File line the passage text starts on, so markers point at the file, not the passage. */
	lineBase: number;
	front: Record<string, string>;
}

/**
 * Split a `cat` artifact into receipt and text.
 *
 * `passage.ts` owns stamping and splicing; lint only ever needs to look past the front
 * matter, and a read-only split is not worth a dependency on a module being written in
 * parallel.
 */
function splitReceipt(raw: string): CatFile {
	const lines = raw.split('\n');

	if (lines[0]?.trim() !== '---') {
		return {front: {}, header: '', lineBase: 1, text: raw};
	}

	const end = lines.findIndex((line, i) => i > 0 && line.trim() === '---');

	if (end === -1) {
		return {front: {}, header: '', lineBase: 1, text: raw};
	}

	const front: Record<string, string> = {};

	for (const line of lines.slice(1, end)) {
		const colon = line.indexOf(':');

		if (colon > 0) {
			front[line.slice(0, colon).trim()] = line.slice(colon + 1).trim();
		}
	}

	return {
		front,
		header: `${lines.slice(0, end + 1).join('\n')}\n`,
		lineBase: end + 2,
		text: lines.slice(end + 1).join('\n')
	};
}

/**
 * Rewrite every `at:` through `scene-edit`, which is the only mechanical fix on a passage
 * the spec allows — pointer math writes `-0.40000000000000002`, and the normalised form is
 * the same number.
 *
 * One edit at a time, re-parsing between: each splice moves every offset after it, so a
 * batch computed up front would land in the wrong places.
 */
function normaliseAt(passageText: string): string {
	const block = extractSceneBlock(passageText);

	if (!block) {
		return passageText;
	}

	let blockText = block.text;
	const scene = parseScene(blockText).scene;

	for (const [id, patch] of Object.entries(scene.entities)) {
		if (patch === null || patch.at === undefined) {
			continue;
		}

		const edit = setEntityKey(blockText, {id, kind: patch.kind}, 'at', patch.at);

		if (edit) {
			blockText = applyEdit(blockText, edit);
		}
	}

	if (blockText === block.text) {
		return passageText;
	}

	return (
		passageText.slice(0, block.offset) +
		blockText +
		passageText.slice(block.offset + block.text.length)
	);
}

/** Splice a `cat` artifact into a body without touching anything else in it. */
function spliceAfter(body: StoryBody, file: CatFile, path: string): StoryBody {
	const target = file.front.name ?? file.front.passage;

	if (target === undefined) {
		throw new Error(`${path}: no 'passage:' in the front matter — is this a cat file?`);
	}

	const passages = body.passages.map(passage =>
		passage.name === target ? {...passage, text: file.text} : passage
	);

	if (!passages.some(passage => passage.name === target)) {
		passages.push({
			id: `after-${target}`,
			left: 0,
			name: target,
			tags: [],
			text: file.text,
			top: 0
		});
	}

	return {...body, passages};
}

function report(ctx: Ctx, findings: LintFinding[]): number {
	if (ctx.json) {
		for (const finding of findings) {
			ctx.out(JSON.stringify(finding));
		}
	} else {
		for (const finding of findings) {
			ctx.out(formatFinding(finding));
		}

		if (!ctx.quiet) {
			const errors = findings.filter(finding => finding.level === 'error').length;

			ctx.out(`${errors} error${errors === 1 ? '' : 's'}, ${findings.length - errors} warning${
				findings.length - errors === 1 ? '' : 's'
			}`);
		}
	}

	return hasErrors(findings) ? EXIT.lint : EXIT.ok;
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const positional = args.filter(arg => !arg.startsWith('-'));
	const target = positional[0];
	const after = typeof ctx.flags.after === 'string' ? ctx.flags.after : undefined;
	const fix = ctx.flags.fix === true;

	if (target === undefined) {
		ctx.out('usage: twine-cli lint <story>|<file> [--after <file>] [--fix]');

		return EXIT.usage;
	}

	// --- file mode: tier 1 only, no server -----------------------------------
	if (
		after === undefined &&
		existsSync(target) &&
		statSync(target).isFile()
	) {
		const file = splitReceipt(readFileSync(target, 'utf8'));

		if (fix) {
			const fixed = normaliseAt(file.text);

			if (fixed !== file.text) {
				writeFileSync(target, file.header + fixed, 'utf8');
				file.text = fixed;

				if (!ctx.quiet) {
					ctx.out(`${target}: normalised at: values`);
				}
			}
		}

		return report(ctx, lintPassageText(file.text, target, {lineBase: file.lineBase}));
	}

	// --- store mode ----------------------------------------------------------
	const resolved = await resolve(ctx.source, target);
	const storyId = resolved.meta.id;
	let body = resolved.body;

	if (after !== undefined) {
		if (!existsSync(after)) {
			ctx.out(`${after}: no such file`);

			return EXIT.notFound;
		}

		body = spliceAfter(body, splitReceipt(readFileSync(after, 'utf8')), after);
	}

	// A story with no manifest yet is not a lint error; it just has no tier 4.
	let catalog: AssetCatalog | undefined;

	try {
		catalog = await loadCatalog(ctx.source, storyId);
	} catch {
		catalog = undefined;
	}

	if (fix) {
		if (after !== undefined) {
			ctx.out('--fix and --after are mutually exclusive: nothing to write yet.');

			return EXIT.usage;
		}

		await applyFixes(ctx, storyId, body, catalog);
		body = await ctx.source.body(storyId);

		try {
			catalog = await loadCatalog(ctx.source, storyId);
		} catch {
			catalog = undefined;
		}
	}

	return report(ctx, lintStory({body, catalog, ref: target}));
}

/**
 * The two mechanical fixes spec 12 §5 allows: prune manifest entries nothing references,
 * and normalise `at:`. Broken links wait for a human, on purpose — every automatic repair
 * for one is a guess about which passage the author meant.
 */
async function applyFixes(
	ctx: Ctx,
	storyId: string,
	body: StoryBody,
	catalog: AssetCatalog | undefined
): Promise<void> {
	const scenes = body.passages
		.map(passage => extractSceneBlock(passage.text ?? ''))
		.filter((block): block is NonNullable<typeof block> => block !== undefined)
		.map(block => parseScene(block.text).scene);

	if (catalog) {
		const unused = unusedAssets(scenes, catalog);

		if (unused.length > 0) {
			const drop = new Set(unused.map(row => row.id));
			const manifest = {
				...catalog.manifest,
				assets: catalog.manifest.assets.filter(asset => !drop.has(asset.id))
			};

			await ctx.write.putManifest(storyId, manifest, catalog.manifest.rev);

			if (!ctx.quiet) {
				ctx.out(`pruned ${drop.size} unreferenced manifest entr${drop.size === 1 ? 'y' : 'ies'}`);
			}
		}
	}

	const passages = body.passages.map(passage => ({
		...passage,
		text: normaliseAt(passage.text ?? '')
	}));

	if (passages.some((passage, i) => passage.text !== body.passages[i].text)) {
		const meta = await ctx.source.meta(storyId);

		await ctx.write.putStory(storyId, {...body, passages}, meta.rev);

		if (!ctx.quiet) {
			ctx.out('normalised at: values');
		}
	}
}
