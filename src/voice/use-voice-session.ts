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
				.filter(([key]) => key !== 'ok')
				.map(([key, value]) => `${key}: ${JSON.stringify(value)}`)
				.join(', ')
				.slice(0, 160);
	}
}

export interface VoiceSession {
	/** Run a tool and append its row. What the panel's text box and the socket both call. */
	call(name: string, args: Record<string, unknown>): Promise<ToolResult>;
	clear(): void;
	rows: TranscriptRow[];
	/** Append a row this session did not produce — a spoken turn, a connection notice. */
	say(kind: TranscriptRow['kind'], text: string): void;
	/** Undo the last change, whoever made it. The escape hatch, always reachable. */
	undo?: () => void;
	undoLabel?: string;
}

export function useVoiceSession(env: VoiceToolEnv): VoiceSession {
	const [rows, setRows] = React.useState<TranscriptRow[]>([]);
	const {undo, undoLabel} = useUndoableStoriesContext();
	// One runner per session, so the `read before write` gate is per session — which is
	// what it is for. Rebuilding it on an env change would silently re-arm every write.
	const runner = React.useRef(createToolRunner(env));
	const envRef = React.useRef(env);

	// The runner captured the env object; keep it pointing at the live one without
	// throwing away `seen`.
	if (envRef.current !== env) {
		envRef.current = env;
	}

	const append = React.useCallback((row: Omit<TranscriptRow, 'at' | 'id'>) => {
		setRows(current =>
			[...current, {...row, at: Date.now(), id: nextId()}].slice(-MAX_ROWS)
		);
	}, []);

	const call = React.useCallback(
		async (name: string, args: Record<string, unknown>) => {
			const result = await runner.current.run(name, args);

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

	return {
		call,
		clear: React.useCallback(() => setRows([]), []),
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
