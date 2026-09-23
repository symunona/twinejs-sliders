/**
 * Where a scene names a piece of art, a character or a pose — and where it wrote it.
 *
 * `references.ts` next door answers "what passages does this scene point at". This answers
 * "what does the author mean by the word under the cursor", so the passage editor can
 * ctrl-click a `bg:`, a prop id or a character's pose straight into the editor that owns
 * it.
 *
 * Unlike the link scanners this is a real YAML parse rather than a line scanner, because
 * it runs only when the modifier goes down — not on every keystroke — and because the
 * questions it asks need structure a regex cannot see: which entity a `pose:` belongs to,
 * and whether an entry's `ref:` has overridden the id as the name of the art. `parseScene`
 * itself is no use here: it answers with a resolved `Scene`, and by then every offset the
 * author could click is gone.
 *
 * A half-typed block is the normal case, so `parseDocument` is asked for what it can get
 * and whatever it could not parse simply yields no spans.
 */

import {isMap, isScalar, isSeq, parseDocument} from 'yaml';
import type {Node, Scalar, YAMLMap, YAMLSeq} from 'yaml';
import {BEAT_COMMAND_KEYS} from './parse-scene';

/** What the clicked word names. */
export type SceneRefKind =
	/**
	 * A cast, prop or beat-speaker id — or an entity's explicit `ref:`. One namespace, so
	 * whether it is a character or an asset is the caller's to resolve, exactly as the
	 * renderer's `resolveEntity` must.
	 */
	| 'entity'
	/** A backdrop. Always an asset name, never a character. */
	| 'bg'
	/** A pose of {@link SceneRefSpan.owner}. */
	| 'pose';

/** One art/character/pose reference, and where it was written. */
export interface SceneRefSpan {
	/** Offset just past the clickable text, within the scanned string. */
	end: number;
	kind: SceneRefKind;
	/**
	 * `kind: 'pose'` only — the entity the pose belongs to, already resolved through the
	 * entity's `ref:` if it has one. Never empty when set.
	 */
	owner?: string;
	/** The name as written, unquoted. */
	ref: string;
	/** Offset of the clickable text within the scanned string. */
	start: number;
}

/** `pose:` under its current and its retired spelling. Both parse forever (spec 02). */
const POSE_KEYS = ['pose', 'frame'];

const COMMAND_KEYS: readonly string[] = BEAT_COMMAND_KEYS;

function keyOf(pair: {key?: unknown}): string | undefined {
	const {key} = pair;

	return isScalar(key) && typeof key.value === 'string'
		? key.value.trim()
		: undefined;
}

/**
 * Where a scalar's VALUE sits in the source.
 *
 * `range` covers the token as written, quotes and all, so the offsets are narrowed onto
 * the parsed value — a click has to land on the word, and a mark has to underline the
 * word, not the quotes around it.
 */
function scalarSpan(
	text: string,
	node: unknown
): {end: number; start: number; value: string} | undefined {
	if (!isScalar(node) || typeof node.value !== 'string' || !node.range) {
		return undefined;
	}

	const value = (node as Scalar).value!.toString().trim();

	if (value === '' || value === '~' || value === 'null') {
		return undefined;
	}

	const [from, to] = node.range;
	const raw = text.slice(from, to);
	const at = raw.indexOf(value);
	const start = from + (at === -1 ? 0 : at);

	return {end: start + value.length, start, value};
}

/**
 * The `pose:` spans inside one entity body, with the entity they belong to.
 *
 * Every spelling the format accepts: a scalar, a list of pose names, and a list of step
 * maps whose `name:` is the pose (spec 02, "Poses").
 */
function posesIn(
	text: string,
	body: unknown,
	owner: string,
	out: SceneRefSpan[]
) {
	if (!isMap(body) || owner === '') {
		return;
	}

	for (const pair of (body as YAMLMap).items) {
		if (!POSE_KEYS.includes(keyOf(pair) ?? '')) {
			continue;
		}

		const value = pair.value as Node | null;

		if (isSeq(value)) {
			for (const item of (value as YAMLSeq).items) {
				// `[walk_1, walk_2]` — each item is a pose name.
				const scalar = scalarSpan(text, item);

				if (scalar) {
					out.push({...spanOf(scalar), kind: 'pose', owner});
					continue;
				}

				// `[{name: wave, dur: 0.3}]` — the pose is the step's `name:`.
				if (isMap(item)) {
					for (const step of (item as YAMLMap).items) {
						if (keyOf(step) !== 'name') {
							continue;
						}

						const named = scalarSpan(text, step.value);

						if (named) {
							out.push({...spanOf(named), kind: 'pose', owner});
						}
					}
				}
			}

			continue;
		}

		const scalar = scalarSpan(text, value);

		if (scalar) {
			out.push({...spanOf(scalar), kind: 'pose', owner});
		}
	}
}

function spanOf(scalar: {end: number; start: number; value: string}) {
	return {end: scalar.end, ref: scalar.value, start: scalar.start};
}

/** An entity's own `ref:`, if it wrote one. That is the art, and the id is only a handle. */
function refKeyOf(text: string, body: unknown) {
	if (!isMap(body)) {
		return undefined;
	}

	for (const pair of (body as YAMLMap).items) {
		if (keyOf(pair) === 'ref') {
			return scalarSpan(text, pair.value);
		}
	}

	return undefined;
}

/**
 * One `cast:` / `props:` / `entities:` entry: the id itself is clickable, and so is a `ref:`
 * that renamed the art out from under it. Both, not one — the id is what a beat says and
 * the `ref:` is what the library holds, and an author may be reaching for either.
 */
function entityEntry(
	text: string,
	pair: {key?: unknown; value?: unknown},
	out: SceneRefSpan[]
) {
	const id = scalarSpan(text, pair.key);
	const ref = refKeyOf(text, pair.value);

	if (id) {
		out.push({...spanOf(id), kind: 'entity'});
	}

	if (ref) {
		out.push({...spanOf(ref), kind: 'entity'});
	}

	posesIn(text, pair.value, ref?.value ?? id?.value ?? '', out);
}

/** `bg: cellar` and `bg: {id: cellar, fx: parallax_left}` both name one backdrop. */
function bgSpans(text: string, value: unknown, out: SceneRefSpan[]) {
	if (isMap(value)) {
		for (const pair of (value as YAMLMap).items) {
			if (keyOf(pair) !== 'id') {
				continue;
			}

			const scalar = scalarSpan(text, pair.value);

			if (scalar) {
				out.push({...spanOf(scalar), kind: 'bg'});
			}
		}

		return;
	}

	const scalar = scalarSpan(text, value);

	if (scalar) {
		out.push({...spanOf(scalar), kind: 'bg'});
	}
}

/**
 * One beat. A key that is not a command is a speaker — an entity id, clickable like the
 * one in `cast:` — and its body may carry poses and a `bg:` of its own.
 */
function beatSpans(text: string, beat: unknown, out: SceneRefSpan[]) {
	if (!isMap(beat)) {
		return;
	}

	for (const pair of (beat as YAMLMap).items) {
		const key = keyOf(pair);

		if (key === undefined) {
			continue;
		}

		if (key === 'bg') {
			bgSpans(text, pair.value, out);
			continue;
		}

		if (key === 'box') {
			// `box: {text: …, bg: street}` — a narration beat may cut the backdrop too.
			bgInBody(text, pair.value, out);
			continue;
		}

		if (COMMAND_KEYS.includes(key)) {
			continue;
		}

		entityEntry(text, pair, out);
		// `- mira: {say: "…", bg: street}` — `bg:` is a beat BODY key, so it rides on a line
		// of dialogue as readily as it sits on a beat of its own. Only in a beat, though:
		// inside `cast:` it is an error, so `entityEntry` does not look for it.
		bgInBody(text, pair.value, out);
	}
}

/** A `bg:` written inside a beat body — a say line's, or a `box:`'s. */
function bgInBody(text: string, body: unknown, out: SceneRefSpan[]) {
	if (!isMap(body)) {
		return;
	}

	for (const pair of (body as YAMLMap).items) {
		if (keyOf(pair) === 'bg') {
			bgSpans(text, pair.value, out);
		}
	}
}

/**
 * Every backdrop, entity and pose the scene names, in the order written.
 *
 * `text` is the scene block's YAML, not the whole passage: offsets are relative to it, the
 * way {@link sceneLinkTargetSpans} reports them.
 */
export function sceneRefSpans(text: string): SceneRefSpan[] {
	const out: SceneRefSpan[] = [];

	let doc;

	try {
		doc = parseDocument(text, {keepSourceTokens: false});
	} catch {
		// A block too broken to parse names nothing yet. Not an error: the author is typing.
		return out;
	}

	if (!isMap(doc.contents)) {
		return out;
	}

	for (const pair of (doc.contents as YAMLMap).items) {
		switch (keyOf(pair)) {
			case 'bg':
				bgSpans(text, pair.value, out);
				break;

			case 'cast':
			case 'props':
			case 'entities':
				if (isMap(pair.value)) {
					for (const entry of (pair.value as YAMLMap).items) {
						entityEntry(text, entry, out);
					}
				}

				break;

			case 'beats':
				if (isSeq(pair.value)) {
					for (const beat of (pair.value as YAMLSeq).items) {
						beatSpans(text, beat, out);
					}
				}

				break;
		}
	}

	out.sort((a, b) => a.start - b.start);

	return out;
}
