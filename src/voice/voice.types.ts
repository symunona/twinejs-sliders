/**
 * The contract between a model that wants to edit a story and the editor that owns it.
 *
 * Deliberately provider-neutral. `VoiceToolDecl` is close enough to an OpenAPI subset that
 * every current function-calling API takes it after a shallow rename, and the runner below
 * never sees a socket — it is driven by typed text in the panel exactly as it is driven by
 * a model, which is the only reason any of this is testable without an API key.
 */

import type {LintFinding, StoryMap} from '@sliders/story-map';

export type ToolParamType = 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';

export interface ToolParamSchema {
	type: ToolParamType;
	description?: string;
	enum?: string[];
	items?: ToolParamSchema;
	properties?: Record<string, ToolParamSchema>;
	required?: string[];
}

/** One callable, as the model is told about it. */
export interface VoiceToolDecl {
	name: string;
	description: string;
	parameters: {
		type: 'object';
		properties: Record<string, ToolParamSchema>;
		required?: string[];
	};
	/**
	 * `read` runs freely. `write` goes through undoable dispatch and lands a change on the
	 * author's undo stack. `ui` moves the editor without touching the story.
	 *
	 * The panel shows the three differently, and `write` is the only one the author is
	 * ever asked to confirm.
	 */
	kind: 'read' | 'write' | 'ui';
}

/**
 * What a tool hands back. Small on purpose: ok/err and counts, never the new body. A model
 * that gets the whole passage back after writing it will quote it, and the author will
 * hear their own story read to them instead of the next question.
 */
export type ToolResult =
	| ({ok: true} & Record<string, unknown>)
	| {ok: false; error: string};

export function toolError(error: string): ToolResult {
	return {error, ok: false};
}

/** A passage as the tools talk about it. */
export interface ToolPassage {
	id: string;
	name: string;
	tags: string[];
	text: string;
}

/** One row in the panel's transcript — the only record a voice session leaves behind. */
export interface TranscriptRow {
	/** Set on a `write` row: undoes exactly this call. */
	args?: Record<string, unknown>;
	at: number;
	error?: string;
	id: string;
	kind: 'user' | 'model' | 'tool' | 'system';
	/** Tool name, for a `tool` row. */
	tool?: string;
	toolKind?: VoiceToolDecl['kind'];
	text: string;
}

/**
 * Everything the runner is allowed to touch, injected rather than imported.
 *
 * The React hook below builds one of these out of the editor's contexts; a test builds one
 * out of plain objects. Nothing in `runner.ts` knows that either exists.
 */
export interface VoiceToolEnv {
	/** The story as it is RIGHT NOW. Called fresh on every tool, never captured. */
	story: () => {id: string; name: string; passages: ToolPassage[]};
	/** The map, already built. Async because the asset manifest may be. */
	map: () => Promise<StoryMap>;
	lint: () => Promise<LintFinding[]>;
	/** Assets the story's library holds, in manifest order. */
	assets: () => Promise<
		{id: string; name: string; kind: string; bytes: number}[]
	>;
	/** Which scenes reach which asset. Keyed by asset id. */
	assetUsage: () => Promise<Record<string, string[]>>;

	// --- writes. Each lands ONE undoable change, described by `description`. -----
	writePassage: (id: string, text: string) => void;
	createPassage: (name: string, text: string, at?: [number, number]) => string;
	deletePassage: (id: string) => void;
	renamePassage: (id: string, name: string) => void;
	tagPassage: (id: string, add: string[], remove: string[]) => void;
	findReplace: (
		search: string,
		replace: string,
		passageIds?: string[]
	) => number;

	// --- UI ----------------------------------------------------------------------
	goto: (id: string) => void;
	openPreview: (id: string, beat?: number) => void;
	openPassageEditor: (id: string) => void;
	highlight: (ids: string[]) => void;

	// --- history -------------------------------------------------------------------
	checkpoint?: (label: string) => Promise<void>;
	revs?: () => Promise<{rev: number; at: string; label?: string}[]>;

	/** §4. Absent until the screenshot host is mounted; the tool then reports so. */
	screenshot?: (
		id: string,
		beat?: number
	) => Promise<{data: string; height: number; mime: string; width: number}>;
}
