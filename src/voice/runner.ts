/**
 * The tool runner: one function call in, one small JSON result out.
 *
 * It holds the session's only real safety rule — a passage must be READ before it is
 * written. A model that has not seen the text it is replacing is not editing, it is
 * guessing, and the author hears "done" either way. Everything else is guarded by undo.
 *
 * No socket, no audio, no React. The panel drives this with typed text and so do the
 * tests; the Live adapter is just a third caller.
 */

import {buildLinkGraph, formatFinding} from '@sliders/story-map';
import type {LintFinding} from '@sliders/story-map';
import {buildSceneIndex, extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import {matchPassageName} from '@sliders/scene-types';
import {patchBeatText, patchSceneText} from './scene-patch';
import {voiceToolsByName} from './tools';
import {toolError} from './voice.types';
import type {ToolPassage, ToolResult, VoiceToolEnv} from './voice.types';

/** Caps. A tool result is context the model pays for on every later turn. */
const MAX_LINT_ROWS = 40;
const MAX_ASSET_ROWS = 60;
const MAX_REV_ROWS = 15;
const MAX_VERIFY_ROWS = 10;

/**
 * A finding without its line. A write above a pre-existing error moves that error down a
 * line; keyed with the line, it would come back as "new" and the model would chase a
 * problem it did not cause.
 */
function findingKey(finding: LintFinding): string {
	return `${finding.level}\u0000${finding.file}\u0000${finding.message}`;
}

/**
 * What a write did to the lint, as the write's own result carries it.
 *
 * Diffed against a lint taken just before, so the model hears about what it broke and
 * what it fixed — not about every warning the story already had, which it would then try
 * to fix unasked. `info` is advice and never reported.
 */
function lintDelta(
	before: LintFinding[],
	after: LintFinding[]
): {errors: number; fixed: number; new: string[]; truncated?: true; warnings: number} {
	const remaining = new Map<string, number>();

	for (const finding of before) {
		if (finding.level !== 'info') {
			const key = findingKey(finding);

			remaining.set(key, (remaining.get(key) ?? 0) + 1);
		}
	}

	const added: LintFinding[] = [];

	for (const finding of after) {
		if (finding.level === 'info') {
			continue;
		}

		const key = findingKey(finding);
		const left = remaining.get(key) ?? 0;

		if (left > 0) {
			remaining.set(key, left - 1);
		} else {
			added.push(finding);
		}
	}

	return {
		errors: after.filter(finding => finding.level === 'error').length,
		fixed: [...remaining.values()].reduce((sum, count) => sum + count, 0),
		new: added.slice(0, MAX_VERIFY_ROWS).map(formatFinding),
		...(added.length > MAX_VERIFY_ROWS ? {truncated: true as const} : {}),
		warnings: after.filter(finding => finding.level === 'warn').length
	};
}

function str(args: Record<string, unknown>, key: string): string | undefined {
	const value = args[key];

	return typeof value === 'string' && value !== '' ? value : undefined;
}

function int(args: Record<string, unknown>, key: string): number | undefined {
	const value = args[key];

	if (typeof value === 'number' && Number.isFinite(value)) {
		return Math.trunc(value);
	}

	// Models send integers as strings often enough that rejecting them is just rudeness.
	if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) {
		return Math.trunc(Number(value));
	}

	return undefined;
}

function strings(args: Record<string, unknown>, key: string): string[] {
	const value = args[key];

	return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

export interface ToolRunner {
	/**
	 * Re-arm the screenshot cap. The adapter calls this when the model's turn ends; a
	 * caller with no notion of turns simply never does, and gets one picture per session.
	 */
	endTurn(): void;
	/** Refs whose text the model has actually seen. The `write_passage` gate. */
	readonly seen: ReadonlySet<string>;
	run(name: string, args: Record<string, unknown>): Promise<ToolResult>;
}

export function createToolRunner(env: VoiceToolEnv): ToolRunner {
	const seen = new Set<string>();
	/**
	 * One picture per turn (plan §4). Not a cost guard — a model handed two views of the
	 * same stage in one turn starts comparing them and narrating the difference, which is
	 * not what anyone asked it to look at.
	 */
	let shotThisTurn = false;

	/**
	 * Resolve what the model calls a passage. Name first and case-insensitively, because
	 * that is what the author said out loud; id second, because that is what an earlier
	 * tool result handed back.
	 */
	function find(ref: string | undefined): ToolPassage | undefined {
		if (ref === undefined) {
			return undefined;
		}

		const passages = env.story().passages;
		const lowered = ref.toLowerCase();

		return (
			passages.find(passage => passage.name.toLowerCase() === lowered) ??
			passages.find(passage => passage.id === ref)
		);
	}

	/** A scene, by the name of the passage it lives in — the rule `from:` resolves by. */
	function findScene(
		name: string
	): {passage: ToolPassage; scene: ReturnType<typeof parseScene>['scene']} | undefined {
		const withScene = new Map<string, {passage: ToolPassage; text: string}>();

		for (const passage of env.story().passages) {
			const block = extractSceneBlock(passage.text);

			if (block && !withScene.has(passage.name)) {
				withScene.set(passage.name, {passage, text: block.text});
			}
		}

		const matched = matchPassageName(withScene.keys(), name);
		const hit = matched === undefined ? undefined : withScene.get(matched);

		return hit && {passage: hit.passage, scene: parseScene(hit.text).scene};
	}

	const handlers: Record<
		string,
		(args: Record<string, unknown>) => Promise<ToolResult> | ToolResult
	> = {
		// --- read ------------------------------------------------------------
		async map() {
			const map = await env.map();

			return {
				assets: map.assets,
				errors: map.errors,
				name: map.name,
				ok: true,
				passages: map.passages.map(passage => ({
					lines: passage.lines,
					links: passage.links,
					name: passage.name,
					scene: passage.scene,
					tags: passage.tags
				})),
				scenes: map.scenes,
				warnings: map.warnings
			};
		},

		read_passage(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			// The gate. By name AND by id, so a later write may address it either way.
			seen.add(passage.id);
			seen.add(passage.name.toLowerCase());

			const block = extractSceneBlock(passage.text);

			return {
				name: passage.name,
				ok: true,
				scene: block ? block.lineOffset + 1 : undefined,
				tags: passage.tags,
				text: passage.text
			};
		},

		read_scene(args) {
			const sceneName = str(args, 'scene');

			if (!sceneName) {
				return toolError('read_scene wants a scene');
			}

			const found = findScene(sceneName);

			if (!found) {
				return toolError(`no scene '${sceneName}'`);
			}

			const {passage, scene} = found;

			// Reading a scene is reading its passage — the text came back either way.
			seen.add(passage.id);
			seen.add(passage.name.toLowerCase());

			return {
				beats: scene.beats.map((beat, index) => ({...beat, index})),
				bg: scene.bg,
				cast: Object.entries(scene.entities)
					.filter(([, patch]) => patch?.kind === 'cast')
					.map(([id]) => id),
				from: scene.from,
				ok: true,
				passage: passage.name,
				props: Object.entries(scene.entities)
					.filter(([, patch]) => patch?.kind !== 'cast')
					.map(([id]) => id)
			};
		},

		async lint(args) {
			const ref = str(args, 'ref');
			let findings = await env.lint();

			if (ref !== undefined) {
				const passage = find(ref);

				if (!passage) {
					return toolError(`no passage '${ref}'`);
				}

				findings = findings.filter(finding =>
					finding.file.endsWith(`/${passage.name}`)
				);
			}

			return {
				errors: findings.filter(finding => finding.level === 'error').length,
				findings: findings.slice(0, MAX_LINT_ROWS).map(formatFinding),
				ok: true,
				truncated: findings.length > MAX_LINT_ROWS,
				warnings: findings.filter(finding => finding.level === 'warn').length
			};
		},

		graph(args) {
			const story = env.story();
			const graph = buildLinkGraph({
				id: story.id,
				name: story.name,
				passages: story.passages
			});
			const from = str(args, 'from');
			const depth = int(args, 'depth') ?? Infinity;

			if (from === undefined) {
				return {
					edges: [...graph].map(([node, links]) => ({from: node, to: links})),
					ok: true
				};
			}

			const start = find(from);

			if (!start) {
				return toolError(`no passage '${from}'`);
			}

			// Breadth-first from one passage, which is the shape of "what can the reader
			// get to from here" — the question anyone asks a story graph out loud.
			const seenNodes = new Map<string, number>();
			const queue: [string, number][] = [[start.name, 0]];

			while (queue.length > 0) {
				const [node, level] = queue.shift()!;

				if (seenNodes.has(node) || level > depth) {
					continue;
				}

				seenNodes.set(node, level);

				for (const next of graph.get(node) ?? []) {
					if (!seenNodes.has(next)) {
						queue.push([next, level + 1]);
					}
				}
			}

			return {
				edges: [...seenNodes].map(([node, level]) => ({
					depth: level,
					from: node,
					missing: !graph.has(node),
					to: level + 1 <= depth ? (graph.get(node) ?? []) : []
				})),
				ok: true
			};
		},

		async list_assets(args) {
			const sceneName = str(args, 'scene');
			const assets = await env.assets();
			const usage = await env.assetUsage();
			let rows = assets.map(asset => ({
				bytes: asset.bytes,
				id: asset.id,
				kind: asset.kind,
				name: asset.name,
				usedBy: usage[asset.id] ?? []
			}));

			if (sceneName !== undefined) {
				const found = findScene(sceneName);

				if (!found) {
					return toolError(`no scene '${sceneName}'`);
				}

				rows = rows.filter(row => row.usedBy.includes(found.passage.name));
			}

			return {
				assets: rows.slice(0, MAX_ASSET_ROWS),
				ok: true,
				total: rows.length,
				truncated: rows.length > MAX_ASSET_ROWS
			};
		},

		async find_asset(args) {
			const q = str(args, 'q');

			if (!q) {
				return toolError('find_asset wants a q');
			}

			const lowered = q.toLowerCase();
			const assets = await env.assets();
			const matches = assets.filter(asset =>
				asset.name.toLowerCase().includes(lowered)
			);

			return {
				matches: matches.slice(0, MAX_ASSET_ROWS).map(asset => ({
					id: asset.id,
					kind: asset.kind,
					name: asset.name
				})),
				ok: true
			};
		},

		async screenshot_scene(args) {
			if (!env.screenshot) {
				return toolError('the scene preview is not mounted, so there is nothing to look at');
			}

			if (shotThisTurn) {
				return toolError('one screenshot per turn — say what you see first');
			}

			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			const shot = await env.screenshot(passage.id, int(args, 'beat'));

			shotThisTurn = true;

			return {
				beat: int(args, 'beat') ?? 0,
				height: shot.height,
				image: {data: shot.data, mime: shot.mime},
				ok: true,
				width: shot.width
			};
		},

		async revs() {
			if (!env.revs) {
				return toolError('this story has no revision history here');
			}

			const rows = await env.revs();

			return {ok: true, revs: rows.slice(0, MAX_REV_ROWS)};
		},

		// --- write -----------------------------------------------------------
		write_passage(args) {
			const ref = str(args, 'ref');
			const text = args.text;
			const passage = find(ref);

			if (!passage) {
				return toolError(`no passage '${ref}'`);
			}

			if (typeof text !== 'string') {
				return toolError('write_passage wants text');
			}

			if (!seen.has(passage.id)) {
				return toolError(
					`read_passage '${passage.name}' first — a write over text you have not seen is not an edit`
				);
			}

			if (text === passage.text) {
				return {name: passage.name, ok: true, unchanged: true};
			}

			env.writePassage(passage.id, text);

			return {
				lines: text.split('\n').length,
				name: passage.name,
				ok: true
			};
		},

		create_passage(args) {
			const name = str(args, 'name');

			if (!name) {
				return toolError('create_passage wants a name');
			}

			if (find(name)) {
				return toolError(`there is already a passage named '${name}'`);
			}

			const at = args.at;
			const position =
				Array.isArray(at) && at.length === 2 && at.every(n => typeof n === 'number')
					? ([at[0], at[1]] as [number, number])
					: undefined;
			const id = env.createPassage(name, str(args, 'text') ?? '', position);

			// A passage this session just wrote is a passage this session has seen.
			seen.add(id);
			seen.add(name.toLowerCase());

			return {id, name, ok: true};
		},

		delete_passage(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			env.deletePassage(passage.id);

			return {name: passage.name, ok: true};
		},

		rename_passage(args) {
			const passage = find(str(args, 'ref'));
			const name = str(args, 'name');

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			if (!name) {
				return toolError('rename_passage wants a name');
			}

			if (find(name) && find(name)!.id !== passage.id) {
				return toolError(`there is already a passage named '${name}'`);
			}

			env.renamePassage(passage.id, name);
			seen.add(name.toLowerCase());

			return {from: passage.name, ok: true, to: name};
		},

		tag_passage(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			const add = strings(args, 'add');
			const remove = strings(args, 'remove');

			if (add.length === 0 && remove.length === 0) {
				return toolError('tag_passage wants add or remove');
			}

			env.tagPassage(passage.id, add, remove);

			return {name: passage.name, ok: true};
		},

		patch_scene(args) {
			const sceneName = str(args, 'scene');
			const yaml = args.yaml;

			if (!sceneName || typeof yaml !== 'string') {
				return toolError('patch_scene wants a scene and yaml');
			}

			const found = findScene(sceneName);

			if (!found) {
				return toolError(`no scene '${sceneName}'`);
			}

			const result = patchSceneText(found.passage.text, yaml);

			if (result.error) {
				return toolError(result.error);
			}

			if (result.text === found.passage.text) {
				return {changed: result.changed, ok: true, unchanged: true};
			}

			env.writePassage(found.passage.id, result.text, 'scene');

			return {changed: result.changed, ok: true, passage: found.passage.name};
		},

		set_beat(args) {
			const sceneName = str(args, 'scene');
			const beat = int(args, 'beat');
			const patch = args.patch;

			if (!sceneName || beat === undefined || typeof patch !== 'string') {
				return toolError('set_beat wants a scene, a beat index and a patch');
			}

			const found = findScene(sceneName);

			if (!found) {
				return toolError(`no scene '${sceneName}'`);
			}

			const result = patchBeatText(found.passage.text, beat, patch);

			if (result.error) {
				return toolError(result.error);
			}

			if (result.text === found.passage.text) {
				return {changed: result.changed, ok: true, unchanged: true};
			}

			env.writePassage(found.passage.id, result.text, 'scene');

			return {beat, changed: result.changed, ok: true, passage: found.passage.name};
		},

		link(args) {
			const from = find(str(args, 'from'));
			const to = str(args, 'to');

			if (!from) {
				return toolError(`no passage '${args.from}'`);
			}

			if (!to) {
				return toolError('link wants a target name');
			}

			if (!seen.has(from.id)) {
				return toolError(
					`read_passage '${from.name}' first — a link is appended to its text`
				);
			}

			const created = find(to) === undefined;

			// Appended as an ordinary wiki link. A scene block would need the link inside
			// `links:`, and picking a name for the entry is a decision the model should
			// make out loud with `patch_scene`, not one this tool should make silently.
			const separator = from.text.endsWith('\n') || from.text === '' ? '' : '\n';

			env.writePassage(from.id, `${from.text}${separator}[[${to}]]\n`);

			return {created, from: from.name, ok: true, to};
		},

		find_replace(args) {
			const q = str(args, 'q');
			const withText = args.with;

			if (!q || typeof withText !== 'string') {
				return toolError('find_replace wants q and with');
			}

			const scope = str(args, 'scope');
			let passageIds: string[] | undefined;

			if (scope !== undefined) {
				const passage = find(scope);

				if (!passage) {
					return toolError(`no passage '${scope}'`);
				}

				passageIds = [passage.id];
			}

			const count = env.findReplace(q, withText, passageIds);

			return {ok: true, passages: count};
		},

		// --- ui --------------------------------------------------------------
		goto(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			env.goto(passage.id);

			return {name: passage.name, ok: true};
		},

		open_preview(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			env.openPreview(passage.id, int(args, 'beat'));

			return {name: passage.name, ok: true};
		},

		open_passage_editor(args) {
			const passage = find(str(args, 'ref'));

			if (!passage) {
				return toolError(`no passage '${args.ref}'`);
			}

			env.openPassageEditor(passage.id);

			return {name: passage.name, ok: true};
		},

		highlight(args) {
			const refs = strings(args, 'refs');
			const resolved = refs.map(ref => [ref, find(ref)] as const);
			const found = resolved
				.map(([, passage]) => passage)
				.filter((passage): passage is ToolPassage => passage !== undefined);

			env.highlight(found.map(passage => passage.id));

			return {
				highlighted: found.length,
				missing: resolved
					.filter(([, passage]) => passage === undefined)
					.map(([ref]) => ref),
				ok: true
			};
		},

		async checkpoint(args) {
			const label = str(args, 'label');

			if (!label) {
				return toolError('checkpoint wants a label');
			}

			if (!env.checkpoint) {
				return toolError('this story is not on a server, so there is nothing to pin');
			}

			await env.checkpoint(label.slice(0, 120));

			return {label, ok: true};
		}
	};

	return {
		endTurn() {
			shotThisTurn = false;
		},
		async run(name, args) {
			if (!voiceToolsByName.has(name)) {
				return toolError(`no tool called '${name}'`);
			}

			const handler = handlers[name];

			if (!handler) {
				return toolError(`'${name}' is declared but not wired up`);
			}

			try {
				if (voiceToolsByName.get(name)!.kind !== 'write') {
					return await handler(args ?? {});
				}

				// Every write is verified, unasked. A model that has to remember to lint
				// does not, and then tells the author "done" over a scene that no longer
				// parses. A lint that fails is not the write's failure — skip the check.
				const before = await env.lint().catch(() => undefined);
				const result = await handler(args ?? {});

				if (result.ok === false || result.unchanged === true || !before) {
					return result;
				}

				const after = await env.lint().catch(() => undefined);

				return after ? {...result, lint: lintDelta(before, after)} : result;
			} catch (error) {
				// A thrown action creator — a duplicate name, a passage that moved out from
				// under the call — is a normal outcome here, not a crash. The model gets the
				// message and tries something else.
				return toolError((error as Error).message);
			}
		},
		seen
	};
}

/**
 * The passages that hold a scene, for a caller that wants to tell the model what exists without
 * running `map`. Kept beside the runner because it is the same walk.
 */
export function sceneNamesOf(passages: ToolPassage[]): string[] {
	return [
		...buildSceneIndex(
			passages.map(passage => ({name: passage.name, text: passage.text}))
		).scenes.keys()
	];
}
