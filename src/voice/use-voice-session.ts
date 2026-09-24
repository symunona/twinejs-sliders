/**
 * One voice session: the transcript, the runner, and the undo behind each write row.
 *
 * The transcript IS the audit trail. Voice leaves nothing else behind — no diff the author
 * watched go by, no commit message, no file they opened. A row per turn and a row per tool
 * call is the whole record of what the microphone did to the story, so rows are appended
 * for failures too, and a `write` row carries the change count it landed against.
 */

import * as React from 'react';
import {useUndoableStoriesContext} from '../store/undoable-stories';
import {createToolRunner} from './runner';
import type {ToolRunner} from './runner';
import {voiceToolsByName} from './tools';
import type {ToolResult, TranscriptRow, VoiceToolEnv} from './voice.types';

/** Rows kept. Old enough to scroll back through, short of a memory leak on a long session. */
const MAX_ROWS = 300;

let rowSeq = 0;

function nextId(): string {
	rowSeq += 1;

	return `row-${rowSeq}`;
}

/** What a tool result reads like in the transcript. Short: the row is a receipt, not a log. */
export function summariseResult(name: string, result: ToolResult): string {
	const base = summariseBase(name, result);
	const lint = (result as {lint?: {fixed: number; new: string[]}}).lint;

	if (!lint || (lint.new.length === 0 && lint.fixed === 0)) {
		return base;
	}

	// The author should see what the model was told: a write that broke something reads
	// as broken on its own row, not only after the model decides to mention it.
	const parts = [
		lint.new.length > 0 ? `${lint.new.length} new lint` : '',
		lint.fixed > 0 ? `${lint.fixed} fixed` : ''
	].filter(Boolean);

	return `${base} · ${parts.join(', ')}`;
}

function summariseBase(name: string, result: ToolResult): string {
	if (result.ok === false) {
		return result.error;
	}

	const record = result as Record<string, unknown>;

	if (record.unchanged === true) {
		return 'no change';
	}

	switch (name) {
		case 'map':
			return `${(record.passages as unknown[])?.length ?? 0} passages, ${
				record.errors
			} errors`;
		case 'read_passage':
			return `${record.name}, ${String(record.text ?? '').split('\n').length} lines`;
		case 'read_scene':
			return `${record.id}: ${(record.beats as unknown[])?.length ?? 0} beats`;
		case 'lint':
			return `${record.errors} errors, ${record.warnings} warnings`;
		case 'patch_scene':
		case 'set_beat':
			return (record.changed as string[]).join(', ') || 'nothing to change';
		case 'write_passage':
			return `${record.name}, ${record.lines} lines`;
		case 'find_replace':
			return `${record.passages} passages`;
		case 'highlight':
			return `${record.highlighted} highlighted`;
		case 'screenshot_scene':
			return `${record.width}×${record.height} at beat ${record.beat}`;
		default:
			return Object.entries(record)
				.filter(([key]) => key !== 'ok' && key !== 'lint')
				.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
				.join(', ')
				.slice(0, 160);
	}
}

export interface VoiceSession {
	/** Run a tool and append its row. What the panel's text box and the socket both call. */
	call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
	clear(): void;
	/** The model's turn ended. Re-arms the one-screenshot-per-turn cap. */
	endTurn(): void;
	/** Append a row this session did not produce — a spoken turn, a connection notice. */
	say(kind: TranscriptRow['kind'], text: string): void;
	/**
	 * Drop the transcript AND rebuild the runner, for a new thread.
	 *
	 * The rebuild is the point, and it is the one case where it is correct. The runner's
	 * `read before write` gate is per session; a new thread is a new session, so a model
	 * that read a passage in the last conversation must read it again in this one.
	 * `clear` deliberately does not do this — wiping the visible rows is not the same as
	 * telling the model it may now write from memory.
	 */
	reset(): void;
	rows: TranscriptRow[];
	/** Replace the transcript with a restored thread's rows. */
	restore(rows: TranscriptRow[]): void;
	/** Undo the last change, whoever made it. The escape hatch, always reachable. */
	undo?: () => void;
	undoLabel?: string;
}

export function useVoiceSession(env: VoiceToolEnv): VoiceSession {
	const [rows, setRows] = React.useState<TranscriptRow[]>([]);
	const {undo, undoLabel} = useUndoableStoriesContext();
	/*
	 * One runner per session, so the `read before write` gate is per session — which is
	 * what it is for. Rebuilding it would silently re-arm every write.
	 *
	 * It therefore captures `env` ONCE, which is safe only because `useVoiceToolEnv`
	 * returns a stable object that reads the editor through refs. See the comment there:
	 * an env captured at mount takes a stale `dispatch` with it, and a stale dispatch
	 * computes undo against a story that no longer exists.
	 */
	const runner = React.useRef<ToolRunner>();
	/*
	 * `env` is stable (see above), but `reset` and `restore` rebuild the runner long after
	 * mount and must not close over the render that happened to create them.
	 */
	const envRef = React.useRef(env);

	envRef.current = env;

	if (!runner.current) {
		runner.current = createToolRunner(env);
	}

	// A tool call is async and the panel can be closed while one is in flight — a socket
	// frame arriving mid-teardown, or the author shutting the dialog on a slow write.
	// Appending then is a state update on an unmounted component.
	const live = React.useRef(true);

	React.useEffect(() => {
		live.current = true;

		return () => {
			live.current = false;
		};
	}, []);

	const append = React.useCallback((row: Omit<TranscriptRow, 'at' | 'id'>) => {
		if (!live.current) {
			return;
		}

		setRows(current =>
			[...current, {...row, at: Date.now(), id: nextId()}].slice(-MAX_ROWS)
		);
	}, []);

	const call = React.useCallback(
		async (name: string, args: Record<string, unknown>) => {
			const result = await runner.current!.run(name, args);

			append({
				args,
				error: result.ok === false ? result.error : undefined,
				kind: 'tool',
				text: summariseResult(name, result),
				tool: name,
				toolKind: voiceToolsByName.get(name)?.kind
			});

			return result;
		},
		[append]
	);

	const say = React.useCallback(
		(kind: TranscriptRow['kind'], text: string) => append({kind, text}),
		[append]
	);

	const reset = React.useCallback(() => {
		setRows([]);
		runner.current = createToolRunner(envRef.current);
	}, []);

	return {
		call,
		clear: React.useCallback(() => setRows([]), []),
		endTurn: React.useCallback(() => runner.current!.endTurn(), []),
		reset,
		restore: React.useCallback(rows => {
			// A restored thread is history, not this session's reads: the gate stays shut
			// until the model reads the passage again. It may well have changed since.
			setRows(rows.slice(-MAX_ROWS));
			runner.current = createToolRunner(envRef.current);
		}, []),
		rows,
		say,
		undo,
		undoLabel
	};
}

/**
 * Parse what the author typed into the panel's box: `tool_name {json}`, or `tool_name` on
 * its own, or bare JSON args after the name.
 *
 * This is the driver step 2 ships with, and it is not a convenience — it is how the whole
 * tool surface is exercised before a socket exists, and how it stays debuggable after one
 * does. A session that misbehaves is reproduced by typing the calls back in.
 */
export function parseToolLine(
	line: string
): {args: Record<string, unknown>; name: string} | {error: string} {
	const trimmed = line.trim();

	if (trimmed === '') {
		return {error: 'type a tool name'};
	}

	const space = trimmed.search(/\s/);
	const name = space === -1 ? trimmed : trimmed.slice(0, space);

	if (!voiceToolsByName.has(name)) {
		return {error: `no tool called '${name}'`};
	}

	const rest = space === -1 ? '' : trimmed.slice(space).trim();

	if (rest === '') {
		return {args: {}, name};
	}

	try {
		const parsed = JSON.parse(rest);

		if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
			return {error: 'arguments must be a JSON object'};
		}

		return {args: parsed as Record<string, unknown>, name};
	} catch {
		// A single required string argument is the common case, and quoting it as JSON
		// every time is friction with no upside. `read_passage Tavern Night` works.
		const tool = voiceToolsByName.get(name)!;
		const required = tool.parameters.required ?? [];

		if (required.length === 1) {
			return {args: {[required[0]]: rest}, name};
		}

		return {error: 'arguments must be JSON'};
	}
}
