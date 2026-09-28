/**
 * Argument parsing for `bin.ts`, apart from it because `bin.ts` runs the CLI on import.
 */

import type {Flags} from './types';

/**
 * Flags that take a value. Everything else is a boolean, so `put ep3 --all tmp/ep3/` reads
 * `tmp/ep3/` as a positional instead of eating it. A new flag with an argument belongs here;
 * `--flag=value` always works without registering anything.
 */
const VALUE_FLAGS = new Set([
	'after',
	'assets',
	'data',
	'delete',
	'depth',
	'format',
	'from',
	'kind',
	'name',
	'o',
	'out',
	'profile',
	'rev',
	'scene',
	'server',
	'sort',
	'token'
]);

/**
 * Value flags that may be given more than once. They always arrive as `string[]`, even for
 * one use; every other flag is last-wins.
 */
const REPEAT_FLAGS = new Set(['delete']);

export interface ParsedArgs {
	command?: string;
	args: string[];
	flags: Flags;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args: string[] = [];
	const flags: Flags = {};
	let onlyPositionals = false;

	const setValue = (key: string, value: string) => {
		if (REPEAT_FLAGS.has(key)) {
			const seen = flags[key];

			flags[key] = [...(Array.isArray(seen) ? seen : []), value];
		} else {
			flags[key] = value;
		}
	};

	for (let i = 0; i < argv.length; i++) {
		const token = argv[i];

		if (onlyPositionals || token === '-' || !token.startsWith('-')) {
			args.push(token);
			continue;
		}

		if (token === '--') {
			onlyPositionals = true;
			continue;
		}

		const raw = token.replace(/^--?/, '');
		const eq = raw.indexOf('=');

		if (eq !== -1) {
			setValue(raw.slice(0, eq), raw.slice(eq + 1));
			continue;
		}

		const next = argv[i + 1];

		if (VALUE_FLAGS.has(raw) && next !== undefined && (!next.startsWith('-') || next === '-')) {
			setValue(raw, next);
			i++;
			continue;
		}

		flags[raw] = true;
	}

	const [command, ...rest] = args;

	return {args: rest, command, flags};
}
