/**
 * @sliders/scene-index — the cross-passage tier (spec 02 "Runtime validation", spec 05
 * tiers 2 and 3).
 *
 * A story format only ever sees one passage at a time; this package is what sees all of
 * them at once. It resolves the `from:` DAG, compiles every scene to its state sequence,
 * and reports the errors that only exist between passages: unknown `from:` targets,
 * unknown `@mark`s and cycles.
 */

import {applyScene, collectMarks, runBeats} from '@sliders/scene-core';
import {parseScene} from '@sliders/scene-schema';
import {emptyStage, matchPassageName} from '@sliders/scene-types';
import type {Scene, SceneError, Stage} from '@sliders/scene-types';
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
	/** Keyed by passage name. */
	scenes: Map<string, SceneIndexEntry>;
	errors: SceneError[];
	/**
	 * `Passage` (exit state) · `Passage@enter` · `Passage@markName`. The name matches the
	 * way a link to the passage does: exact, then case-insensitively.
	 */
	resolve(ref: string): Stage | undefined;
}

export interface IndexedPassage {
	name: string;
	text: string;
}

/** One scene block, before its `from:` chain has been walked. */
interface Node {
	passage: string;
	scene: Scene;
	/** The `[scene]` block text, kept only so index errors can find a line to point at. */
	blockText: string;
	lineOffset: number;
}

/** `Tavern Night@tense` -> `{id: 'Tavern Night', mark: 'tense'}`. */
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
	const scenes = new Map<string, SceneIndexEntry>();

	const nodes: Node[] = [];
	const byPassage = new Map<string, number>();

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

		// Passage names are unique in a story, but a duplicate would be the story's
		// problem, not ours: keep the first.
		if (byPassage.has(passage.name)) {
			continue;
		}

		byPassage.set(passage.name, nodes.length);
		nodes.push({
			blockText: block.text,
			lineOffset: block.lineOffset,
			passage: passage.name,
			scene: result.scene
		});
	}

	// --- 2. Resolve the from: DAG, deepest first -----------------------------
	const built: (SceneIndexEntry | undefined)[] = new Array(nodes.length).fill(
		undefined
	);
	const done = new Set<number>();
	const cycleReported = new Set<number>();

	/**
	 * A passage name resolves the way a LINK to it resolves -- exact, then
	 * case-insensitively -- or `from: official landing` would miss `Official Landing` while
	 * `[[official landing]]` reaches it, and the author would have two spelling rules.
	 */
	function nodeFor(name: string): number | undefined {
		const matched = matchPassageName(byPassage.keys(), name);

		return matched === undefined ? undefined : byPassage.get(matched);
	}

	function stateAt(at: number, mark: string | undefined): Stage | undefined {
		const entry = built[at];

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

	function build(at: number, chain: number[]): void {
		if (done.has(at)) {
			return;
		}

		const self = nodes[at];

		if (chain.includes(at)) {
			const cycle = [...chain.slice(chain.indexOf(at)), at];

			for (const node of cycle) {
				if (cycleReported.has(node)) {
					continue;
				}

				cycleReported.add(node);

				const rep = nodes[node];

				errors.push({
					code: 'from-cycle',
					hint: 'from: edges must form a DAG. Break the loop.',
					message: `Scene '${rep.passage}' is part of a from: cycle: ${cycle
						.map(step => nodes[step].passage)
						.join(' -> ')}.`,
					severity: 'error',
					...keyPosition(rep.blockText, 'from', rep.lineOffset)
				});
			}

			return;
		}

		let base = emptyStage();
		const from = self.scene.from;

		if (from !== undefined) {
			const ref = splitSceneRef(from);
			const target = nodeFor(ref.id);

			if (target === undefined) {
				errors.push({
					code: 'unknown-from',
					hint: 'from: names a passage that has a scene.',
					message: `Unknown scene '${ref.id}' in from: '${from}'.`,
					severity: 'error',
					...keyPosition(self.blockText, 'from', self.lineOffset)
				});
			} else {
				build(target, [...chain, at]);

				// If the target still has no states it is on the stack above us, i.e. this
				// edge closes a cycle. That has already been reported; fall back to an empty
				// base so the scene still renders something.
				if (built[target]) {
					const resolved = stateAt(target, ref.mark);

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

		built[at] = {
			marks: collectMarks(self.scene.beats),
			passage: self.passage,
			scene: self.scene,
			states
		};
		done.add(at);
	}

	for (let at = 0; at < nodes.length; at++) {
		build(at, []);
	}

	// --- 3. Publish -----------------------------------------------------------
	for (const [name, at] of byPassage) {
		const entry = built[at];

		if (entry) {
			scenes.set(name, entry);
		}
	}

	return {
		errors,
		resolve(ref: string): Stage | undefined {
			const {id, mark} = splitSceneRef(ref);
			const at = nodeFor(id);

			return at === undefined ? undefined : stateAt(at, mark);
		},
		scenes
	};
}
