/**
 * "Insert Scene" lands a skeleton that teaches the whole format, and its `links:` are a
 * worked example pointing at passages called `Next Passage` and `Other Passage`. In a
 * passage that already sits in a story, those are two errors and two names to retype.
 *
 * So the skeleton's example links are re-pointed at the links the passage ALREADY has as
 * it is inserted: forward is what this passage links to, back is what links to it. The
 * shape of the example — the flow map, the `if:`, the comment — is left alone, because it
 * is still the only place an author learns what a link may carry.
 *
 * Everything here is a pure string rewrite of the text about to be inserted. The command
 * itself lives in the story format, in another repo (see `use-last-scene.ts`), and hands
 * us nothing but the text.
 */

/** A link the author already wrote: what to call it, and where it goes. */
export interface SceneLinkSeed {
	name: string;
	to: string;
}

export interface SceneLinkSeeds {
	/** Passages this one links to, in the order they were written. */
	forward: SceneLinkSeed[];
	/** A passage that links here. Only the first, since the skeleton has one `back:`. */
	back?: string;
}

/** A whole `[[…]]`, body included. */
const LINK_RE = /\[\[(.*?)\]\]/g;

/** `http://…`, `mailto:…` — not a passage. */
const EXTERNAL_RE = /^\w+:\/\/\/?\w|^mailto:/i;

/** A `links:` entry: indent, key, the padding an aligned block uses, then the value. */
const ENTRY_RE = /^(\s+)([A-Za-z0-9_][\w .-]*?):( *)(.*)$/;

/** `to:` inside a flow map, up to the next key or the closing brace. */
const FLOW_TO_RE = /(\{\s*to:\s*)([^,}]*)/;

/**
 * Splits a shorthand value from the comment after it. YAML needs whitespace before a `#`
 * for it to start a comment, which is exactly what the skeleton has.
 */
const SHORTHAND_RE = /^([^#]*?)(\s+#.*)?$/;

/**
 * The label and target of a `[[…]]` body, in every form Twine's own parser takes:
 * `[[Target]]`, `[[text->Target]]`, `[[Target<-text]]`, `[[text|Target]]`, plus a
 * `[[Target][setter]]` suffix. Mirrors `util/parse-links`, which returns targets only —
 * the label matters here, because a scene link's name is what the player sees on it.
 */
export function linkOfBody(body: string): SceneLinkSeed {
	const setter = body.indexOf('][');
	const head = setter === -1 ? body : body.slice(0, setter);
	const arrow = head.lastIndexOf('->');

	if (arrow !== -1) {
		return {name: head.slice(0, arrow).trim(), to: head.slice(arrow + 2).trim()};
	}

	const back = head.indexOf('<-');

	if (back !== -1) {
		return {name: head.slice(back + 2).trim(), to: head.slice(0, back).trim()};
	}

	const pipe = head.lastIndexOf('|');

	if (pipe !== -1) {
		return {name: head.slice(0, pipe).trim(), to: head.slice(pipe + 1).trim()};
	}

	const to = head.trim();

	return {name: to, to};
}

/**
 * A link name as a YAML key. The structural characters have to go — a label is prose and
 * may hold anything — and a label that is nothing but structure falls back to the target,
 * which is the name a bare `[[Target]]` would have had anyway.
 */
function keyName(seed: SceneLinkSeed): string {
	const cleaned = seed.name.replace(/[:,{}[\]#"'|]/g, ' ').replace(/\s+/g, ' ').trim();

	return cleaned === '' ? seed.to : cleaned;
}

/** The links a passage's text writes, deduped by target, externals dropped. */
export function forwardLinks(text: string): SceneLinkSeed[] {
	const seeds: SceneLinkSeed[] = [];
	const seen = new Set<string>();

	LINK_RE.lastIndex = 0;

	let match: RegExpExecArray | null;

	while ((match = LINK_RE.exec(text)) !== null) {
		const seed = linkOfBody(match[1]);

		if (seed.to === '' || EXTERNAL_RE.test(seed.to) || seen.has(seed.to)) {
			continue;
		}

		seen.add(seed.to);
		seeds.push(seed);
	}

	return seeds;
}

/** What this passage links to, and the first passage that links back to it. */
export function sceneLinkSeeds(
	passageName: string,
	passageText: string,
	passages: {name: string; text: string}[]
): SceneLinkSeeds {
	const forward = forwardLinks(passageText).filter(seed => seed.to !== passageName);
	const back = passages.find(
		other =>
			other.name !== passageName &&
			forwardLinks(other.text).some(seed => seed.to === passageName)
	);

	return {back: back?.name, forward};
}

/** Where the skeleton's `links:` block is, as line indexes. */
function linksBlock(lines: string[]): {start: number; end: number} | undefined {
	const start = lines.findIndex(line => /^links:\s*$/.test(line));

	if (start === -1) {
		return undefined;
	}

	let end = start + 1;

	while (end < lines.length && (lines[end].trim() === '' || ENTRY_RE.test(lines[end]))) {
		end++;
	}

	return {end, start};
}

/** The same entry line, pointed at `to` and renamed to `name` when one is given. */
function repoint(line: string, to: string, name?: string): string {
	const match = ENTRY_RE.exec(line);

	if (!match) {
		return line;
	}

	const [, indent, key, pad, value] = match;
	// Renaming eats the alignment padding: it was lining this value up with a key that is
	// no longer there, and a longer name would push the value off the column anyway.
	const head = `${indent}${name ?? key}:`;
	const gap = name === undefined || name === key ? pad : ' ';

	if (FLOW_TO_RE.test(value)) {
		return `${head}${gap}${value.replace(FLOW_TO_RE, (_, open) => `${open}${to}`)}`;
	}

	const shorthand = SHORTHAND_RE.exec(value);

	return `${head}${gap}${to}${shorthand?.[2] ?? ''}`;
}

/**
 * The skeleton, with its example links pointed at the passage's real ones.
 *
 * The first entry becomes the first forward link and keeps everything the example was
 * teaching; further forward links follow it in the plain form. A `back:` entry takes the
 * passage that links here. Anything the passage cannot supply is left exactly as it was —
 * a worked example beats a half-rewritten one.
 */
export function prefillSceneLinks(skeleton: string, seeds: SceneLinkSeeds): string {
	if (seeds.forward.length === 0 && seeds.back === undefined) {
		return skeleton;
	}

	const lines = skeleton.split('\n');
	const block = linksBlock(lines);

	if (!block) {
		return skeleton;
	}

	const entries: number[] = [];

	for (let i = block.start + 1; i < block.end; i++) {
		if (ENTRY_RE.test(lines[i])) {
			entries.push(i);
		}
	}

	if (entries.length === 0) {
		return skeleton;
	}

	const backEntry = entries.find(i => ENTRY_RE.exec(lines[i])![2] === 'back');
	const forward = [...seeds.forward];
	const used = new Set<string>();

	for (const i of entries) {
		if (i === backEntry) {
			continue;
		}

		const seed = forward.shift();

		if (!seed) {
			break;
		}

		const name = keyName(seed);

		used.add(name);
		lines[i] = repoint(lines[i], seed.to, name);
	}

	if (backEntry !== undefined && seeds.back !== undefined) {
		lines[backEntry] = repoint(lines[backEntry], seeds.back);
		used.add('back');
	}

	// Whatever the example had no room for still belongs in the block: in a scene passage,
	// a link that is not in `links:` is not a way out at all (spec 02).
	const indent = /^(\s+)/.exec(lines[entries[0]])![1];
	const extra = forward
		.map(seed => {
			let name = keyName(seed);

			while (used.has(name)) {
				name = `${name} 2`;
			}

			used.add(name);
			return `${indent}${name}: {to: ${seed.to}}`;
		})
		.filter(Boolean);

	lines.splice(entries[entries.length - 1] + 1, 0, ...extra);

	return lines.join('\n');
}

/**
 * Watch for a scene skeleton being inserted, and rewrite its links once it has landed.
 *
 * Two steps, and not by choice. `beforeChange` sees the text but cannot alter it: the
 * passage editor's CodeMirror is CONTROLLED, and react-codemirror2 cancels every change,
 * replays it from its own mirror, and then forces the document back to the value React
 * handed down — so a `change.update()` is undone a moment later. What it CAN do is say
 * where the skeleton is about to land, which is what `finish()` then rewrites.
 *
 * `finish()` must run after the document has caught up, i.e. from the same microtask the
 * caller already uses to restore its selection. The edit carries the `+input` origin the
 * insert itself used, so CodeMirror folds the two into one undo step.
 */
export interface ScenePrefill {
	/** Rewrite the inserted skeleton, if there was one, and stop watching. */
	finish(): void;
}

/** Where a run of inserted lines ends, starting from `from`. */
function endOfInsert(
	from: CodeMirror.Position,
	lines: string[]
): CodeMirror.Position {
	const last = lines[lines.length - 1];

	return lines.length === 1
		? {ch: from.ch + last.length, line: from.line}
		: {ch: last.length, line: from.line + lines.length - 1};
}

export function interceptScenePrefill(
	editor: CodeMirror.Editor,
	seeds: SceneLinkSeeds
): ScenePrefill {
	let landing: {from: CodeMirror.Position; lines: string[]} | undefined;

	function handler(
		_: CodeMirror.Editor,
		change: CodeMirror.EditorChangeCancellable
	) {
		const text = change.text.join('\n');

		// Only the skeleton: an author pasting a scene of their own has already decided
		// where its links go.
		if (/^\[scene\]\s*$/m.test(text) && /^links:\s*$/m.test(text)) {
			landing = {from: change.from, lines: change.text};
		}
	}

	editor.on('beforeChange', handler);

	return {
		finish() {
			editor.off('beforeChange', handler);

			if (!landing) {
				return;
			}

			const {from, lines} = landing;
			const to = endOfInsert(from, lines);
			const text = lines.join('\n');

			// Anything else having moved the text in the meantime means this is no longer
			// the insert we watched, and guessing at it would corrupt the passage.
			if (editor.getRange(from, to) !== text) {
				return;
			}

			const next = prefillSceneLinks(text, seeds);

			if (next !== text) {
				editor.replaceRange(next, from, to, '+input');
			}
		}
	};
}
