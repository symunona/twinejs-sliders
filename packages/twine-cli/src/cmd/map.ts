/**
 * `map` — the thing to read before deciding anything (spec 12 §2).
 *
 * Everything here is one screen of stdout, because its whole purpose is to be read in full by
 * something with a budget. The two numbers that steer what happens next are the token
 * estimate (under 50k, `cat --all` and read the lot; over, pick three passages) and
 * `scene @12`, which is the scene block's start line *inside that passage* — so the next step
 * is a `Read` with an offset rather than a second `cat`.
 */

import {buildSceneIndex, extractSceneBlock} from '@sliders/scene-index';
import {scanLinkTargets, scanWikiLinks} from '@sliders/scene-schema';
import {loadCatalog} from '../assets';
import {hasErrors, lintStory} from '../lint';
import {refFor, tokens} from './ls';
import {resolve} from '../ref';
import {CliError, EXIT} from '../types';
import type {Ctx, PassageObject} from '../types';

export const name = 'map';
export const summary = 'the story map: passages, scenes, assets, lint in one screen';

/** Where a scene block starts inside its passage, 1-indexed, for `Read` with an offset. */
function sceneLine(passage: PassageObject): number | undefined {
	const block = extractSceneBlock(passage.text);

	return block ? block.lineOffset + 1 : undefined;
}

/**
 * Everything this passage points at: `links:` targets from the scene block and the targets of
 * any `[[wiki link]]`. Unknown names are printed as written — deciding whether a target exists
 * is `lint`'s job, and a map that hid them would hide the typo.
 */
function linksOf(passage: PassageObject): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const add = (target: string) => {
		const trimmed = target.trim();

		if (trimmed !== '' && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	};

	for (const target of scanLinkTargets(passage.text).values()) {
		add(target);
	}

	for (const link of scanWikiLinks(passage.text)) {
		add(link.target ?? link.name);
	}

	return out;
}

function bytesLabel(bytes: number): string {
	return bytes >= 1_000_000
		? `${(bytes / 1_000_000).toFixed(1)} MB`
		: `${Math.round(bytes / 1_000)} KB`;
}

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const spec = args[0];

	if (!spec) {
		throw new CliError('map <story>', EXIT.usage);
	}

	const {body, meta, rev} = await resolve(ctx.source, spec);
	const passages = body.passages ?? [];
	const manifest = await ctx.source.manifest(meta.id).catch(() => undefined);
	const index = buildSceneIndex(passages.map(p => ({name: p.name, text: p.text})));
	const stories = await ctx.source.list(true);
	const ref = refFor(meta, stories);

	if (ctx.json) {
		// One JSONL record per passage: the map, minus the layout, for something that is
		// going to filter it anyway.
		for (const passage of passages) {
			process.stdout.write(
				`${JSON.stringify({
					chars: passage.text.length,
					id: passage.id,
					lines: passage.text.split('\n').length,
					links: linksOf(passage),
					name: passage.name,
					ref: `${ref}/${passage.name}`,
					scene: sceneLine(passage),
					tags: passage.tags ?? []
				})}\n`
			);
		}

		return EXIT.ok;
	}

	const chars = passages.reduce((sum, passage) => sum + passage.text.length, 0);
	const assetBytes = manifest
		? manifest.assets.reduce((sum, asset) => sum + (asset.bytes ?? 0), 0)
		: 0;

	ctx.out(
		[
			ref,
			meta.name,
			`rev ${rev}`,
			`${passages.length} passages`,
			`${manifest?.assets.length ?? 0} assets (${bytesLabel(assetBytes)})`,
			`${tokens(chars)} tokens`,
			ctx.source.mode
		].join('  ')
	);
	ctx.out('');
	ctx.out('PASSAGES');

	const refs = passages.map(passage => `${ref}/${passage.name}`);
	const refWidth = refs.reduce((max, entry) => Math.max(max, entry.length), 0);

	passages.forEach((passage, i) => {
		const line = sceneLine(passage);
		const links = linksOf(passage);

		ctx.out(
			`  ${refs[i].padEnd(refWidth)}  ${String(passage.text.split('\n').length).padStart(
				4
			)} lines  ${(line === undefined ? '—' : `scene @${line}`).padEnd(12)}  ${
				links.length === 0 ? '' : `links: ${links.join(', ')}`
			}`.trimEnd()
		);
	});

	if (index.scenes.size > 0) {
		ctx.out('');
		ctx.out('SCENES');

		for (const [id, entry] of index.scenes) {
			const cast = Object.entries(entry.scene.entities)
				.filter(([, patch]) => patch?.kind === 'cast')
				.map(([entityId]) => entityId);
			const marks = [...entry.marks.keys()].filter(mark => mark !== 'enter');

			ctx.out(
				[
					`  ${id}`,
					`in ${entry.passage}`,
					`from ${entry.scene.from ?? '—'}`,
					`cast ${cast.length === 0 ? '—' : cast.join(',')}`,
					`${entry.scene.beats.length} beats`,
					marks.length === 0 ? '' : `marks: ${marks.join(',')}`
				]
					.filter(part => part !== '')
					.join('   ')
			);
		}
	}

	if (manifest) {
		const kinds = new Map<string, number>();

		for (const asset of manifest.assets) {
			kinds.set(asset.kind, (kinds.get(asset.kind) ?? 0) + 1);
		}

		// "Unused" here is a text search for the id or the manifest name, not the real
		// per-scene walk `assets` does. It is enough to say "look closer", and it costs one
		// pass over passage text rather than a full resolution of every cast frame.
		const haystack = passages.map(passage => passage.text).join('\n');
		const unused = manifest.assets.filter(
			asset => !haystack.includes(asset.id) && !haystack.includes(asset.name)
		).length;

		ctx.out('');
		ctx.out(
			`ASSETS  ${manifest.assets.length}, ${bytesLabel(assetBytes)} — ${
				[...kinds].map(([kind, count]) => `${count} ${kind}`).join(', ') || 'none'
			}.  ${unused} unused, ${manifest.missing.length} missing`
		);
	}

	// The tally has to be the same lint `twine-cli lint` runs. Counting only the scene
	// index's own errors made the map say "clean" while lint exited 5 — and the map is the
	// first thing anyone reads.
	const catalog = await loadCatalog(ctx.source, meta.id).catch(() => undefined);
	const storyRef = refFor(meta, stories);
	const findings = lintStory({body, catalog, ref: storyRef});
	const errors = findings.filter(finding => finding.level === 'error').length;
	const warnings = findings.length - errors;

	ctx.out(
		`LINT    ${warnings} warnings, ${errors} errors` +
			(hasErrors(findings) ? `  — twine-cli lint ${storyRef}` : '')
	);

	return EXIT.ok;
}
