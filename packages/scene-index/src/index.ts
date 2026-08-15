/**
 * @sliders/scene-index — the cross-passage tier (spec 02 "Runtime validation", spec 05
 * tiers 2 and 3).
 *
 * A story format only ever sees one passage at a time; this package is what sees all of
 * them at once. It resolves the `from:` DAG, compiles every scene to its state sequence,
 * and reports the four errors that only exist between passages: duplicate ids, unknown
 * `from:` targets, unknown `@mark`s and cycles.
 */

import {applyScene, collectMarks, runBeats} from '@sliders/scene-core';
import {parseScene} from '@sliders/scene-schema';
import {emptyStage} from '@sliders/scene-types';
import type {Scene, SceneError, SceneId, Stage} from '@sliders/scene-types';
import {extractSceneBlock} from './extract-scene-block';

export {extractSceneBlock} from './extract-scene-block';
export type {SceneBlock} from './extract-scene-block';

export interface SceneIndexEntry {
	/** Name of the passage the scene was authored in. */
	passage: string;
	scene: Scene;
	/** S0 … Sn. `states[0]` is `@enter`, the last is the exit state. */
	states: Stage[];
	/** Mark name -> index into `states`. */
	marks: Map<string, number>;
}

export interface SceneIndex {
	scenes: Map<SceneId, SceneIndexEntry>;
	errors: SceneError[];
	/** `id` (exit state) · `id@enter` · `id@markName`. */
	resolve(ref: string): Stage | undefined;
}

export interface IndexedPassage {
	name: string;
	text: string;
}

interface Pending {
	passage: string;
	scene: Scene;
	/** The `[scene]` block text, kept only so index errors can find a line to point at. */
	blockText: string;
	lineOffset: number;
}

/** `tavern-night@tense` -> `{id: 'tavern-night', mark: 'tense'}`. */
export function splitSceneRef(ref: string): {id: string; mark?: string} {
	const at = ref.indexOf('@');

	if (at <= 0) {
		return {id: ref.trim()};
	}

	const mark = ref.slice(at + 1).trim();

	return {id: ref.slice(0, at).trim(), mark: mark === '' ? undefined : mark};
}

/**
 * Where a top-level key sits in a scene block. The parser's node positions are gone by the
 * time the index runs, so this re-finds the line rather than pointing everything at 1:1.
 */
function keyPosition(
	blockText: string,
	key: string,
	lineOffset: number
): {line: number; col: number} {
	const lines = blockText.split('\n');
	const re = new RegExp(`^([ \\t]*)${key}[ \\t]*:`);

	for (let i = 0; i < lines.length; i++) {
		const match = re.exec(lines[i]);

		if (match) {
			return {col: match[1].length + 1, line: lineOffset + i + 1};
		}
	}

	return {col: 1, line: lineOffset + 1};
}

export function buildSceneIndex(passages: IndexedPassage[]): SceneIndex {
	const errors: SceneError[] = [];
	const scenes = new Map<SceneId, SceneIndexEntry>();
	const pending = new Map<SceneId, Pending>();

	// --- 1. Parse every passage that has a [scene] block ---------------------
	for (const passage of passages) {
		const block = extractSceneBlock(passage.text);

		if (!block) {
			continue;
		}

		const result = parseScene(block.text);

		for (const error of result.errors) {
			errors.push({
				...error,
				endLine:
					error.endLine === undefined ? undefined : error.endLine + block.lineOffset,
				line: error.line + block.lineOffset,
				message: `${passage.name}: ${error.message}`
			});
		}

		const id = result.scene.id;

		if (id === undefined) {
			// Legal — an id is only required if something refers to the scene (spec 02) —
			// but an anonymous scene can never be a `from:` target, so it is not indexed.
			continue;
		}

		const existing = pending.get(id);

		if (existing) {
			errors.push({
				code: 'dupe-scene-id',
				message: `Duplicate scene id '${id}', already used by passage '${existing.passage}'.`,
				severity: 'error',
				...keyPosition(block.text, 'id', block.lineOffset),
				hint: 'Scene ids are global. Rename one of them.'
			});
			continue;
		}

		pending.set(id, {
			blockText: block.text,
			lineOffset: block.lineOffset,
			passage: passage.name,
			scene: result.scene
		});
	}

	// --- 2. Resolve the from: DAG, deepest first -----------------------------
	const done = new Set<SceneId>();
	const cycleReported = new Set<SceneId>();

	function stateFor(id: SceneId, mark: string | undefined): Stage | undefined {
		const entry = scenes.get(id);

		if (!entry) {
			return undefined;
		}

		if (mark === undefined) {
			return entry.states[entry.states.length - 1];
		}

		if (mark === 'enter') {
			return entry.states[0];
		}

		const index = entry.marks.get(mark);

		return index === undefined ? undefined : entry.states[index];
	}

	function build(id: SceneId, chain: SceneId[]): void {
		if (done.has(id)) {
			return;
		}

		const self = pending.get(id);

		if (!self) {
			return;
		}

		if (chain.includes(id)) {
			const cycle = [...chain.slice(chain.indexOf(id)), id];

			for (const node of cycle) {
				if (cycleReported.has(node)) {
					continue;
				}

				cycleReported.add(node);

				const at = pending.get(node);

				if (!at) {
					continue;
				}

				errors.push({
					code: 'from-cycle',
					hint: 'from: edges must form a DAG. Break the loop.',
					message: `Scene '${node}' is part of a from: cycle: ${cycle.join(' -> ')}.`,
					severity: 'error',
					...keyPosition(at.blockText, 'from', at.lineOffset)
				});
			}

			return;
		}

		let base = emptyStage();
		const from = self.scene.from;

		if (from !== undefined) {
			const ref = splitSceneRef(from);

			if (!pending.has(ref.id)) {
				errors.push({
					code: 'unknown-from',
					hint: 'from: names a scene id, not a passage name.',
					message: `Unknown scene '${ref.id}' in from: '${from}'.`,
					severity: 'error',
					...keyPosition(self.blockText, 'from', self.lineOffset)
				});
			} else {
				build(ref.id, [...chain, id]);

				// If the target still has no states it is on the stack above us, i.e. this
				// edge closes a cycle. That has already been reported; fall back to an empty
				// base so the scene still renders something.
				if (scenes.has(ref.id)) {
					const resolved = stateFor(ref.id, ref.mark);

					if (resolved === undefined) {
						errors.push({
							code: 'unknown-from',
							hint: `Add '- mark: ${ref.mark}' to the beats of '${ref.id}'.`,
							message: `Scene '${ref.id}' has no mark '${ref.mark ?? ''}'.`,
							severity: 'error',
							...keyPosition(self.blockText, 'from', self.lineOffset)
						});
					} else {
						base = resolved;
					}
				}
			}
		}

		const enter = applyScene(base, self.scene);
		const states = runBeats(enter, self.scene.beats);

		scenes.set(id, {
			marks: collectMarks(self.scene.beats),
			passage: self.passage,
			scene: self.scene,
			states
		});
		done.add(id);
	}

	for (const id of pending.keys()) {
		build(id, []);
	}

	return {
		errors,
		resolve(ref: string): Stage | undefined {
			const {id, mark} = splitSceneRef(ref);

			return stateFor(id, mark);
		},
		scenes
	};
}
