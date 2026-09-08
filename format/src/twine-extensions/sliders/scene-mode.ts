/**
 * Syntax highlighting inside a `[scene]` block.
 *
 * Chapbook's own mode treats a modifier's body as plain prose, which leaves a scene as one
 * grey wall of YAML. This tokenizes the block instead, and — the part that earns its
 * keep — colours an unknown top-level key as an ERROR, so a typo shows up while it is
 * being typed rather than at preview time.
 *
 * The key lists come from `@sliders/scene-schema`, the same arrays the parser validates
 * against. Do not inline copies of them here: a key added to the schema must light up in
 * the editor on the same commit.
 */

import {
	BEAT_COMMAND_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	SAY_KEYS,
	TOP_LEVEL_KEYS
} from '@sliders/scene-schema';
import {StringStream} from 'codemirror';

export interface SceneModeState {
	inScene?: boolean;
	/** Indent of the line being tokenized, to tell a top-level key from a nested one. */
	sceneIndent?: number;
	/** Depth of `{`/`[` nesting, so a flow map's keys are not read as top-level keys. */
	flowDepth?: number;
}

/** Any Chapbook modifier line — `[note]`, `[if x]` — but never a `[[link]]`. */
export const MODIFIER_LINE = /^\s*\[(?!\[)[^\]]*\]\s*$/;

/** The one modifier that opens a scene. */
export const SCENE_MODIFIER_LINE = /^\s*\[scene\]\s*$/i;

/** Keys that are legal somewhere below the top level. */
const NESTED_KEYS: string[] = [
	...ENTITY_KEYS,
	...LINK_KEYS,
	// Camera and bubble geometry, which are not entity keys.
	'x',
	'y',
	'amount'
];

const TOP_KEYS: string[] = [...TOP_LEVEL_KEYS];

/** Beat commands plus the one key that turns a beat into speech. */
const BEAT_KEYS: string[] = [...BEAT_COMMAND_KEYS, ...SAY_KEYS];

/**
 * Token one step of a scene block. Returns a CodeMirror token style, or null for
 * whitespace and punctuation. Clears `state.inScene` when the block ends.
 */
export function sceneToken(
	stream: StringStream,
	state: SceneModeState
): string | null {
	if (stream.sol()) {
		state.sceneIndent = /^\s*/.exec(stream.string)?.[0].length ?? 0;
		state.flowDepth = 0;

		// The next modifier closes the block. Hand the line back to the outer mode.
		if (MODIFIER_LINE.test(stream.string)) {
			state.inScene = false;
			return null;
		}
	}

	if (stream.eatSpace()) {
		return null;
	}

	if (stream.peek() === '#') {
		stream.skipToEnd();
		return 'comment';
	}

	if (stream.match(/^\[\[[^\]]+?\]\]/)) {
		return 'link';
	}

	if (stream.match(/^"(?:[^"\\]|\\.)*"/) || stream.match(/^'(?:[^'\\]|\\.)*'/)) {
		return 'string';
	}

	// `!only`, the one tag the subset permits.
	if (stream.match(/^![a-z]+/i)) {
		return 'atom';
	}

	const key = stream.match(/^[A-Za-z_][\w. -]*(?=\s*:(\s|$))/) as
		| RegExpMatchArray
		| null;

	if (key) {
		const name = key[0].trim();
		const atTopLevel =
			(state.sceneIndent ?? 0) === 0 &&
			(state.flowDepth ?? 0) === 0 &&
			!stream.string.trimStart().startsWith('- ');

		if (atTopLevel) {
			return TOP_KEYS.includes(name) ? 'keyword' : 'error';
		}

		// Below the top level a key can be an author's own id, so an unknown one is
		// ordinary, not wrong.
		if (BEAT_KEYS.includes(name)) {
			return 'atom';
		}

		return NESTED_KEYS.includes(name) ? 'keyword' : 'def';
	}

	if (stream.match(/^-?(\d+\.?\d*|\.\d+)\b/)) {
		return 'number';
	}

	// Booleans, null, and `@mark` references.
	if (stream.match(/^(true|false|yes|no|null|~)\b/) || stream.match(/^@[\w-]+/)) {
		return 'atom';
	}

	const punctuation = stream.match(/^[-:{}[\],]/) as RegExpMatchArray | null;

	if (punctuation) {
		if (punctuation[0] === '{' || punctuation[0] === '[') {
			state.flowDepth = (state.flowDepth ?? 0) + 1;
		} else if (punctuation[0] === '}' || punctuation[0] === ']') {
			state.flowDepth = Math.max(0, (state.flowDepth ?? 0) - 1);
		}

		return null;
	}

	if (stream.eatWhile(/[^\s:,{}[\]#]/)) {
		return 'string';
	}

	stream.next();
	return null;
}
