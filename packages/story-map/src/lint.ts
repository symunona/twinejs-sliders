/**
 * `lint` — the four tiers of spec 12 §5, as a library.
 *
 * Every tier already exists in a package; this file is the thing that knows how to point at
 * them all at once and where each complaint belongs. That is the whole job:
 *
 *   1 YAML          `@sliders/scene-schema`  parse errors, unknown keys, bad coordinates,
 *                                            and vars values the player cannot compile
 *   2 cross-passage `@sliders/scene-index`   duplicate ids, unknown `from:`/`@mark`, cycles
 *   3 story graph   `scanLinkTargets` +      dead links, unreachable passages, and the
 *                   `sceneEntityLinkTargets`
 *                                            spec-02 trap below
 *   4 assets        manifest + blobs         unknown refs, missing blobs, orphaned blobs
 *
 * The trap is worth naming out loud, because it is the one error that looks like working
 * code: a passage holding a `[scene]` block renders the scene ONLY (spec 02, D16), so a
 * `[[link]]` written under the block is dropped before render. Twine's own map draws that
 * arrow, the story map looks connected, and the player is standing in a room with no doors.
 *
 * Line numbers are always relative to the artifact being reported. For a `cat`-produced
 * file that is the real line in the file, front matter included; for a story it is the line
 * inside the passage, which is what `Read` on the `cat` output will agree with.
 */

import {buildSceneIndex, extractSceneBlock, splitSceneRef} from '@sliders/scene-index';
import type {SceneBlock} from '@sliders/scene-index';
import {
	parseScene,
	scanLinkTargets,
	scanWikiLinks,
	sceneEntityLinkTargets,
	varsValueErrors
} from '@sliders/scene-schema';
import {matchPassageName} from '@sliders/scene-types';
import type {Scene, SceneError} from '@sliders/scene-types';
import {resolveSceneAssets, unusedAssets} from './assets';
import type {AssetCatalog} from './assets';
import type {PassageLike, StoryLike} from './types';

export interface LintFinding {
	/** `tmp/p.md` for a file, `ep3/Tavern Night` for a passage, `ep3/assets.json` for the manifest. */
	file: string;
	/** 1-indexed. 0 means "this is about the whole file", and the formatter drops it. */
	line: number;
	/** `info` is advice (an old spelling that still works). It never fails a lint. */
	level: 'error' | 'warn' | 'info';
	message: string;
}

/** `file:line: message`, the shape every compiler and editor already knows how to parse. */
export function formatFinding(finding: LintFinding): string {
	const where = finding.line > 0 ? `${finding.file}:${finding.line}` : finding.file;

	const word =
		finding.level === 'error'
			? 'error'
			: finding.level === 'info'
			? 'info'
			: 'warning';

	return `${where}: ${word}: ${finding.message}`;
}

export function hasErrors(findings: readonly LintFinding[]): boolean {
	return findings.some(finding => finding.level === 'error');
}

function levelOf(error: SceneError): LintFinding['level'] {
	return error.severity === 'error'
		? 'error'
		: error.severity === 'info'
		? 'info'
		: 'warn';
}

/** A scene error's `message` plus its `hint`, which is where `keyHint()` lands. */
function textOf(error: SceneError): string {
	return error.hint ? `${error.message} ${error.hint}` : error.message;
}

function lineAt(text: string, offset: number): number {
	let line = 1;

	for (let i = 0; i < offset && i < text.length; i++) {
		if (text[i] === '\n') {
			line++;
		}
	}

	return line;
}

/**
 * 1-indexed line of `key:` inside a block, for the errors computed away from the text.
 *
 * Same trick as `keyPosition` in scene-index and for the same reason: asset resolution and
 * the index both work on parsed structures, where the YAML node positions are long gone.
 */
function findKeyLine(blockText: string, key: string): number {
	const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
	const re = new RegExp(`^[ \\t]*${escaped}[ \\t]*:`);
	const lines = blockText.split('\n');

	for (let i = 0; i < lines.length; i++) {
		if (re.test(lines[i])) {
			return i + 1;
		}
	}

	return 1;
}

// ---------------------------------------------------------------------------
// Tier 1 — YAML, one passage at a time
// ---------------------------------------------------------------------------

export interface PassageLintOptions {
	/**
	 * File line the passage text starts on. A `cat` artifact carries front matter, so its
	 * passage text does not start at line 1 and every marker would be off by the size of
	 * the receipt.
	 */
	lineBase?: number;
}

/**
 * Tier 1 alone: enough to run on a file in hand, before `put`, with no server anywhere.
 *
 * Unknown-key hints come from the parser, which already runs `keyHint()` over
 * `TOP_LEVEL_KEYS`/`ENTITY_KEYS`. Re-deriving the suggestion here would be a second,
 * quietly different answer to the same question.
 */
export function lintPassageText(
	text: string,
	file: string,
	options: PassageLintOptions = {}
): LintFinding[] {
	const base = (options.lineBase ?? 1) - 1;

	// Before the block check, and NOT offset by it: a vars section opens the passage, and a
	// passage with no scene at all can still hold a value the player cannot compile — which
	// is a broken passage either way. The rule and its wording come from the package, so
	// this cannot disagree with the editor's squiggle.
	const findings: LintFinding[] = varsValueErrors(text).map(error => ({
		file,
		level: levelOf(error),
		line: error.line + base,
		message: textOf(error)
	}));
	const block = extractSceneBlock(text);

	if (!block) {
		return findings;
	}

	const result = parseScene(block.text);

	return [
		...findings,
		...result.errors.map(error => ({
			file,
			level: levelOf(error),
			line: error.line + block.lineOffset + base,
			message: textOf(error)
		}))
	];
}

// ---------------------------------------------------------------------------
// Tier 2 — cross-passage, attributed back to a passage
// ---------------------------------------------------------------------------

/** The codes only the index can find. Everything else it reports is tier 1 seen twice. */
const CROSS_PASSAGE_CODES = new Set(['dupe-scene-id', 'unknown-from', 'from-cycle']);

interface ScenePassage {
	passage: PassageLike;
	block: SceneBlock;
	scene: Scene;
}

/**
 * Which passage a cross-passage error belongs to.
 *
 * `SceneError` has no passage field — it was designed for a single-passage editor, where
 * there is only ever one answer — so the id the message names is the only handle there is.
 * Matching on it is confined to this one function rather than spread through the reporter,
 * and a message that does not match still gets reported, just against the story.
 */
function attribute(
	error: SceneError,
	scenes: ScenePassage[],
	consumed: Map<string, number>
): ScenePassage | undefined {
	function nth(bucket: string, candidates: ScenePassage[]): ScenePassage | undefined {
		const index = consumed.get(bucket) ?? 0;

		consumed.set(bucket, index + 1);

		return candidates[index];
	}

	if (error.code === 'dupe-scene-id') {
		const id = /Duplicate scene id '(.+?)'/.exec(error.message)?.[1];

		if (id === undefined) {
			return undefined;
		}

		// The index keeps the first occurrence and complains about every one after it, in
		// passage order — so the offenders are exactly the tail of this list.
		const holders = scenes.filter(entry => entry.scene.id === id).slice(1);

		return nth(`dupe:${id}`, holders);
	}

	if (error.code === 'from-cycle') {
		const id = /^Scene '(.+?)' is part of a from: cycle/.exec(error.message)?.[1];

		return id === undefined
			? undefined
			: scenes.find(entry => entry.scene.id === id);
	}

	if (error.code === 'unknown-from') {
		const unknown = /in from: '(.+?)'/.exec(error.message)?.[1];

		if (unknown !== undefined) {
			return nth(
				`from:${unknown}`,
				scenes.filter(entry => entry.scene.from === unknown)
			);
		}

		const mark = /^Scene '(.+?)' has no mark '(.*?)'/.exec(error.message);

		if (mark) {
			const wanted = `${mark[1]}@${mark[2]}`;

			return nth(
				`from:${wanted}`,
				scenes.filter(entry => {
					if (entry.scene.from === undefined) {
						return false;
					}

					const ref = splitSceneRef(entry.scene.from);

					return ref.id === mark[1] && (ref.mark ?? '') === mark[2];
				})
			);
		}
	}

	return undefined;
}

// ---------------------------------------------------------------------------
// Tier 3 — the story graph
// ---------------------------------------------------------------------------

export interface PassageExit {
	target: string;
	/** 1-indexed line within the passage text. */
	line: number;
	/**
	 * Will the player actually be offered this? False for a `[[link]]` written outside a
	 * `[scene]` block — spec 02: everything outside the block is dropped before render.
	 */
	drawn: boolean;
}

/**
 * Every passage this one links to, with the position and the drawn/not-drawn verdict.
 *
 * Both authored forms count (D3): an inline `[[stay->Tavern Fight]]`, and a `[[stay]]` whose
 * target lives in the `links:` map. A `links:` entry with no `[[…]]` anywhere is still an
 * exit — the scene's links overlay the bottom of the stage whether or not a bubble mentions
 * them.
 */
export function passageExits(text: string): PassageExit[] {
	const block = extractSceneBlock(text);
	const targets = scanLinkTargets(text);
	// Only a `links:` entry inside the block reaches the overlay, so that is what decides
	// whether a link written outside is drawn after all.
	const declared = block ? scanLinkTargets(block.text) : new Map<string, string>();
	const out: PassageExit[] = [];
	const named = new Set<string>();
	const blockStart = block ? block.offset : 0;
	const blockEnd = block ? block.offset + block.text.length : 0;

	for (const link of scanWikiLinks(text)) {
		const target = link.target ?? targets.get(link.name);

		named.add(link.name);

		if (target === undefined || target === '') {
			continue;
		}

		const inside = block !== undefined && link.start >= blockStart && link.start < blockEnd;

		out.push({
			drawn: block === undefined || inside || declared.has(link.name),
			line: lineAt(text, link.start),
			target
		});
	}

	for (const [name, target] of targets) {
		if (named.has(name) || target === '') {
			continue;
		}

		// A links: entry can only live in the block, so it is always drawn.
		out.push({
			drawn: true,
			line: block ? findKeyLine(block.text, name) + block.lineOffset : 1,
			target
		});
	}

	// A clickable entity is an exit too, and one with no row under the stage at all — which
	// is exactly why it has to be counted here: nothing else would stop the passage it
	// leads to being reported as unreachable.
	if (block) {
		for (const target of sceneEntityLinkTargets(block.text)) {
			out.push({
				drawn: true,
				line: findKeyLine(block.text, 'link') + block.lineOffset,
				target
			});
		}
	}

	return out;
}

/** Passage name -> the passages it can actually take the player to. */
export function buildLinkGraph(body: StoryLike): Map<string, string[]> {
	const graph = new Map<string, string[]>();

	for (const passage of body.passages ?? []) {
		const seen = new Set<string>();

		for (const exit of passageExits(passage.text ?? '')) {
			seen.add(exit.target);
		}

		graph.set(passage.name, [...seen]);
	}

	return graph;
}

// ---------------------------------------------------------------------------
// The whole story
// ---------------------------------------------------------------------------

export interface StoryLintInput {
	/** How the story is addressed in output — the ref the user typed. */
	ref: string;
	body: StoryLike;
	/** Omit to skip tier 4, which is what a lint with no manifest in hand has to do. */
	catalog?: AssetCatalog;
}

/** All four tiers. Findings come back sorted by file then line, compiler style. */
export function lintStory(input: StoryLintInput): LintFinding[] {
	const {body, catalog, ref} = input;
	const passages = body.passages ?? [];
	const findings: LintFinding[] = [];
	const fileOf = (passage: PassageLike): string => `${ref}/${passage.name}`;

	// --- 1. YAML, per passage ------------------------------------------------
	const scenes: ScenePassage[] = [];

	for (const passage of passages) {
		const text = passage.text ?? '';

		findings.push(...lintPassageText(text, fileOf(passage)));

		const block = extractSceneBlock(text);

		if (block) {
			scenes.push({block, passage, scene: parseScene(block.text).scene});
		}
	}

	// --- 2. cross-passage ----------------------------------------------------
	const index = buildSceneIndex(
		passages.map(passage => ({name: passage.name, text: passage.text ?? ''}))
	);
	const consumed = new Map<string, number>();

	for (const error of index.errors) {
		if (!CROSS_PASSAGE_CODES.has(error.code)) {
			continue;
		}

		const owner = attribute(error, scenes, consumed);

		findings.push({
			file: owner ? fileOf(owner.passage) : ref,
			level: levelOf(error),
			line: owner ? error.line : 0,
			message: textOf(error)
		});
	}

	// --- 3. story graph ------------------------------------------------------
	// Names, not a Set of them: a link target resolves exactly first and then by case
	// (`matchPassageName`), which is what the player's `passageNamed()` does. Linting by a
	// stricter rule would call a working link dead; by a looser one, it would miss the
	// error screen a reader actually gets.
	const names = passages.map(passage => passage.name);
	const startName = passages.find(
		passage => passage.id === body.startPassage
	)?.name;
	const incoming = new Set<string>();

	for (const passage of passages) {
		const text = passage.text ?? '';
		const block = extractSceneBlock(text);
		const exits = passageExits(text);
		const file = fileOf(passage);

		for (const exit of exits) {
			const target = matchPassageName(names, exit.target);

			if (exit.drawn) {
				// The RESOLVED name: a passage reached only by a differently-cased link
				// would otherwise be reported unreachable further down.
				incoming.add(target ?? exit.target);
			}

			if (target === undefined) {
				findings.push({
					file,
					level: 'error',
					line: exit.line,
					message: `Link target '${exit.target}' is not a passage in this story.`
				});
			} else if (target !== exit.target) {
				findings.push({
					file,
					level: 'warn',
					line: exit.line,
					message: `Link target '${exit.target}' differs in case from the passage '${target}'. The player follows it; rename one of them.`
				});
			}
		}

		if (!block) {
			continue;
		}

		// The spec-02 trap. An outside link is dead either way; it is only an ERROR when it
		// was the passage's last way out, because then the scene is a room with no doors.
		const stranded = exits.filter(exit => !exit.drawn);
		const drawn = exits.filter(exit => exit.drawn);

		for (const exit of stranded) {
			const fatal = drawn.length === 0;

			findings.push({
				file,
				level: fatal ? 'error' : 'warn',
				line: exit.line,
				message: fatal
					? `The only exit from this scene is [[…${exit.target}]] written outside the [scene] block, which is never drawn. Move it into links:.`
					: `[[…${exit.target}]] is outside the [scene] block and is never drawn. Move it into links:.`
			});
		}
	}

	for (const passage of passages) {
		if (passage.name === startName || incoming.has(passage.name)) {
			continue;
		}

		findings.push({
			file: fileOf(passage),
			level: 'warn',
			line: 0,
			message: 'Unreachable: nothing links here and it is not the start passage.'
		});
	}

	// --- 4. assets -----------------------------------------------------------
	if (catalog) {
		// The two names `from:` accepts, kept apart so an id always wins over a passage
		// that happens to share its spelling — the same precedence `buildSceneIndex` uses.
		const byId = new Map<string, Scene>();
		const byPassage = new Map<string, Scene>();

		for (const entry of scenes) {
			if (entry.scene.id !== undefined) {
				byId.set(entry.scene.id, entry.scene);
			}

			if (!byPassage.has(entry.passage.name)) {
				byPassage.set(entry.passage.name, entry.scene);
			}
		}

		const lookup = (id: string): Scene | undefined => {
			const hit = byId.get(id);

			if (hit) {
				return hit;
			}

			// Same rule as `buildSceneIndex.nodeFor`: a passage name folds case, an id
			// does not.
			const matched = matchPassageName(byPassage.keys(), id);

			return matched === undefined ? undefined : byPassage.get(matched);
		};
		const seenMissing = new Set<string>();

		for (const entry of scenes) {
			const rows = resolveSceneAssets(entry.scene, catalog, {scenes: lookup});
			const file = fileOf(entry.passage);

			for (const row of rows) {
				// An inherited row's problem belongs to the passage that wrote it; that
				// passage is linted too, so reporting it twice is noise.
				if (row.inherited) {
					continue;
				}

				const line = findKeyLine(entry.block.text, row.key) + entry.block.lineOffset;

				if (row.present === 'unknown') {
					findings.push({
						file,
						level: 'error',
						line,
						message: `Unknown asset '${row.name}' (${row.via}) — not in the manifest.`
					});
				} else if (row.present === 'missing-blob') {
					seenMissing.add(row.id);
					findings.push({
						file,
						level: 'error',
						line,
						message: `Asset ${row.id} '${row.name}' (${row.via}) has no blob in the store.`
					});
				}
			}
		}

		const manifestFile = `${ref}/assets.json`;

		for (const id of catalog.missing) {
			if (seenMissing.has(id)) {
				continue;
			}

			const meta = catalog.byId.get(id);

			findings.push({
				file: manifestFile,
				level: 'error',
				line: 0,
				message: `Manifest entry ${id}${meta ? ` '${meta.name}'` : ''} has no blob in the store.`
			});
		}

		for (const row of unusedAssets(
			scenes.map(entry => entry.scene),
			catalog
		)) {
			findings.push({
				file: manifestFile,
				level: 'warn',
				line: 0,
				message: `Asset ${row.id} '${row.name}' (${row.kind}) is referenced by no scene.`
			});
		}
	}

	return sortFindings(findings);
}

/** Stable by file then line, so the report reads like a compiler's. */
export function sortFindings(findings: LintFinding[]): LintFinding[] {
	return findings
		.map((finding, order) => ({finding, order}))
		.sort(
			(a, b) =>
				a.finding.file.localeCompare(b.finding.file) ||
				a.finding.line - b.finding.line ||
				a.order - b.order
		)
		.map(entry => entry.finding);
}
