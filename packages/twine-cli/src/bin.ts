/**
 * `twine-cli` entry point (spec 12): argument parsing, configuration, dispatch, exit codes.
 *
 * Hand rolled rather than a parser library, because the grammar is one line — a command, its
 * positionals, and flags that are either `--name value`, `--name=value` or a bare boolean —
 * and a dependency that has to be installed before the CLI runs would defeat the point of
 * bundling it into a single file.
 *
 * Every command is a module with the same three exports, and nothing else:
 *
 *     export const name = 'cat';
 *     export const summary = 'one line';
 *     export async function run(ctx: Ctx, args: string[]): Promise<number>;
 *
 * `args` is the positionals after the command name; flags arrive on `ctx.flags`. `run`
 * returns the exit code, or throws `CliError` when the code belongs to a message. Adding a
 * command is a file plus one line in `COMMANDS` — there is no registry to keep in step.
 */

import {resolveConfig} from './config';
import {makeSource} from './source';
import {CliError, EXIT} from './types';
import type {Ctx} from './types';
import {makeWriteClient} from './write';

import * as assets from './cmd/assets';
import * as cat from './cmd/cat';
import * as check from './cmd/check';
import * as copy from './cmd/copy';
import * as graph from './cmd/graph';
import * as lint from './cmd/lint';
import * as login from './cmd/login';
import * as ls from './cmd/ls';
import * as map from './cmd/map';
import * as newStory from './cmd/new';
import * as ping from './cmd/ping';
import * as put from './cmd/put';
import * as restore from './cmd/restore';
import * as revs from './cmd/revs';
import * as rm from './cmd/rm';

export interface CommandModule {
	name: string;
	summary: string;
	run(ctx: Ctx, args: string[]): Promise<number>;
}

/** Listed in the order spec 12 §1 lists them, which is roughly the order you learn them. */
const COMMANDS: CommandModule[] = [
	ping,
	login,
	ls,
	map,
	cat,
	put,
	check,
	lint,
	assets,
	graph,
	copy,
	newStory,
	rm,
	revs,
	restore
];

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
	'reid',
	'rev',
	'scene',
	'server',
	'sort',
	'token'
]);

export interface ParsedArgs {
	command?: string;
	args: string[];
	flags: Record<string, string | boolean>;
}

export function parseArgs(argv: string[]): ParsedArgs {
	const args: string[] = [];
	const flags: Record<string, string | boolean> = {};
	let onlyPositionals = false;

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
			flags[raw.slice(0, eq)] = raw.slice(eq + 1);
			continue;
		}

		const next = argv[i + 1];

		if (VALUE_FLAGS.has(raw) && next !== undefined && (!next.startsWith('-') || next === '-')) {
			flags[raw] = next;
			i++;
			continue;
		}

		flags[raw] = true;
	}

	const [command, ...rest] = args;

	return {args: rest, command, flags};
}

function usage(): string {
	const width = COMMANDS.reduce((max, cmd) => Math.max(max, cmd.name.length), 0);
	const lines = [
		'twine-cli <command> [args] [flags]   — terminal client for the story store',
		'',
		...COMMANDS.map(cmd => `  ${cmd.name.padEnd(width)}  ${cmd.summary}`),
		'',
		'Global flags:',
		'  --data <dir>     read the store from DATA_DIR instead of the API',
		'  --server <url>   store URL',
		'  --token <token>  bearer token',
		'  --profile <name> profile in ~/.config/twine-cli/config.json',
		'  --json           machine readable output',
		'  --yes            do not ask',
		'  -q               only print what was asked for',
		'',
		'Refs:  ep3 · ep3/Tavern Night · ep3#tavern-night · ep3:a_8f21 · ep3@37'
	];

	return lines.join('\n');
}

function stringFlag(flags: Record<string, string | boolean>, key: string): string | undefined {
	const value = flags[key];

	return typeof value === 'string' ? value : undefined;
}

export async function main(argv: string[]): Promise<number> {
	const {args, command, flags} = parseArgs(argv);

	if (!command || command === 'help' || flags.help || flags.h) {
		const wanted = command === 'help' ? args[0] : command;
		const found = COMMANDS.find(cmd => cmd.name === wanted);

		process.stdout.write(`${found ? `${found.name} — ${found.summary}` : usage()}\n`);

		return EXIT.ok;
	}

	const found = COMMANDS.find(cmd => cmd.name === command);

	if (!found) {
		process.stderr.write(`twine-cli: unknown command "${command}"\n\n${usage()}\n`);

		return EXIT.usage;
	}

	const config = resolveConfig({
		data: stringFlag(flags, 'data'),
		profile: stringFlag(flags, 'profile'),
		server: stringFlag(flags, 'server'),
		token: stringFlag(flags, 'token')
	});
	const quiet = flags.q === true || flags.quiet === true;
	const ctx: Ctx = {
		config,
		flags,
		json: flags.json === true,
		out(line: string) {
			if (!quiet) {
				process.stdout.write(`${line}\n`);
			}
		},
		quiet,
		source: makeSource(config),
		write: makeWriteClient(config)
	};

	return found.run(ctx, args);
}

// `twine-cli map ep3 | head -3` closes stdout early, and an unhandled EPIPE would turn that
// into a stack trace instead of the three lines the user asked for.
process.stdout.on('error', (error: NodeJS.ErrnoException) => {
	if (error.code === 'EPIPE') {
		process.exit(EXIT.ok);
	}

	throw error;
});

main(process.argv.slice(2))
	.then(code => {
		process.exitCode = code;
	})
	.catch((error: unknown) => {
		if (error instanceof CliError) {
			process.stderr.write(`twine-cli: ${error.message}\n`);
			process.exitCode = error.code;

			return;
		}

		// Everything the CLI does that is not a CliError is filesystem or fetch, so an
		// unexpected failure is "the store did not answer" far more often than it is a bug.
		process.stderr.write(`twine-cli: ${(error as Error)?.message ?? String(error)}\n`);
		process.exitCode = EXIT.server;
	});
