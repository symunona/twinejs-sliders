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
import {parseScene} from '@sliders/scene-schema';
import {AssetMeta, Character, LAYERS} from '@sliders/scene-types';
import {AssetLibrary, useAssetLibrary} from '../sliders-assets/asset-store-context';
import {noteNameUsed, orderByRecent} from '../../util/sliders-recent-names';

/**
 * Every effect the DOM renderer knows how to draw, from
 * `packages/render-dom/src/styles.ts`. Not author-extensible, so a literal list
 * is the whole truth.
 */
export const FX_IDS = ['cold', 'dark', 'flash', 'rain', 'warm'];

/** What the cursor is sitting in, and therefore what to offer. */
export type HintSlot =
	| {kind: 'bg'}
	| {kind: 'passage'}
	| {kind: 'cast'}
	| {kind: 'props'}
	| {kind: 'frame'; entity: string}
	| {kind: 'layer'}
	| {kind: 'fx'};

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
	 * the name -- `mira` becomes `mira: {at: 0, layer: mid}`.
	 *
	 * Only for an entity id in KEY position, and only when the rest of the line
	 * is still empty. `ref: mi` wants the bare name, and an id being edited in a
	 * line that already has `: {…}` after it would end up with two of them.
	 */
	scaffold: boolean;
	/** Written after the picked name, to close a `[[link` the author left open. */
	suffix?: string;
}

/**
 * What an entity gets prefilled with. `at` and `layer` are the two knobs almost
 * every entity ends up setting, and writing them out beats remembering the key
 * names -- `at: 0` is centre stage with the feet on the layer baseline, `mid` is
 * the layer an entity would have defaulted to anyway (scene-core's `stage.ts`).
 *
 * Split so the caller can put the cursor on the value instead of after it.
 */
const ENTITY_PREFIX = ': {at: ';
const ENTITY_AT = '0';
const ENTITY_SUFFIX = ', layer: mid}';

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

	const keyPart = head.slice(0, -1);
	const boundary = Math.max(
		keyPart.lastIndexOf('{'),
		keyPart.lastIndexOf('['),
		keyPart.lastIndexOf(',')
	);

	// A beat is a list item, so `- fx: rain` has to yield `fx`, not `- fx`. Only
	// a dash followed by space is a list marker; a name may start with one.
	return keyPart.slice(boundary + 1).replace(/^\s*-\s+/, '').trim() || undefined;
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
	const key = valueKey(line, start);
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

	if (key !== undefined) {
		switch (key) {
			case 'bg':
				return found({kind: 'bg'});

			case 'layer':
				return found({kind: 'layer'});

			case 'fx':
				return found({kind: 'fx'});

			case 'frame': {
				const entity = entityOfLine(lines, blockStart, cursor.line);

				return entity ? found({kind: 'frame', entity}) : undefined;
			}

			// `to:` is a link target, which is a passage name. Nothing else in the
			// subset uses the key, so the enclosing links: block need not be found --
			// flow form (`links: {stay: {to: X}}`) included.
			case 'to':
				return found({kind: 'passage'});

			case 'ref': {
				// `ref:` names a character under `cast:` and an asset under
				// `props:`, so the block the entity lives in decides.
				const section = enclosingKeys(lines, blockStart, cursor.line).find(
					one => one === 'cast' || one === 'props'
				);

				return section === 'cast' || section === 'props'
					? found({kind: section})
					: undefined;
			}

			default:
				return undefined;
		}
	}

	// Key position: the enclosing block decides what names belong here.

	switch (enclosingKeys(lines, blockStart, cursor.line)[0]) {
		case 'cast':
			return found({kind: 'cast'}, true);

		case 'props':
			return found({kind: 'props'}, true);

		case 'fx':
			return found({kind: 'fx'});

		default:
			return undefined;
	}
}

/** MRU bucket for a slot. Frames are per-character; the rest are app-wide. */
function slotKey(slot: HintSlot): string {
	return slot.kind === 'frame' ? `frame:${slot.entity}` : slot.kind;
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
	passages: string[]
): string[] {
	switch (slot.kind) {
		case 'bg':
			return assetNames(all, ['bg']);

		case 'passage':
			return [...passages].sort((a, b) => a.localeCompare(b));

		case 'props':
			return assetNames(all, ['object', 'fx']);

		case 'cast':
			return characters.map(character => character.id).sort();

		case 'layer':
			return [...LAYERS];

		case 'fx':
			return [...FX_IDS];

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

	const {end, needsSpace, scaffold, slot, start, suffix, typed} = context;
	const candidate = typed.toLowerCase();
	const all = namesForSlot(
		slot,
		library.all,
		library.characters,
		block ? entityRefs(block.text) : new Map(),
		passages
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
		to: {ch: end, line: cursor.line},
		list: orderByRecent(names, bucket).map(({name, recent}) => ({
			className: recent ? 'sliders-hint-recent' : undefined,
			// The name is what shows and what gets remembered; `text` is only
			// what lands in the document, scaffold and spaces and all.
			displayText: name,
			hint: scaffold ? insertEntity(name) : undefined,
			text: scaffold
				? `${name}${ENTITY_PREFIX}${ENTITY_AT}${ENTITY_SUFFIX}`
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

	return React.useCallback((editor: Editor) => {
		const complete = () =>
			sceneCompletion(editor, libraryRef.current, passagesRef.current);
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
