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
import {buildSceneIndex, extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import {patchBeatText, patchSceneText} from './scene-patch';
import {voiceToolsByName} from './tools';
import {toolError} from './voice.types';
import type {ToolPassage, ToolResult, VoiceToolEnv} from './voice.types';

/** Caps. A tool result is context the model pays for on every later turn. */
const MAX_LINT_ROWS = 40;
const MAX_ASSET_ROWS = 60;
const MAX_REV_ROWS = 15;

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

	/** The passage a scene id lives in. */
	function findScene(
		sceneId: string
	): {passage: ToolPassage; scene: ReturnType<typeof parseScene>['scene']} | undefined {
		for (const passage of env.story().passages) {
			const block = extractSceneBlock(passage.text);

			if (!block) {
				continue;
			}

			const scene = parseScene(block.text).scene;

			if (scene.id === sceneId) {
				return {passage, scene};
			}
		}

		return undefined;
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
			const sceneId = str(args, 'sceneId');

			if (!sceneId) {
				return toolError('read_scene wants a sceneId');
			}

			const found = findScene(sceneId);

			if (!found) {
				return toolError(`no scene '${sceneId}'`);
			}

			const {passage, scene} = found;

			// Reading a scene is reading its passage — the text came back either way.
			seen.add(passage.id);
			seen.add(passage.name.toLowerCase());

			return {
				beats: scene.beats.map((beat, index) => ({...beat, index})),
				bg: scene.bg ?? scene.id,
				cast: Object.entries(scene.entities)
					.filter(([, patch]) => patch?.kind === 'cast')
					.map(([id]) => id),
				from: scene.from,
				id: scene.id,
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
			const sceneId = str(args, 'sceneId');
			const assets = await env.assets();
			const usage = await env.assetUsage();
			let rows = assets.map(asset => ({
				bytes: asset.bytes,
				id: asset.id,
				kind: asset.kind,
				name: asset.name,
				usedBy: usage[asset.id] ?? []
			}));

			if (sceneId !== undefined) {
				rows = rows.filter(row => row.usedBy.includes(sceneId));

				if (rows.length === 0 && !findScene(sceneId)) {
					return toolError(`no scene '${sceneId}'`);
				}
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
			const sceneId = str(args, 'sceneId');
			const yaml = args.yaml;

			if (!sceneId || typeof yaml !== 'string') {
				return toolError('patch_scene wants a sceneId and yaml');
			}

			const found = findScene(sceneId);

			if (!found) {
				return toolError(`no scene '${sceneId}'`);
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
			const sceneId = str(args, 'sceneId');
			const beat = int(args, 'beat');
			const patch = args.patch;

			if (!sceneId || beat === undefined || typeof patch !== 'string') {
				return toolError('set_beat wants a sceneId, a beat index and a patch');
			}

			const found = findScene(sceneId);

			if (!found) {
				return toolError(`no scene '${sceneId}'`);
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
				return await handler(args ?? {});
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
 * The index of scene ids, for a caller that wants to tell the model what exists without
 * running `map`. Kept beside the runner because it is the same walk.
 */
export function sceneIdsOf(passages: ToolPassage[]): string[] {
	return [
		...buildSceneIndex(
			passages.map(passage => ({name: passage.name, text: passage.text}))
		).scenes.keys()
	];
}
