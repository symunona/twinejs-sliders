/**
 * The story map: passages, scenes, assets and a lint tally in one screen (spec 12 §2).
 *
 * Two halves, and the split is the point. `buildStoryMap` is the FACTS — a plain object a
 * voice tool can hand a model as JSON. `renderStoryMap` is the columns, which is what the
 * CLI prints. They ship together so the terminal and the voice panel cannot start
 * describing the same story differently; the moment one of them grows its own walk of the
 * passages, the two answers drift and the author is the one who finds out.
 *
 * Everything here is synchronous and over `(story, manifest)`. Nothing reads a disk, so
 * the browser gets the same map the CLI does without a `Source` in the middle.
 */

import {buildSceneIndex, extractSceneBlock} from '@sliders/scene-index';
import {
	scanLinkTargets,
	scanWikiLinks,
	sceneEntityLinkTargets
} from '@sliders/scene-schema';
import type {AssetCatalog} from './assets';
import {hasErrors, lintStory} from './lint';
import type {LintFinding} from './lint';
import type {PassageLike, StoryLike} from './types';

export interface MapPassage {
	chars: number;
	id: string;
	lines: number;
	/** Everything this passage points at, as written. Typos included — see `linksOf`. */
	links: string[];
	name: string;
	ref: string;
	/** Where the scene block starts INSIDE the passage, 1-indexed. Undefined = no block. */
	scene?: number;
	tags: string[];
}

export interface MapScene {
	beats: number;
	cast: string[];
	from?: string;
	id: string;
	/** Marks other than the implicit `enter`. */
	marks: string[];
	passage: string;
}

export interface MapAssets {
	bytes: number;
	count: number;
	/** kind -> how many. */
	kinds: Record<string, number>;
	missing: number;
	/** Text-search estimate, not the per-scene walk. See the comment on `unusedCount`. */
	unused: number;
}

export interface StoryMap {
	assets?: MapAssets;
	chars: number;
	errors: number;
	/** Present only when the caller asked for the findings themselves. */
	findings?: LintFinding[];
	name: string;
	passages: MapPassage[];
	/** How the story is addressed — the ref the user typed, or the story's own id. */
	ref: string;
	rev?: number;
	scenes: MapScene[];
	/** Rough token estimate for the passage text, the number that decides `cat --all`. */
	tokens: number;
	warnings: number;
}

export interface BuildStoryMapInput {
	catalog?: AssetCatalog;
	/** Included in the result when true. The tally is computed either way. */
	keepFindings?: boolean;
	/** Where the story is: `local`, `remote`, or whatever the caller calls its source. */
	ref: string;
	rev?: number;
	story: StoryLike;
}

/** Where a scene block starts inside its passage, 1-indexed, for a `Read` with an offset. */
function sceneLine(passage: PassageLike): number | undefined {
	const block = extractSceneBlock(passage.text ?? '');

	return block ? block.lineOffset + 1 : undefined;
}

/**
 * Everything this passage points at: `links:` targets from the scene block and the targets
 * of any `[[wiki link]]`. Unknown names come back as written — deciding whether a target
 * exists is `lint`'s job, and a map that hid them would hide the typo.
 */
export function linksOf(passage: PassageLike): string[] {
	const out: string[] = [];
	const seen = new Set<string>();
	const text = passage.text ?? '';
	const add = (target: string) => {
		const trimmed = target.trim();

		if (trimmed !== '' && !seen.has(trimmed)) {
			seen.add(trimmed);
			out.push(trimmed);
		}
	};

	for (const target of scanLinkTargets(text).values()) {
		add(target);
	}

	for (const target of sceneEntityLinkTargets(text)) {
		add(target);
	}

	for (const link of scanWikiLinks(text)) {
		add(link.target ?? link.name);
	}

	return out;
}

/** Four characters to the token, the estimate every budget in this project is written to. */
export function tokenEstimate(chars: number): number {
	return Math.round(chars / 4);
}

export function bytesLabel(bytes: number): string {
	return bytes >= 1_000_000
		? `${(bytes / 1_000_000).toFixed(1)} MB`
		: `${Math.round(bytes / 1_000)} KB`;
}

/**
 * "Unused" here is a text search for the id or the manifest name, not the real per-scene
 * walk `resolveSceneAssets` does. It is enough to say "look closer", and it costs one pass
 * over passage text rather than a full resolution of every cast frame in the story.
 */
function unusedCount(story: StoryLike, catalog: AssetCatalog): number {
	const haystack = story.passages.map(passage => passage.text ?? '').join('\n');

	return catalog.manifest.assets.filter(
		asset => !haystack.includes(asset.id) && !haystack.includes(asset.name)
	).length;
}

export function buildStoryMap(input: BuildStoryMapInput): StoryMap {
	const {catalog, keepFindings, ref, rev, story} = input;
	const passages = story.passages ?? [];
	const index = buildSceneIndex(
		passages.map(passage => ({name: passage.name, text: passage.text ?? ''}))
	);
	const chars = passages.reduce(
		(sum, passage) => sum + (passage.text ?? '').length,
		0
	);

	// The tally has to be the lint `twine-cli lint` runs. Counting only the scene index's
	// own errors once made the map say "clean" while lint exited 5 — and the map is the
	// first thing anyone reads.
	const findings = lintStory({body: story, catalog, ref});
	const errors = findings.filter(finding => finding.level === 'error').length;

	const mapped: MapPassage[] = passages.map(passage => {
		const text = passage.text ?? '';

		return {
			chars: text.length,
			id: passage.id,
			lines: text.split('\n').length,
			links: linksOf(passage),
			name: passage.name,
			ref: `${ref}/${passage.name}`,
			scene: sceneLine(passage),
			tags: passage.tags ?? []
		};
	});

	const scenes: MapScene[] = [];

	for (const [id, entry] of index.scenes) {
		scenes.push({
			beats: entry.scene.beats.length,
			cast: Object.entries(entry.scene.entities)
				.filter(([, patch]) => patch?.kind === 'cast')
				.map(([entityId]) => entityId),
			from: entry.scene.from,
			id,
			marks: [...entry.marks.keys()].filter(mark => mark !== 'enter'),
			passage: entry.passage
		});
	}

	let assets: MapAssets | undefined;

	if (catalog) {
		const kinds: Record<string, number> = {};

		for (const asset of catalog.manifest.assets) {
			kinds[asset.kind] = (kinds[asset.kind] ?? 0) + 1;
		}

		assets = {
			bytes: catalog.manifest.assets.reduce(
				(sum, asset) => sum + (asset.bytes ?? 0),
				0
			),
			count: catalog.manifest.assets.length,
			kinds,
			missing: catalog.manifest.missing?.length ?? 0,
			unused: unusedCount(story, catalog)
		};
	}

	return {
		assets,
		chars,
		errors,
		findings: keepFindings ? findings : undefined,
		name: story.name,
		passages: mapped,
		ref,
		rev,
		scenes,
		tokens: tokenEstimate(chars),
		warnings: findings.length - errors
	};
}

export interface RenderStoryMapOptions {
	/** Appended to the header line — `local`, `remote`, `browser`. */
	mode?: string;
}

/** The map as one screen of text. The CLI prints this; the voice panel sends it. */
export function renderStoryMap(
	map: StoryMap,
	options: RenderStoryMapOptions = {}
): string[] {
	const out: string[] = [];
	const tokens =
		map.tokens >= 1000 ? `~${Math.round(map.tokens / 1000)}k` : `~${map.tokens}`;

	out.push(
		[
			map.ref,
			map.name,
			map.rev === undefined ? '' : `rev ${map.rev}`,
			`${map.passages.length} passages`,
			map.assets
				? `${map.assets.count} assets (${bytesLabel(map.assets.bytes)})`
				: '',
			`${tokens} tokens`,
			options.mode ?? ''
		]
			.filter(part => part !== '')
			.join('  ')
	);
	out.push('');
	out.push('PASSAGES');

	const refWidth = map.passages.reduce(
		(max, passage) => Math.max(max, passage.ref.length),
		0
	);

	for (const passage of map.passages) {
		out.push(
			`  ${passage.ref.padEnd(refWidth)}  ${String(passage.lines).padStart(
				4
			)} lines  ${(passage.scene === undefined
				? '—'
				: `scene @${passage.scene}`
			).padEnd(12)}  ${
				passage.links.length === 0 ? '' : `links: ${passage.links.join(', ')}`
			}`.trimEnd()
		);
	}

	if (map.scenes.length > 0) {
		out.push('');
		out.push('SCENES');

		for (const scene of map.scenes) {
			out.push(
				[
					`  ${scene.id}`,
					`in ${scene.passage}`,
					`from ${scene.from ?? '—'}`,
					`cast ${scene.cast.length === 0 ? '—' : scene.cast.join(',')}`,
					`${scene.beats} beats`,
					scene.marks.length === 0 ? '' : `marks: ${scene.marks.join(',')}`
				]
					.filter(part => part !== '')
					.join('   ')
			);
		}
	}

	if (map.assets) {
		const kinds = Object.entries(map.assets.kinds)
			.map(([kind, count]) => `${count} ${kind}`)
			.join(', ');

		out.push('');
		out.push(
			`ASSETS  ${map.assets.count}, ${bytesLabel(map.assets.bytes)} — ${
				kinds || 'none'
			}.  ${map.assets.unused} unused, ${map.assets.missing} missing`
		);
	}

	out.push(
		`LINT    ${map.warnings} warnings, ${map.errors} errors` +
			(map.errors > 0 ? `  — twine-cli lint ${map.ref}` : '')
	);

	return out;
}

/** Re-exported so a caller that has the findings does not import two modules for one tally. */
export {hasErrors};
