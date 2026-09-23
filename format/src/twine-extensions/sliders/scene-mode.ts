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
	BEAT_BODY_KEYS,
	BEAT_COMMAND_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	RETIRED_ENTITY_KEYS,
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
	/**
	 * Set once a key token has been emitted and cleared as soon as its value has been.
	 * Without it the tokenizer has no notion of "I am in a value", and a plain scalar like
	 * `back: 04 some passage` gets number- and atom-hunted word by word. Survives the `:`
	 * and the whitespace between the key and the value, and nothing else; a new line always
	 * starts with it clear.
	 */
	afterKey?: boolean;
}

/** Any Chapbook modifier line — `[note]`, `[if x]` — but never a `[[link]]`. */
export const MODIFIER_LINE = /^\s*\[(?!\[)[^\]]*\]\s*$/;

/** The one modifier that opens a scene. */
export const SCENE_MODIFIER_LINE = /^\s*\[scene\]\s*$/i;

/** Keys that are legal somewhere below the top level. */
const NESTED_KEYS: string[] = [
	...ENTITY_KEYS,
	// `frame:` still parses, so it still highlights as a key.
	...Object.keys(RETIRED_ENTITY_KEYS),
	...LINK_KEYS,
	// Camera and bubble geometry, which are not entity keys.
	'x',
	'y',
	'amount'
];

const TOP_KEYS: string[] = [...TOP_LEVEL_KEYS];

/** Beat commands, the keys that turn a beat into speech, and the ones that time it. */
const BEAT_KEYS: string[] = [
	...BEAT_COMMAND_KEYS,
	...SAY_KEYS,
	...BEAT_BODY_KEYS
];

/**
 * A value that is exactly one scalar — a number, a boolean/null, or an `@mark` — and so
 * still deserves its own style. Anything else after a key is plain text.
 */
const SCALAR_ATOM =
	/^(?:-?(?:\d+\.?\d*|\.\d+)|true|false|yes|no|null|~|@[\w-]+)\s*$/;

/** A value the tokenizer below can still read structurally: flow, quoted, or a comment. */
const STRUCTURED_VALUE = /^[{["'#]/;

/**
 * Where a trailing comment starts in a plain scalar. YAML only opens a comment after
 * whitespace, so `hi #5` is all value and `hi # 5` is value plus comment — the same rule
 * `sceneLinkTargets` strips by, and the reason this cannot simply run to end of line.
 */
const TRAILING_COMMENT = /\s#/;

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
		state.afterKey = false;

		// The next modifier closes the block. Hand the line back to the outer mode.
		if (MODIFIER_LINE.test(stream.string)) {
			state.inScene = false;
			return null;
		}
	}

	// Whitespace keeps `afterKey`: a key, its colon and the gap before the value are all
	// still "the key", and only what comes after them is the value.
	if (stream.eatSpace()) {
		return null;
	}

	if (state.afterKey) {
		if (stream.peek() === ':') {
			stream.next();
			return null;
		}

		state.afterKey = false;

		const rest = stream.string.slice(stream.pos);
		const comment = TRAILING_COMMENT.exec(rest);
		const value = comment ? rest.slice(0, comment.index) : rest;

		// A block-level value is prose unless it is a single scalar. Inside a flow map the
		// old token-by-token scan is right, because the value really is structure.
		if (
			(state.flowDepth ?? 0) === 0 &&
			!STRUCTURED_VALUE.test(value) &&
			!SCALAR_ATOM.test(value)
		) {
			// Stop at the comment rather than running to end of line, so the tokenizer's own
			// comment branch still colours it on the next step.
			stream.pos += value.length;
			return 'string';
		}
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

	// A link shorthand may be named anything the author wrote on the story map, digits
	// included (`04 foo: Elsewhere`). The lookahead is what keeps a time of day out: `12:30`
	// has no space after the colon, so it is never a key.
	const key = stream.match(/^[\w][\w. -]*(?=\s*:(\s|$))/) as
		| RegExpMatchArray
		| null;

	if (key) {
		state.afterKey = true;

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

	// Booleans, null, and `@mark` references. `~` gets its own alternative because `\b`
	// never holds after it — it is not a word character.
	if (stream.match(/^(?:(?:true|false|yes|no|null)\b|~)/) || stream.match(/^@[\w-]+/)) {
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
