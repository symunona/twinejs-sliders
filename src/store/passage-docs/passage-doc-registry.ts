/**
 * One CodeMirror `Doc` per open passage (spec 07, doc registry).
 *
 * The Doc is the model: text, history, selection, marks. A CodeMirror editor is only a
 * VIEW onto it, attached with `swapDoc` while the passage's `</>` editor is open. The scene
 * preview writes to the same Doc with no view at all, so a drag and a keystroke share one
 * undo history, and Ctrl-Z survives opening and closing the code view.
 *
 * Owns what `PassageText` used to: the debounced commit to the store, and the sync back
 * from the store when nothing local is pending (remote pull, find and replace, story undo).
 *
 * Plain class, no React: the provider in `passage-docs-context.tsx` wires it to the store.
 */

import CodeMirror from 'codemirror';

/** How long typing may run ahead of the store. The story map re-renders on each commit. */
export const COMMIT_DELAY_MS = 1000;

/**
 * Origin of a store -> Doc sync. Its own undo step, never merged into the author's typing,
 * and never mistaken for a local write: it must not schedule a commit or claim the lock.
 */
export const STORE_ORIGIN = 'store';

/**
 * The slice of `CodeMirror.Doc` the scene editor drives. Everything here works headless.
 * A later model swap (CM6, own) is a registry-local change as long as this holds.
 */
export type SceneDoc = Pick<
	LiveDoc,
	| 'addLineClass'
	| 'getCursor'
	| 'getLine'
	| 'getRange'
	| 'getValue'
	| 'historySize'
	| 'lastLine'
	| 'lineCount'
	| 'markText'
	| 'posFromIndex'
	| 'redo'
	| 'removeLineClass'
	| 'replaceRange'
	| 'setCursor'
	| 'undo'
	| 'on'
	| 'off'
>;

/**
 * `CodeMirror.Doc` as CodeMirror 5 really has it. @types files these under Editor, but they
 * are Doc methods and work headless.
 */
export interface DocEvents
	extends Pick<CodeMirror.Editor, 'addLineClass' | 'lineInfo' | 'removeLineClass'> {
	on(event: 'change', handler: DocChangeHandler): void;
	on(event: 'cursorActivity', handler: () => void): void;
	off(event: 'change', handler: DocChangeHandler): void;
	off(event: 'cursorActivity', handler: () => void): void;
}

export type LiveDoc = CodeMirror.Doc & DocEvents;

export type DocChangeHandler = (
	doc: CodeMirror.Doc,
	change: CodeMirror.EditorChange
) => void;

export interface RegistryDeps {
	/** The store's text, or undefined once the passage is gone. */
	storeText(storyId: string, passageId: string): string | undefined;
	commit(storyId: string, passageId: string, text: string): void;
	/** Soft lock: first local write. */
	claim(storyId: string, passageId: string): void;
	/** Soft lock: last release, only after a claim. */
	unclaim(storyId: string, passageId: string): void;
}

/** What a consumer holds. Stable for as long as it holds it. */
export interface PassageDoc {
	readonly storyId: string;
	readonly passageId: string;
	readonly doc: LiveDoc;
	/** The attached `</>` editor, if any. Only gestures that need pixels use it. */
	view(): CodeMirror.Editor | undefined;
	/** Text changed (any origin) or a view came or went. */
	subscribe(listener: () => void): () => void;
	/** Commit now if anything is pending. */
	flush(): void;
	/**
	 * Announce presence now (soft lock). Writes do this themselves; "take edit" must too,
	 * because the hub only knows who is in a passage through `focus`, and a steal from a
	 * client that never focused reaches nobody.
	 */
	claim(): void;
}

interface Entry extends PassageDoc {
	refs: number;
	timer?: number;
	claimed: boolean;
	/** The last text this entry handed the store, or took from it. */
	synced: string;
	views: CodeMirror.Editor[];
	listeners: Set<() => void>;
	notify(): void;
	dispose(): void;
}

function key(storyId: string, passageId: string) {
	return `${storyId}\u0000${passageId}`;
}

/**
 * The smallest replaceRange that turns `from` into `to`: common prefix and suffix kept.
 * A remote pull that changes one word must not move the caret or drop marks elsewhere.
 */
export function minimalEdit(
	from: string,
	to: string
): {start: number; end: number; text: string} | undefined {
	if (from === to) {
		return undefined;
	}

	let start = 0;
	const limit = Math.min(from.length, to.length);

	while (start < limit && from[start] === to[start]) {
		start++;
	}

	let tail = 0;

	while (
		tail < limit - start &&
		from[from.length - 1 - tail] === to[to.length - 1 - tail]
	) {
		tail++;
	}

	return {
		end: from.length - tail,
		start,
		text: to.slice(start, to.length - tail)
	};
}

export class PassageDocRegistry {
	private entries = new Map<string, Entry>();

	constructor(private deps: RegistryDeps) {}

	setDeps(deps: RegistryDeps) {
		this.deps = deps;
	}

	/** Refcounted. Every `acquire` needs exactly one `release`. */
	acquire(storyId: string, passageId: string): PassageDoc {
		const existing = this.entries.get(key(storyId, passageId));

		if (existing) {
			existing.refs++;
			return existing;
		}

		const text = this.deps.storeText(storyId, passageId) ?? '';
		const doc = new CodeMirror.Doc(text) as LiveDoc;
		const registry = this;
		const entry: Entry = {
			claim: () => this.claim(entry),
			claimed: false,
			dispose() {
				doc.off('change', handleChange);
			},
			doc,
			flush: () => this.flush(entry),
			listeners: new Set(),
			notify() {
				entry.listeners.forEach(listener => listener());
			},
			passageId,
			refs: 1,
			storyId,
			subscribe(listener) {
				entry.listeners.add(listener);

				return () => {
					entry.listeners.delete(listener);
				};
			},
			synced: text,
			view: () => entry.views[0],
			views: []
		};

		// Headless, CodeMirror delivers Doc events on a zero timeout; with a view attached,
		// at the end of the operation. Either way, read the Doc, not the change.
		function handleChange(
			_doc: CodeMirror.Doc,
			change: CodeMirror.EditorChange
		) {
			if (change.origin !== STORE_ORIGIN) {
				registry.localWrite(entry);
			}

			entry.notify();
		}

		doc.on('change', handleChange);
		this.entries.set(key(storyId, passageId), entry);

		return entry;
	}

	release(handle: PassageDoc) {
		const entry = this.entries.get(key(handle.storyId, handle.passageId));

		if (!entry || entry !== handle) {
			return;
		}

		entry.refs--;

		if (entry.refs > 0) {
			return;
		}

		this.flush(entry);
		entry.dispose();
		this.entries.delete(key(entry.storyId, entry.passageId));

		if (entry.claimed) {
			this.deps.unclaim(entry.storyId, entry.passageId);
		}
	}

	/**
	 * A view opens on this passage. Returns the Doc to `swapDoc` in: the shared one, or, if
	 * another view already holds it (CodeMirror allows one editor per Doc), a linked Doc
	 * with shared history.
	 */
	attachView(handle: PassageDoc, view: CodeMirror.Editor): CodeMirror.Doc {
		const entry = handle as Entry;
		const doc =
			entry.views.length === 0
				? entry.doc
				: entry.doc.linkedDoc({mode: entry.doc.modeOption, sharedHist: true});

		entry.views.push(view);
		entry.notify();

		return doc;
	}

	detachView(handle: PassageDoc, view: CodeMirror.Editor, doc: CodeMirror.Doc) {
		const entry = handle as Entry;

		entry.views = entry.views.filter(other => other !== view);

		if (doc !== entry.doc) {
			entry.doc.unlinkDoc(doc);
		}

		entry.notify();
	}

	/** Store moved. Pull it into every Doc with nothing local pending. */
	syncFromStore() {
		this.entries.forEach(entry => {
			if (entry.timer !== undefined) {
				return;
			}

			const text = this.deps.storeText(entry.storyId, entry.passageId);

			if (text === undefined || text === entry.synced) {
				return;
			}

			// Local text the change event has not reported yet is still pending.
			if (entry.doc.getValue() !== entry.synced) {
				return;
			}

			entry.synced = text;

			const edit = minimalEdit(entry.doc.getValue(), text);

			if (edit) {
				entry.doc.replaceRange(
					edit.text,
					entry.doc.posFromIndex(edit.start),
					entry.doc.posFromIndex(edit.end),
					STORE_ORIGIN
				);
			}
		});
	}

	/** Commit every pending entry. Route unmount, page hide. */
	flushAll() {
		this.entries.forEach(entry => this.flush(entry));
	}

	/** Test and debug only. */
	size() {
		return this.entries.size;
	}

	private claim(entry: Entry) {
		if (!entry.claimed) {
			entry.claimed = true;
			this.deps.claim(entry.storyId, entry.passageId);
		}
	}

	private localWrite(entry: Entry) {
		this.claim(entry);

		window.clearTimeout(entry.timer);
		entry.timer = window.setTimeout(() => this.flush(entry), COMMIT_DELAY_MS);
	}

	private flush(entry: Entry) {
		window.clearTimeout(entry.timer);
		entry.timer = undefined;

		// Compared, not trusted to the timer: a write made in the same tick as a release
		// has not had its (deferred) change event yet.
		const text = entry.doc.getValue();

		if (text === entry.synced) {
			return;
		}

		const stored = this.deps.storeText(entry.storyId, entry.passageId);

		// Deleted under us. Nothing to write to; an update on a missing passage throws.
		if (stored === undefined) {
			return;
		}

		entry.synced = text;

		if (stored !== text) {
			this.deps.commit(entry.storyId, entry.passageId, text);
		}
	}
}
