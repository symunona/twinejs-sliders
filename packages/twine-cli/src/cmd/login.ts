/**
 * `login` — put a token in the profile (spec 12 §1, command 2, §7).
 *
 * Prompt-free on purpose. The caller is usually a script or an agent, and a password
 * prompt in front of one either hangs or gets answered by the next line of the pipe, so
 * the token arrives as `--token` or on stdin and nothing is ever echoed back.
 *
 * The check is two requests, in this order, because that is what separates the three ways
 * this fails (spec 11): nothing answers at all — wrong address or the server is down;
 * `/health` answers and `/ping` says 401 — the server is there and the token is wrong; both
 * answer — connected. A single request cannot tell the first two apart.
 *
 * The request goes out from here rather than through `ctx.write` because the token being
 * tested is the new one, which is not the one the context was built with.
 */

import {readConfigFile, saveProfile} from '../config';
import {CliError, EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'login';
export const summary = 'Verify a server and token, then store them in the profile 0600';

const USAGE =
	'usage: twine-cli login --server <url> [--token <token>]   (token also read from stdin)';

export async function run(ctx: Ctx, args: string[]): Promise<number> {
	const server = (flag(ctx, 'server') ?? args[0] ?? ctx.config.server ?? '').trim();

	if (server === '') {
		throw new CliError(`login needs a server.\n${USAGE}`, EXIT.usage);
	}

	const token = (flag(ctx, 'token') ?? (await readStdin())).trim();

	if (token === '') {
		throw new CliError(
			`login needs a token: pass --token, or pipe it in.\n${USAGE}`,
			EXIT.usage
		);
	}

	const base = apiBase(server);
	const ping = await verify(base, token, ctx);

	// config.ts owns the file: where it lives, its 0600 mode, and the client id it keeps
	// stable across runs. login owns one profile in it.
	// Without --profile the token lands in the profile this box is already using, not in a
	// second one that nothing reads.
	const profileName =
		flag(ctx, 'profile') ??
		process.env.TWINE_PROFILE ??
		readConfigFile().profile ??
		'local';
	const saved = saveProfile(profileName, {server, token});

	if (ctx.json) {
		ctx.out(JSON.stringify({ok: true, ping, profile: saved.profile, server}));
	} else {
		const count = typeof ping.storyCount === 'number' ? ping.storyCount : undefined;
		const stories =
			count === undefined ? '' : `  ${count} ${count === 1 ? 'story' : 'stories'}`;

		ctx.out(`connected  ${server}  profile ${saved.profile}${stories}`);
		ctx.out(`token stored in ${saved.path} (0600)`);
	}

	return EXIT.ok;
}

/** `/health` first, `/ping` second — the order is what makes the failure legible. */
async function verify(
	base: string,
	token: string,
	ctx: Ctx
): Promise<Record<string, unknown>> {
	let health: Response;

	try {
		health = await fetch(`${base}/health`);
	} catch (error) {
		throw new CliError(
			`cannot reach ${base}: wrong address, or the server is down (${String(error)})`,
			EXIT.server
		);
	}

	if (!health.ok) {
		throw new CliError(
			`${base}/health answered ${health.status} — that is not a story store`,
			EXIT.server
		);
	}

	const ping = await fetch(`${base}/ping`, {
		headers: {
			authorization: `Bearer ${token}`,
			'x-client-id': ctx.config.clientId,
			'x-client-name': ctx.config.clientName
		}
	});

	if (ping.status === 401 || ping.status === 403) {
		throw new CliError(
			`the server at ${base} is there, but it rejected that token`,
			EXIT.server
		);
	}

	if (!ping.ok) {
		throw new CliError(`${base}/ping answered ${ping.status}`, EXIT.server);
	}

	return (await ping.json()) as Record<string, unknown>;
}

/** `https://host/` and `https://host/api/v1` mean the same thing to a person. */
function apiBase(url: string): string {
	const trimmed = url.trim().replace(/\/+$/, '');

	return trimmed.endsWith('/api/v1') ? trimmed : `${trimmed}/api/v1`;
}

/**
 * Whatever was piped in, or nothing. A terminal with no pipe would block forever, and the
 * usage error the caller gets instead is more useful than a hung command.
 */
async function readStdin(): Promise<string> {
	if (process.stdin.isTTY) {
		return '';
	}

	const chunks: Buffer[] = [];

	for await (const chunk of process.stdin) {
		chunks.push(Buffer.from(chunk));
	}

	return Buffer.concat(chunks).toString('utf8');
}

function flag(ctx: Ctx, key: string): string | undefined {
	const value = ctx.flags[key];

	return typeof value === 'string' ? value : undefined;
}
