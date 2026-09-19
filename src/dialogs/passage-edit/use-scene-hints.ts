/**
 * Autocomplete for the `[scene]` block: asset names, character ids, frames,
 * layers and effects, pulled from the live asset library.
 *
 * Why this is possible at all: scene YAML refers to assets by NAME, not by id
 * (see `scene-preview/use-preview-resolver.ts`), so the string the library
 * already holds is exactly the string the author needs typed.
 *
 * Fires on Ctrl-Space only, inside a `[scene]` block or inside a `[[link]]`
 * anywhere in the passage -- plain prose has no names to offer, and popping a
 * dropdown there would be noise. Typing `[[` or `->` still opens the passage
 * completion in `store/use-codemirror-passage-hints.ts` by itself.
 */

import CodeMirror, {Editor} from 'codemirror';
import * as React from 'react';
import {extractSceneBlock} from '@sliders/scene-index';
import {
	BEAT_BODY_KEYS,
	BEAT_COMMAND_KEYS,
	BG_KEYS,
	BOX_KEYS,
	CAMERA_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	LINK_ENTITY_KEYS,
	SAY_KEYS,
	TOP_LEVEL_KEYS,
	parseScene,
	sceneLinkTargets
} from '@sliders/scene-schema';
import {
	AssetMeta,
	BG_MOTIONS,
	BUBBLE_ANCHORS,
	BUBBLE_KEYS,
	BUBBLE_PLACES,
	BUBBLE_PRESETS,
	BUBBLE_SHAPES,
	BUBBLE_SIZINGS,
	Character,
	EASE_KINDS,
	EASE_NAMES,
	FRAME_LOOPS,
	LAYERS
} from '@sliders/scene-types';
import {AssetLibrary, useAssetLibrary} from '../sliders-assets/asset-store-context';
import {noteNameUsed, orderByRecent} from '../../util/sliders-recent-names';

/**
 * Every effect the DOM renderer knows how to draw, from
 * `packages/render-dom/src/styles.ts`. Not author-extensible, so a literal list
 * is the whole truth.
 */
export const FX_IDS = ['cold', 'dark', 'flash', 'rain', 'warm'];

/**
 * Glow colours `packages/render-dom/src/styles.ts` ships for `highlight:`.
 *
 * A SUGGESTION, not the whole truth — unlike `FX_IDS`, any CSS colour works and any other
 * token reaches `data-highlight` for the story's own stylesheet. Offering the built-in ones
 * is what tells an author the key takes a word at all.
 */
export const HIGHLIGHT_TOKENS = ['gold', 'danger', 'cold', 'warm'];

/** Beat keys that are commands rather than a speaker, offered after the cast. */
const BEAT_COMMAND_NAMES = [...BEAT_COMMAND_KEYS];

/**
 * Command beats whose value is a scalar and nothing else: `- wait: 1`, `- fx: rain`,
 * `- mark: here`. They have no body map, so there are no keys to offer inside one --
 * `box:` is the only command that takes a map.
 */
const SCALAR_BEAT_COMMANDS: readonly string[] = ['wait', 'fx', 'sfx', 'mark'];

/** What the cursor is sitting in, and therefore what to offer. */
export type HintSlot =
	| {kind: 'bg'}
	| {kind: 'passage'}
	| {kind: 'cast'}
	| {kind: 'props'}
	| {kind: 'entities'}
	| {kind: 'frame'; entity: string}
	| {kind: 'layer'}
	/** `frameLoop:` — how an animated `frame:` list ends. */
	| {kind: 'frameLoop'}
	| {kind: 'fx'}
	/** `music:` / `sfx:` — a sound asset's name. Both take the same list. */
	| {kind: 'sound'}
	/** `fx:` INSIDE a `bg:` map — a backdrop motion, not a stage effect. */
	| {kind: 'bgFx'}
	/** `ease:` — a curve, by preset name. */
	| {kind: 'ease'}
	/** A beat's own key: who speaks this line. */
	| {kind: 'speaker'}
	/** `as:` — a bubble style token. */
	| {kind: 'style'}
	/** `place:` — where the bubble sits. */
	| {kind: 'place'}
	| {kind: 'bubbleAnchor'}
	| {kind: 'sizing'}
	/**
	 * An entity's `link:`. The scene's own `links:` entry names lead, then every passage —
	 * naming an entry is the spelling that inherits its `if:`, so it is the one worth
	 * offering first.
	 */
	| {kind: 'linkTarget'; links: readonly string[]}
	/** `highlight:` — a glow colour the renderer ships, or any token the story paints. */
	| {kind: 'highlight'}
	/**
	 * Key position in a map whose schema is known: the scene root, an entity, a
	 * `bubble:`, a link. `id` only names the MRU bucket.
	 */
	| {kind: 'keys'; id: string; names: readonly string[]};

export interface SceneHintContext {
	slot: HintSlot;
	/** What the author has typed so far, used to filter. */
	typed: string;
	/** Column where the completion starts replacing. */
	start: number;
	/**
	 * Column where it stops replacing, which is the END of the name the cursor is in and
	 * not the cursor itself. Standing anywhere in `tavern-night` and picking `street`
	 * overwrites the whole thing, spaces and all -- an author asking for the list on a
	 * name they already wrote is asking to change it, not to graft one onto the other.
	 */
	end: number;
	/**
	 * True when the cursor sits directly on the colon, with no space yet. YAML
	 * reads `bg:tavern` as the plain scalar "bg:tavern" rather than a mapping,
	 * so the completion has to bring its own space.
	 */
	needsSpace: boolean;
	/**
	 * True when picking a name should write a whole entity line rather than just
	 * the name -- `mira` becomes `mira: {at: 0}`.
	 *
	 * Only for an entity id in KEY position, and only when the rest of the line
	 * is still empty. `ref: mi` wants the bare name, and an id being edited in a
	 * line that already has `: {…}` after it would end up with two of them.
	 */
	scaffold: boolean;
	/** Written after the picked name, to close a `[[link` the author left open. */
	suffix?: string;
	/**
	 * Set when the line has no map to put a key in yet, and picking one has to
	 * rewrite the value into a flow map: `- mira: "Hello."` becomes
	 * `- mira: {say: "Hello.", dur: }`.
	 *
	 * The range `from`..`to` is the whole value, and the pick writes
	 * `before + name + ': ' + after` over it, leaving the cursor between the two.
	 * Kept as plain text rather than a rewritten YAML document because the
	 * author's own spacing, quoting and comments have to survive a completion.
	 */
	promote?: {after: string; before: string; from: number; to: number};
}

/**
 * What an entity gets prefilled with. `at` is the one knob almost every entity ends up
 * setting, and writing it out beats remembering the key name -- `at: 0` is centre stage
 * with the feet on the stage baseline.
 *
 * `layer: mid` used to ride along. It was already only the default written out longhand,
 * and now that `layer:` is sugar for a `z` seed with no seed for `mid`, it writes nothing
 * at all -- so it is noise in a file people hand-edit.
 *
 * Split so the caller can put the cursor on the value instead of after it.
 */
const ENTITY_PREFIX = ': {at: ';
const ENTITY_AT = '0';
const ENTITY_SUFFIX = '}';

/**
 * What ends a name, scanning outward from the cursor. Everything else belongs to it --
 * INCLUDING spaces, because an asset called `oak table` and a passage called `Tavern
 * Fight` are both one name. YAML structure and quotes are the boundaries; a list dash is
 * stripped afterwards, since a name may legitimately contain one (`tavern-night`).
 */
const TOKEN_STOP = /[:,{}[\]#"']/;

/** `key:` on a line, with an optional list dash: `mira:`, `- mira:`, `cast:`. */
const KEY_LINE_RE = /^\s*(?:-\s*)?([A-Za-z0-9_][\w .-]*?)\s*:\s*(.*)$/;

/** An entity written as a flow map on one line: `mira: {at: -0.4}`. */
const FLOW_OWNER_RE = /^\s*(?:-\s*)?([A-Za-z0-9_][\w .-]*?)\s*:\s*\{/;

function indentOf(line: string): number {
	return /^[ \t]*/.exec(line)![0].length;
}

/**
 * The whole name the cursor sits in: where it starts, where it ends, and what has been
 * typed up to the cursor. `end` never falls before the cursor, so trailing spaces the
 * author is still typing in do not shrink the range out from under them.
 */
function tokenAround(
	line: string,
	ch: number
): {start: number; end: number; text: string; typed: string} {
	let start = Math.min(ch, line.length);
	let end = start;

	while (start > 0 && !TOKEN_STOP.test(line[start - 1])) {
		start--;
	}

	while (end < line.length && !TOKEN_STOP.test(line[end])) {
		end++;
	}

	// `- mira` is a name behind a list marker, not a name starting with a dash.
	const marker = /^\s*-\s+/.exec(line.slice(start, end));

	if (marker) {
		start += marker[0].length;
	}

	start += /^\s*/.exec(line.slice(start, end))![0].length;
	start = Math.min(start, ch);
	end = Math.max(ch, end - /\s*$/.exec(line.slice(start, end))![0].length);

	return {end, start, text: line.slice(start, end), typed: line.slice(start, ch)};
}

/**
 * The innermost key in text that runs up to (but not including) a colon or an
 * opening brace. A beat is a list item, so `- fx` has to yield `fx`; only a dash
 * followed by space is a list marker, since a name may start with one.
 */
function innerKey(keyPart: string): string | undefined {
	const boundary = Math.max(
		keyPart.lastIndexOf('{'),
		keyPart.lastIndexOf('['),
		keyPart.lastIndexOf(',')
	);

	return keyPart.slice(boundary + 1).replace(/^\s*-\s+/, '').trim() || undefined;
}

/**
 * The key whose VALUE the cursor is in, or undefined when the cursor is in key
 * position. Understands both `bg: tav` and the flow form
 * `mira: {at: -0.4, frame: ar`, where the innermost key is what matters.
 */
function valueKey(before: string, tokenStart: number): string | undefined {
	// Drop the token being typed, then the whitespace and any container opener
	// between it and the colon. A list dash is NOT an opener -- `- mira` is a
	// key, not a value, and stripping the dash would misread it as one.

	const head = before.slice(0, tokenStart).replace(/[\s[{,]+$/, '');

	if (!head.endsWith(':')) {
		return undefined;
	}

	return innerKey(head.slice(0, -1));
}

/**
 * Where the cursor sits among the flow containers still open on this line:
 * `owners` is the key each unclosed `{`/`[` hangs off, innermost first, and
 * `keyPosition` is true when the innermost one is a `{` with no `:` typed since
 * its last separator -- which is exactly the moment an author wants to be told
 * what keys the map accepts.
 *
 * `valueKey()` cannot answer this on its own: it strips a trailing `{` before
 * looking for the colon, so `mira: {` and `mira: tav` look identical to it.
 */
function flowContext(head: string): {
	/** How many `{`/`[` are still open, which is zero on a plain block line. */
	depth: number;
	keyPosition: boolean;
	owners: string[];
} {
	const stack: {inValue: boolean; opener: string; owner?: string}[] = [];

	for (let i = 0; i < head.length; i++) {
		const char = head[i];

		if (char === '"' || char === "'") {
			// A quoted scalar can hold anything, braces included.
			const close = head.indexOf(char, i + 1);

			i = close === -1 ? head.length : close;
		} else if (char === '{' || char === '[') {
			stack.push({inValue: false, opener: char, owner: ownerBefore(head, i)});
		} else if (char === '}' || char === ']') {
			stack.pop();
		} else if (char === ',') {
			if (stack.length > 0) {
				stack[stack.length - 1].inValue = false;
			}
		} else if (char === ':') {
			if (stack.length > 0) {
				stack[stack.length - 1].inValue = true;
			}
		}
	}

	const top = stack[stack.length - 1];

	return {
		depth: stack.length,
		keyPosition: top !== undefined && top.opener === '{' && !top.inValue,
		owners: stack
			.map(level => level.owner)
			.filter((owner): owner is string => owner !== undefined)
			.reverse()
	};
}

/** The key a flow container at `open` hangs off, if it hangs off one at all. */
function ownerBefore(head: string, open: number): string | undefined {
	const before = head.slice(0, open).replace(/\s+$/, '');

	return before.endsWith(':') ? innerKey(before.slice(0, -1)) : undefined;
}

/**
 * The `key:` lines enclosing a line, innermost first. Walking the whole chain
 * rather than stopping at the first one is what lets `ref:` find the `cast:` it
 * sits two levels below.
 */
function enclosingKeys(
	lines: string[],
	blockStart: number,
	lineNo: number
): string[] {
	const chain: string[] = [];
	let indent = indentOf(lines[lineNo]);

	for (let i = lineNo - 1; i >= blockStart && indent > 0; i--) {
		if (lines[i].trim() === '') {
			continue;
		}

		const lineIndent = indentOf(lines[i]);

		if (lineIndent < indent) {
			const key = KEY_LINE_RE.exec(lines[i])?.[1].trim();

			if (key) {
				chain.push(key);
			}

			indent = lineIndent;
		}
	}

	return chain;
}

/**
 * What may be written in KEY position, given the chain of keys enclosing the
 * cursor innermost-first. An empty chain is the scene root.
 *
 * The chain is the flow containers still open on the line followed by the block
 * keys above it, so `- mira: {bubble: {` and a `bubble:` written out over three
 * indented lines reach the same answer.
 */
function keySlotFor(chain: string[]): HintSlot | undefined {
	const [owner, parent] = chain;
	const keys = (id: string, names: readonly string[]): HintSlot => ({
		id,
		kind: 'keys',
		names
	});

	switch (owner) {
		case undefined:
			return keys('top', TOP_LEVEL_KEYS);

		case 'bg':
			return keys('bg', BG_KEYS);

		// An entity's `link:` written long: `link: {to: Cellar, if: has_key}`. Not the
		// `links:` block's own keys — a door has no icon and no transition of its own.
		case 'link':
			return keys('entityLink', LINK_ENTITY_KEYS);

		// An `ease:` map is keyed by WHAT is moving, not by an entity key. Its members
		// collide with real keys elsewhere in the subset (`bg`, `fx`, `frame`, `music`),
		// which is why the value side below has to ask who owns the line before it
		// decides what a key like `bg:` wants.
		case 'ease':
			return keys('ease', EASE_KINDS);

		case 'bubble':
			return keys('bubble', BUBBLE_KEYS);

		case 'box':
			return keys('box', BOX_KEYS);

		case 'camera':
			return keys('camera', CAMERA_KEYS);

		case 'cast':
			return {kind: 'cast'};

		case 'props':
			return {kind: 'props'};

		case 'entities':
			return {kind: 'entities'};

		case 'fx':
			return {kind: 'fx'};

		// A link's key is its own name, which only the author knows.
		case 'links':
			return undefined;
	}

	// Anything else in key position is an id -- an entity, or a link -- and what
	// it accepts depends on the block it was declared in.

	switch (parent) {
		case 'links':
			return keys('link', LINK_KEYS);

		case 'cast':
		case 'props':
		case 'entities':
			return keys('entity', ENTITY_KEYS);

		// A beat is an entity patch that may also speak, and may time itself --
		// unless it is one of the commands whose whole value is a scalar, which
		// has no body to hold a key at all.
		case 'beats':
			return SCALAR_BEAT_COMMANDS.includes(owner)
				? undefined
				: keys('beat', [...ENTITY_KEYS, ...SAY_KEYS, ...BEAT_BODY_KEYS]);

		default:
			return undefined;
	}
}

/**
 * The keys a line could be GIVEN, for a line that has nowhere to put one yet.
 *
 * `- mira: "Hello."` is a whole beat with no map in it, so key position never
 * happens on it and Ctrl-Space had nothing to say -- the author had to know that
 * the long form is `{say: "Hello.", dur: 0.4}` and rewrite the line by hand
 * before the completion would help. Offering the keys here and doing that
 * rewrite on the pick is the difference between the schema being discoverable
 * and being documentation.
 *
 * Three shapes, all at the end of a line and all outside any open flow
 * container, since inside one the ordinary key-position path already works:
 *
 * - `- mira:`          -> `- mira: {dur: }`
 * - `- mira: "Hello."` -> `- mira: {say: "Hello.", dur: }`
 * - `- mira: {at: 0}`  -> `- mira: {at: 0, dur: }`
 *
 * Which keys those are is `keySlotFor()`'s answer, so this works for a `cast:`
 * entry or a link as well as for a beat; only the scalar form is beat-specific,
 * because `say` and `box`'s `text` are the only shorthands the subset has.
 */
function promotionContext(
	lines: string[],
	blockStart: number,
	cursor: {ch: number; line: number}
): SceneHintContext | undefined {
	const line = lines[cursor.line] ?? '';

	// A cursor inside the value is editing it, not adding beside it.
	if (
		line.slice(cursor.ch).trim() !== '' ||
		flowContext(line.slice(0, cursor.ch)).depth > 0
	) {
		return undefined;
	}

	const match = KEY_LINE_RE.exec(line);

	if (!match) {
		return undefined;
	}

	const key = match[1].trim();
	const chain = [key, ...enclosingKeys(lines, blockStart, cursor.line)];
	const slot = keySlotFor(chain);

	if (slot?.kind !== 'keys') {
		return undefined;
	}

	const value = match[2].trim();
	const valueStart = line.length - match[2].length;
	const from = line.lastIndexOf(':', valueStart) + 1;
	let before: string;

	if (value === '') {
		before = ' {';
	} else if (value.startsWith('{') && value.endsWith('}')) {
		const inner = value.slice(1, -1);

		before = ` {${inner}${inner.trim() === '' ? '' : ', '}`;
	} else {
		// A scalar only has a key to become in a beat: `- mira: "hi"` is
		// `say`, `- box: "hi"` is `text`. Nothing else in the subset writes one.
		const scalarKey =
			chain[1] === 'beats' ? (key === 'box' ? 'text' : 'say') : undefined;

		// A trailing comment would end up inside the braces, commenting out the
		// closing one. Rare enough to decline rather than reflow.
		if (scalarKey === undefined || /(?:^|\s)#/.test(value)) {
			return undefined;
		}

		before = ` {${scalarKey}: ${value}, `;
	}

	return {
		end: cursor.ch,
		needsSpace: false,
		promote: {after: '}', before, from, to: line.length},
		scaffold: false,
		slot,
		start: cursor.ch,
		typed: ''
	};
}

/**
 * Which entity a `frame:` belongs to. The flow form puts it on the same line
 * (`mira: {frame: angry}`); the block form makes it the enclosing key.
 */
function entityOfLine(
	lines: string[],
	blockStart: number,
	lineNo: number
): string | undefined {
	return (
		FLOW_OWNER_RE.exec(lines[lineNo])?.[1].trim() ??
		enclosingKeys(lines, blockStart, lineNo)[0]
	);
}

/**
 * The cursor inside a `[[…]]`, if it is, and the part of it that names a passage.
 *
 * Runs on the raw line, in or out of the scene block, because a link is a link wherever
 * it is written: in beat text, in the prose under the block, in a passage with no scene at
 * all. Only the TARGET half offers anything -- the label half of `[[stay -> Street]]` is
 * the author's own words.
 */
export function wikiLinkContext(
	line: string,
	ch: number
): SceneHintContext | undefined {
	const open = line.lastIndexOf('[[', ch);

	if (open === -1) {
		return undefined;
	}

	const close = line.indexOf(']]', open + 2);

	// Past the closing brackets is outside the link, not at the end of it.
	if (close !== -1 && ch > close) {
		return undefined;
	}

	const bodyStart = open + 2;
	const bodyEnd = close === -1 ? line.length : close;

	if (ch < bodyStart) {
		return undefined;
	}

	const body = line.slice(bodyStart, bodyEnd);
	// `[[Target][setter]]` — the setter is code, and never a passage name.
	const setter = body.indexOf('][');
	const head = setter === -1 ? body : body.slice(0, setter);
	const arrow = head.lastIndexOf('->');
	const back = head.indexOf('<-');
	const pipe = head.lastIndexOf('|');

	let from = 0;
	let to = head.length;

	if (arrow !== -1) {
		from = arrow + 2;
	} else if (back !== -1) {
		to = back;
	} else if (pipe !== -1) {
		from = pipe + 1;
	}

	const offset = ch - bodyStart;

	if (offset < from || offset > to) {
		return undefined; // The label half.
	}

	const target = head.slice(from, to);
	const lead = /^\s*/.exec(target)![0].length;
	const trail = /\s*$/.exec(target)![0].length;
	const start = Math.min(bodyStart + from + lead, ch);
	const end = Math.max(ch, bodyStart + to - trail);

	return {
		end,
		needsSpace: false,
		scaffold: false,
		slot: {kind: 'passage'},
		start,
		// An unterminated link gets its brackets closed for it, the same way typing
		// `[[` and picking from the dropdown already does.
		suffix: close === -1 ? ']]' : undefined,
		typed: line.slice(start, ch)
	};
}

/**
 * Classifies the cursor position. `lines` is the whole passage, so line numbers
 * line up with CodeMirror's.
 */
export function sceneHintContext(
	lines: string[],
	blockStart: number,
	blockEnd: number,
	cursor: {ch: number; line: number}
): SceneHintContext | undefined {
	if (cursor.line < blockStart || cursor.line >= blockEnd) {
		return undefined;
	}

	const line = lines[cursor.line] ?? '';
	const {end, start, typed} = tokenAround(line, cursor.ch);
	const flow = flowContext(line.slice(0, start));
	const key = flow.keyPosition ? undefined : valueKey(line, start);
	// Measured past the END of the name, not past the cursor: `mi|ra` on its own line is
	// still an author writing one entity, and should still get a body written for it.
	const restIsEmpty = line.slice(end).trim() === '';
	const found = (slot: HintSlot, scaffold = false): SceneHintContext => ({
		end,
		needsSpace: key !== undefined && line.slice(0, start).endsWith(':'),
		scaffold: scaffold && restIsEmpty,
		slot,
		start,
		typed
	});

	// A line whose value is already written has no key position on it, so the
	// keys it could still be given are offered instead -- but only once the
	// value itself has nothing to complete.
	const promote = () => promotionContext(lines, blockStart, cursor);

	if (key !== undefined) {
		// The key alone is not always enough: `fx:` is a stage effect at the top of a scene
		// and a backdrop MOTION inside a `bg:` map, and `id:` names whatever map it is in.
		const owner = (): string | undefined =>
			[...flow.owners, ...enclosingKeys(lines, blockStart, cursor.line)][0];

		const valueHint = ((): SceneHintContext | undefined => {
			// Before the switch, and the only slot that has to be: inside an `ease:` map
			// EVERY key is a transition kind and every value is a curve, and four of those
			// kinds (`bg`, `fx`, `frame`, `music`) are keys that mean something else one
			// level out. Asking the key first would offer backdrop names for `ease: {bg: }`.
			if (owner() === 'ease') {
				return found({kind: 'ease'});
			}

			switch (key) {
				case 'ease':
					return found({kind: 'ease'});

				case 'bg':
					return found({kind: 'bg'});

				case 'id':
					// The scene's own `id:` is a name only the author knows; inside a map it
					// is that map's asset.
					return owner() === 'bg'
						? found({kind: 'bg'})
						: owner() === 'music' || owner() === 'sfx'
						? found({kind: 'sound'})
						: undefined;

				case 'layer':
					return found({kind: 'layer'});

				case 'frameLoop':
					return found({kind: 'frameLoop'});

				case 'fx':
					return found(owner() === 'bg' ? {kind: 'bgFx'} : {kind: 'fx'});

				case 'music':
				case 'sfx':
					return found({kind: 'sound'});

				case 'frame': {
					const entity = entityOfLine(lines, blockStart, cursor.line);

					return entity ? found({kind: 'frame', entity}) : undefined;
				}

				// `to:` is a link target, which is a passage name. Nothing else in the
				// subset uses the key, so the enclosing links: block need not be found --
				// flow form (`links: {stay: {to: X}}`) included.
				case 'to':
					return found({kind: 'passage'});

				// A link value is a passage OR one of this scene's own link names, and the
				// scene is right here in the buffer — so the names are scanned rather than
				// threaded through from the parse, which is debounced and may be stale by
				// exactly the entry the author just typed.
				case 'link':
					return found({
						kind: 'linkTarget',
						links: [...sceneLinkTargets(lines.slice(blockStart).join('\n')).keys()]
					});

				case 'highlight':
					return found({kind: 'highlight'});

				case 'as':
					return found({kind: 'style'});

				case 'place':
					return found({kind: 'place'});

				// Both only exist inside a bubble: map, and neither word is a key
				// anywhere else in the subset, so no chain walk is needed.
				case 'anchor':
					return found({kind: 'bubbleAnchor'});

				case 'sizing':
					return found({kind: 'sizing'});

				case 'ref': {
					// `ref:` names a character under `cast:` and an asset under
					// `props:`, so the block the entity lives in decides.
					const section = enclosingKeys(lines, blockStart, cursor.line).find(
						one => one === 'cast' || one === 'props' || one === 'entities'
					);

					return section === 'cast' ||
						section === 'props' ||
						section === 'entities'
						? found({kind: section})
						: undefined;
				}

				// Shorthand `back: Street`. The key is the link's own NAME, so it says
				// nothing; the enclosing `links:` -- block form above, flow form on the
				// same line -- is what makes the value a passage target.
				default:
					return enclosingKeys(lines, blockStart, cursor.line)[0] === 'links' ||
						/(?:^|[\s[{,])links\s*:/.test(line.slice(0, start))
						? found({kind: 'passage'})
						: undefined;
			}
		})();

		return valueHint ?? promote();
	}

	// Key position: the enclosing block decides what names belong here.

	const chain = [
		...flow.owners,
		...enclosingKeys(lines, blockStart, cursor.line)
	];

	// A beat's key is its speaker, so the cast on stage is what belongs here — but only in
	// key position. Beat text is prose, and a `[[link]]` written inside it must still be
	// the link completion's business, not a list of characters.
	if (chain[0] === 'beats') {
		return /^\s*(?:-\s*)?$/.test(line.slice(0, start))
			? found({kind: 'speaker'}, true)
			: promote();
	}

	const slot = keySlotFor(chain);

	if (!slot) {
		return promote();
	}

	// At the end of a line that already declares an entity, a key belongs to that
	// entity: `mira: {at: 0}` wants `scale` next, not a second id glued onto the
	// same line, which would not even be YAML.
	return (
		promote() ??
		found(
			slot,
			slot.kind === 'cast' || slot.kind === 'props' || slot.kind === 'entities'
		)
	);
}

/** MRU bucket for a slot. Frames are per-character; the rest are app-wide. */
function slotKey(slot: HintSlot): string {
	switch (slot.kind) {
		case 'frame':
			return `frame:${slot.entity}`;

		case 'keys':
			return `keys:${slot.id}`;

		default:
			return slot.kind;
	}
}

/**
 * Asset names, with `preferred` kinds first. Character frames are left out --
 * they are reached through a character's `frame:`, never named directly.
 */
function assetNames(all: AssetMeta[], preferred: string[]): string[] {
	const rank = (asset: AssetMeta) => {
		const index = preferred.indexOf(asset.kind);

		return index === -1 ? preferred.length : index;
	};

	return all
		.filter(asset => !asset.ownerCharacter)
		.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name))
		.map(asset => asset.name);
}

/**
 * The names offered for a slot, in the order they should appear before recent
 * ones are lifted out. `refs` maps an entity id to what it refers to, since
 * `mira: {ref: villager}` means the frames come from `villager`.
 */
function namesForSlot(
	slot: HintSlot,
	all: AssetMeta[],
	characters: Character[],
	refs: Map<string, string>,
	passages: string[],
	/** Entity ids this scene declares, in the order it declares them. */
	sceneIds: string[] = []
): string[] {
	switch (slot.kind) {
		// Schema order, not alphabetical: the arrays read the way the docs do.
		case 'keys':
			return [...slot.names];

		case 'bg':
			return assetNames(all, ['bg']);

		case 'passage':
			return [...passages].sort((a, b) => a.localeCompare(b));

		case 'linkTarget':
			return [
				...slot.links,
				...[...passages]
					.filter(name => !slot.links.includes(name))
					.sort((a, b) => a.localeCompare(b))
			];

		case 'highlight':
			return [...HIGHLIGHT_TOKENS];

		case 'props':
			return assetNames(all, ['object', 'fx']);

		case 'cast':
			return characters.map(character => character.id).sort();

		// `entities:` declares no kind, so both vocabularies are on offer. Characters
		// lead because that is the order the resolver tries them in.
		case 'entities':
			return [
				...characters.map(character => character.id).sort(),
				...assetNames(all, ['object', 'fx'])
			];

		case 'layer':
			return [...LAYERS];

		case 'frameLoop':
			return [...FRAME_LOOPS];

		/**
		 * Whoever is on stage, then the rest of the cast, then the commands.
		 *
		 * On-stage ids lead because a beat almost always belongs to someone already in the
		 * scene; the wider cast follows for the narrator or the voice from off stage, who
		 * are spoken by characters that were never given an entity.
		 */
		case 'speaker': {
			const known = new Set(sceneIds);

			return [
				...sceneIds,
				...characters
					.map(character => character.id)
					.filter(id => !known.has(id))
					.sort(),
				...BEAT_COMMAND_NAMES
			];
		}

		// Drawn shapes first: they are the styles that change what a bubble IS, and a
		// list that opened with seven weights of text would bury them.
		case 'style':
			return [...BUBBLE_SHAPES, ...BUBBLE_PRESETS];

		case 'place':
			return [...BUBBLE_PLACES];

		case 'bubbleAnchor':
			return [...BUBBLE_ANCHORS];

		case 'sizing':
			return [...BUBBLE_SIZINGS];

		case 'fx':
			return [...FX_IDS];

		/**
		 * Backdrop motions: the presets the renderer's own CSS paints. A closed list like
		 * `fx:` and for the same reason — these are stylesheet rules, not library art — but
		 * an unlisted token is still legal, since a story's stylesheet may define its own.
		 */
		case 'bgFx':
			return [...BG_MOTIONS];

		/**
		 * The presets the renderer ships. A closed list like `fx:` and `bgFx:`, but for the
		 * opposite reason to `bgFx:` — there is no stylesheet escape hatch here, because a
		 * timing function is written inline. A curve nobody anticipated is spelled out in
		 * full (`cubic-bezier(…)`), which no list could offer anyway.
		 */
		case 'ease':
			return [...EASE_NAMES];

		/**
		 * Sounds ONLY, where every other asset slot ranks its preferred kinds first and
		 * still lists the rest. A backdrop's name in `sfx:` is not an unusual choice, it is
		 * a mistake with no sound at the end of it — there is nothing to play. `fx:` is the
		 * other closed list, for the opposite reason: those ids are the renderer's CSS.
		 */
		case 'sound':
			return all
				.filter(asset => asset.kind === 'sound')
				.map(asset => asset.name)
				.sort((a, b) => a.localeCompare(b));

		case 'frame': {
			// An entity id IS its ref unless `ref:` overrides it -- the parser
			// does `ref: body.ref ?? id`.
			const ref = refs.get(slot.entity) ?? slot.entity;
			const character = characters.find(one => one.id === ref);

			return character ? Object.keys(character.frames).sort() : [];
		}
	}
}

/** Entity id -> ref, read from the block as it currently stands. */
function entityRefs(blockText: string): Map<string, string> {
	const refs = new Map<string, string>();

	try {
		const {entities} = parseScene(blockText).scene;

		for (const [id, patch] of Object.entries(entities)) {
			if (patch) {
				refs.set(id, patch.ref);
			}
		}
	} catch (error) {
		// The parser is best-effort and shouldn't throw, but a completion popup
		// is not worth taking the editor down over.
		console.warn('Could not parse the scene while completing', error);
	}

	return refs;
}

/**
 * Writes a picked entity out in full and leaves the `at` value selected, so the
 * next thing typed replaces it instead of landing after the closing brace.
 *
 * show-hint hands the whole insertion over once an entry carries a `hint`, and
 * still signals `pick` afterwards, so the recently-used list keeps working.
 */
/**
 * What a picked beat key gets written as, with the part to type over selected.
 *
 * A speaker wants empty quotes to type the line into; the commands each want their own
 * kind of value, and `wait: 1` with the 1 selected is faster to correct than a bare colon
 * to complete by hand.
 */
const BEAT_SCAFFOLDS: Record<string, {prefix: string; value: string; suffix: string}> = {
	box: {prefix: ': "', suffix: '"', value: ''},
	fx: {prefix: ': ', suffix: '', value: 'rain'},
	mark: {prefix: ': ', suffix: '', value: 'here'},
	// No placeholder name to select: unlike `fx: rain`, whose ids ship with the renderer,
	// nobody's library is guaranteed to hold a sound called anything in particular. An empty
	// value leaves the cursor where the name goes, and the dropdown reopens there on it.
	sfx: {prefix: ': ', suffix: '', value: ''},
	wait: {prefix: ': ', suffix: '', value: '1'},
	// Same as `sfx:`: the name is the author's own art, so there is nothing to pre-select.
	bg: {prefix: ': ', suffix: '', value: ''}
};

const SAY_SCAFFOLD = {prefix: ': "', suffix: '"', value: ''};

/** Writes `name: …` and selects the value, the way `insertEntity` does for a cast entry. */
function insertBeat(name: string) {
	const shape = BEAT_SCAFFOLDS[name] ?? SAY_SCAFFOLD;

	return (
		cm: Editor,
		data: {from: CodeMirror.Position; to: CodeMirror.Position},
		completion: {from?: CodeMirror.Position; to?: CodeMirror.Position}
	) => {
		const from = completion.from ?? data.from;
		const to = completion.to ?? data.to;

		cm.replaceRange(
			`${name}${shape.prefix}${shape.value}${shape.suffix}`,
			from,
			to,
			'complete'
		);

		const valueStart = from.ch + name.length + shape.prefix.length;

		cm.setSelection(
			{ch: valueStart, line: from.line},
			{ch: valueStart + shape.value.length, line: from.line}
		);
	};
}

function beatText(name: string): string {
	const shape = BEAT_SCAFFOLDS[name] ?? SAY_SCAFFOLD;

	return `${name}${shape.prefix}${shape.value}${shape.suffix}`;
}

/**
 * Rewrites a line's value into a flow map holding the picked key, and leaves the
 * cursor where its value goes.
 *
 * The replaced range is the whole value, not the empty range the dropdown was
 * opened on, so show-hint's own `from`/`to` are ignored here on purpose.
 */
function insertPromoted(
	name: string,
	promote: NonNullable<SceneHintContext['promote']>,
	line: number
) {
	return (cm: Editor) => {
		const text = `${promote.before}${name}: ${promote.after}`;

		cm.replaceRange(
			text,
			{ch: promote.from, line},
			{ch: promote.to, line},
			'complete'
		);

		const caret = promote.from + text.length - promote.after.length;

		cm.setCursor({ch: caret, line});
	};
}

function insertEntity(name: string) {
	return (
		cm: Editor,
		data: {from: CodeMirror.Position; to: CodeMirror.Position},
		completion: {from?: CodeMirror.Position; to?: CodeMirror.Position}
	) => {
		const from = completion.from ?? data.from;
		const to = completion.to ?? data.to;

		cm.replaceRange(
			`${name}${ENTITY_PREFIX}${ENTITY_AT}${ENTITY_SUFFIX}`,
			from,
			to,
			'complete'
		);

		// Counted rather than searched for: a character called `guard0` would
		// throw off anything looking for the first `0`.
		const valueStart = from.ch + name.length + ENTITY_PREFIX.length;

		cm.setSelection(
			{ch: valueStart, line: from.line},
			{ch: valueStart + ENTITY_AT.length, line: from.line}
		);
	};
}

/**
 * Builds the completion for wherever the cursor is now, or undefined when
 * there's nothing to offer. Recomputed on every keystroke while the dropdown is
 * open, which is what narrows the list as the author types.
 *
 * Exported for tests: it needs only `getValue` and `getCursor` off the editor,
 * which is a great deal easier to drive than a mounted CodeMirror.
 */
export function sceneCompletion(
	editor: Editor,
	library: Pick<AssetLibrary, 'all' | 'characters'>,
	passages: string[] = []
) {
	const text = editor.getValue();
	const lines = text.split('\n');
	const cursor = editor.getCursor();
	const line = lines[cursor.line] ?? '';
	const block = extractSceneBlock(text);
	// A `[[link]]` is asked about first, and without needing a scene block: prose under
	// the block, and a passage with no scene in it at all, both link the same way.
	const context =
		wikiLinkContext(line, cursor.ch) ??
		(block
			? sceneHintContext(
					lines,
					block.lineOffset,
					block.lineOffset + block.text.split('\n').length,
					cursor
				)
			: undefined);

	if (!context) {
		return undefined;
	}

	const {end, needsSpace, promote, scaffold, slot, start, suffix, typed} =
		context;
	const candidate = typed.toLowerCase();
	const refs = block ? entityRefs(block.text) : new Map<string, string>();
	const all = namesForSlot(
		slot,
		library.all,
		library.characters,
		refs,
		passages,
		[...refs.keys()]
	);
	const matched = all.filter(name => name.toLowerCase().includes(candidate));
	// The whole name under the cursor, not just the part before it.
	const written = line.slice(start, end);
	// A name that is already complete is one the author asked to CHANGE, and a name that
	// matches nothing is one they got wrong. Both want the full list; only a name in the
	// middle of being typed wants it narrowed.
	const exact = all.some(name => name.toLowerCase() === written.toLowerCase());
	const names = exact || matched.length === 0 ? all : matched;

	if (names.length === 0) {
		return undefined;
	}

	const bucket = slotKey(slot);
	const completion = {
		from: {ch: start, line: cursor.line},
		// Read back by the caller, which reopens the dropdown after a key is
		// picked so the author goes straight on to its value.
		slotKind: slot.kind,
		to: {ch: end, line: cursor.line},
		list: orderByRecent(names, bucket).map(({name, recent}) => ({
			className: recent ? 'sliders-hint-recent' : undefined,
			// The name is what shows and what gets remembered; `text` is only
			// what lands in the document, scaffold and spaces and all.
			displayText: name,
			hint: promote
				? insertPromoted(name, promote, cursor.line)
				: scaffold
					? slot.kind === 'speaker'
						? insertBeat(name)
						: insertEntity(name)
					: undefined,
			text:
				// A key is only ever half a line, so it writes its own colon and
				// leaves the cursor where the value goes.
				slot.kind === 'keys'
					? `${name}: `
					: scaffold
						? slot.kind === 'speaker'
							? beatText(name)
							: `${name}${ENTITY_PREFIX}${ENTITY_AT}${ENTITY_SUFFIX}`
						: `${needsSpace ? ' ' : ''}${name}${suffix ?? ''}`
		}))
	};

	CodeMirror.on(completion, 'pick', (picked: {displayText: string}) =>
		noteNameUsed(bucket, picked.displayText)
	);

	return completion;
}

/**
 * The Ctrl-Space handler. Its identity is stable across renders on purpose: it
 * goes into the CodeMirror options object, and a changing options identity
 * would re-set every option on the editor, `prefixTrigger` included.
 */
export function useSceneHints(
	passageNames: string[] = []
): (editor: Editor) => void {
	const library = useAssetLibrary();
	const libraryRef = React.useRef(library);
	const passagesRef = React.useRef(passageNames);

	libraryRef.current = library;
	passagesRef.current = passageNames;

	return React.useCallback(function open(editor: Editor) {
		const complete = () => {
			const result = sceneCompletion(
				editor,
				libraryRef.current,
				passagesRef.current
			);

			// Picking a key writes `key: ` and stops. The value is what the author
			// came for, so offer it without a second Ctrl-Space. Deferred because
			// show-hint is still tearing the old dropdown down at pick time.
			if (result?.slotKind === 'keys') {
				CodeMirror.on(result, 'pick', () =>
					window.setTimeout(() => open(editor), 0)
				);
			}

			return result;
		};
		const opening = complete();

		if (!opening) {
			return;
		}

		// Show what a pick would overwrite. A real selection would say it better and
		// cannot be used: show-hint refuses to open over one, and closes the moment one
		// appears (`somethingSelected()` in the addon), so this is a marker instead.
		const target =
			opening.to.ch > opening.from.ch
				? editor.markText(opening.from, opening.to, {
						className: 'sliders-hint-target'
					})
				: undefined;

		if (target) {
			const clear = () => {
				target.clear();
				editor.off('endCompletion', clear);
			};

			editor.on('endCompletion', clear);
		}

		editor.showHint({completeSingle: false, hint: complete});
	}, []);
}
