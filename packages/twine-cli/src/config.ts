/**
 * Configuration for one invocation (spec 12 §7).
 *
 * Four layers, narrowest first: flags, then `TWINE_STORE_*` env, then the named profile in
 * `~/.config/twine-cli/config.json`, then defaults. The file is the only one that persists,
 * and it holds a token, so it is written 0600 in a 0700 directory.
 *
 * `dataDir` is deliberately absent from the defaults: a host path in a config file is a path
 * that rots the moment the store moves. When the server is loopback we read `DATA_DIR` out of
 * the `.env` beside the server binary instead, which is the same file the server itself read.
 */

import {randomBytes} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {homedir, hostname} from 'node:os';
import {dirname, isAbsolute, join, resolve} from 'node:path';
import {CliError, EXIT} from './types';
import type {Config} from './types';

/** One entry of `profiles` in the config file. */
export interface Profile {
	server?: string;
	token?: string;
	dataDir?: string;
}

export interface ConfigFile {
	profile?: string;
	profiles?: Record<string, Profile>;
	clientId?: string;
	clientName?: string;
}

/** The flags `bin.ts` collects that can move configuration. */
export interface ConfigFlags {
	data?: string;
	server?: string;
	token?: string;
	profile?: string;
}

const DEFAULT_SERVER = 'http://127.0.0.1:8080';
const DEFAULT_PROFILE = 'local';

export function configDir(): string {
	const xdg = process.env.XDG_CONFIG_HOME;

	return xdg ? join(xdg, 'twine-cli') : join(homedir(), '.config', 'twine-cli');
}

export function configPath(): string {
	return join(configDir(), 'config.json');
}

export function readConfigFile(): ConfigFile {
	let raw: string;

	try {
		raw = readFileSync(configPath(), 'utf8');
	} catch {
		return {};
	}

	try {
		const parsed = JSON.parse(raw) as ConfigFile;

		return parsed && typeof parsed === 'object' ? parsed : {};
	} catch (error) {
		throw new CliError(
			`${configPath()} is not valid JSON: ${(error as Error).message}`,
			EXIT.usage
		);
	}
}

/** Writes the config file 0600. The directory is 0700 for the same reason. */
export function writeConfigFile(file: ConfigFile): void {
	mkdirSync(configDir(), {mode: 0o700, recursive: true});
	writeFileSync(configPath(), `${JSON.stringify(file, null, '\t')}\n`, {mode: 0o600});
}

/** `cli_9f31` — persisted, so the change bus can tell this CLI's writes from an editor's. */
function newClientId(): string {
	return `cli_${randomBytes(2).toString('hex')}`;
}

function isLoopback(url: string): boolean {
	let host: string;

	try {
		host = new URL(url).hostname;
	} catch {
		return false;
	}

	// URL keeps IPv6 hostnames in brackets.
	const bare = host.replace(/^\[|\]$/g, '').toLowerCase();

	return bare === 'localhost' || bare === '::1' || /^127\./.test(bare);
}

/**
 * Walk up looking for the checkout that holds `server/`. Started from the CLI's own path and
 * from the working directory, so it works both from `packages/twine-cli/dist` and from
 * wherever the user happens to be standing.
 */
function findRepoRoot(): string | undefined {
	const starts = [process.cwd()];
	const self = process.argv[1];

	if (self) {
		starts.push(dirname(resolve(self)));
	}

	for (const start of starts) {
		let dir = start;

		for (;;) {
			if (existsSync(join(dir, 'server', 'main.go'))) {
				return dir;
			}

			const up = dirname(dir);

			if (up === dir) {
				break;
			}

			dir = up;
		}
	}

	return undefined;
}

/** `DATA_DIR=./data` out of an env file, comments and quotes removed. */
function readEnvDataDir(envPath: string): string | undefined {
	let text: string;

	try {
		text = readFileSync(envPath, 'utf8');
	} catch {
		return undefined;
	}

	for (const line of text.split('\n')) {
		const match = /^\s*(?:export\s+)?DATA_DIR\s*=\s*(.*)$/.exec(line);

		if (!match) {
			continue;
		}

		let value = match[1].trim();

		if (
			value.length >= 2 &&
			(value[0] === '"' || value[0] === "'") &&
			value[value.length - 1] === value[0]
		) {
			value = value.slice(1, -1);
		} else {
			// Unquoted values end at a comment, the way the server's own loader reads them.
			value = value.replace(/\s+#.*$/, '').trim();
		}

		if (value !== '') {
			return value;
		}
	}

	return undefined;
}

/**
 * Where the store keeps its files, when this machine is the store's machine.
 *
 * `DATA_DIR` in the env file is relative to the server binary, so it resolves against
 * `server/`, never against the caller's working directory. Absent, the server's own default
 * (`./data`) applies.
 */
export function detectDataDir(): string | undefined {
	const root = findRepoRoot();

	if (!root) {
		return undefined;
	}

	const serverDir = join(root, 'server');
	const fromEnv = readEnvDataDir(join(serverDir, '.env'));
	const dir = fromEnv ?? 'data';

	return isAbsolute(dir) ? dir : resolve(serverDir, dir);
}

/** True when `dir` looks like a store DATA_DIR this process can read. */
export function usableDataDir(dir: string | undefined): dir is string {
	return dir !== undefined && existsSync(join(dir, 'stories'));
}

/**
 * Resolve the configuration, and persist a generated `clientId` so it is stable across runs —
 * the server uses it to skip this client's own writes on the change bus, which only works if
 * "this client" means the same thing tomorrow.
 */
export function resolveConfig(flags: ConfigFlags = {}): Config {
	const file = readConfigFile();
	const profileName =
		flags.profile ?? process.env.TWINE_PROFILE ?? file.profile ?? DEFAULT_PROFILE;
	const profile = file.profiles?.[profileName] ?? {};

	const server =
		flags.server ?? process.env.TWINE_STORE_URL ?? profile.server ?? DEFAULT_SERVER;
	const token = flags.token ?? process.env.TWINE_STORE_TOKEN ?? profile.token ?? '';
	const explicitData = flags.data ?? process.env.TWINE_DATA ?? profile.dataDir;

	let clientId = file.clientId;

	if (!clientId) {
		clientId = newClientId();
		writeConfigFile({...file, clientId});
	}

	const clientName = file.clientName ?? `twine-cli@${hostname()}`;
	const dataDir = explicitData
		? resolve(explicitData)
		: isLoopback(server)
			? detectDataDir()
			: undefined;

	return {clientId, clientName, dataDir, server, token};
}

/**
 * Aliases the command modules import. `config.ts` owns where the file lives and how it is
 * written; a command that only wants to change one field in it should not have to know.
 */
export const loadConfig = readConfigFile;
export const saveConfig = writeConfigFile;

/** `login` writes the token back into the named profile. */
export function saveProfile(
	profileName: string,
	patch: Profile
): {path: string; profile: string} {
	const file = readConfigFile();
	const profiles = {...file.profiles};
	const existing = profiles[profileName] ?? {};

	profiles[profileName] = {...existing, ...patch};
	writeConfigFile({...file, profile: file.profile ?? profileName, profiles});

	return {path: configPath(), profile: profileName};
}
