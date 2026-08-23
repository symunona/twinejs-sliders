/**
 * `ping` — which mode, which server, how much is in it, who else is here (spec 12 §1).
 *
 * Two probes rather than one, for the reason spec 11 gives: `/health` needs no token, `/ping`
 * does, so "unreachable", "token rejected" and "fine" are three distinguishable answers
 * instead of one shrug.
 */

import {HttpError} from '../source/http';
import {EXIT} from '../types';
import type {Ctx} from '../types';

export const name = 'ping';
export const summary = 'mode, server version, story count, who else is connected';

interface PingBody {
	version?: string;
	apiVersion?: number;
	storyCount?: number;
	bytesUsed?: number;
	clients?: {id: string; name: string}[];
}

function mb(bytes: number): string {
	return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

export async function run(ctx: Ctx): Promise<number> {
	const result: Record<string, unknown> = {
		dataDir: ctx.config.dataDir,
		mode: ctx.source.mode,
		server: ctx.config.server
	};

	let code: number = EXIT.ok;
	let ping: PingBody | undefined;
	let failure: string | undefined;

	try {
		ping = (await ctx.write.ping()) as PingBody;
	} catch (error) {
		failure =
			error instanceof HttpError && error.status === 401
				? 'token rejected'
				: (error as Error).message;
		code = EXIT.server;
	}

	if (ping) {
		result.version = ping.version;
		result.apiVersion = ping.apiVersion;
		result.storyCount = ping.storyCount;
		result.bytesUsed = ping.bytesUsed;
		result.clients = ping.clients ?? [];
	} else {
		result.error = failure;
	}

	// In local mode the story count is a directory listing, and it stays true even when the
	// server is down — which is exactly the case worth reporting separately.
	if (ctx.source.mode === 'local') {
		result.stories = (await ctx.source.list()).length;
	} else if (ping) {
		result.stories = ping.storyCount ?? 0;
	}

	if (ctx.json) {
		process.stdout.write(`${JSON.stringify(result)}\n`);

		return code;
	}

	ctx.out(
		ctx.source.mode === 'local'
			? `mode     local    ${ctx.config.dataDir}`
			: 'mode     remote'
	);
	ctx.out(`server   ${ctx.config.server}`);

	if (ping) {
		ctx.out(`version  ${ping.version ?? 'unknown'}   api ${ping.apiVersion ?? '?'}`);
		ctx.out(
			`stories  ${result.stories ?? 0}${
				ping.bytesUsed === undefined ? '' : `   ${mb(ping.bytesUsed)}`
			}`
		);

		const others = (ping.clients ?? []).filter(client => client.id !== ctx.config.clientId);

		ctx.out(
			others.length === 0
				? 'here     nobody else'
				: `here     ${others.map(client => client.name).join(', ')}`
		);
	} else {
		ctx.out(`status   unreachable: ${failure}`);

		if (result.stories !== undefined) {
			ctx.out(`stories  ${result.stories}   (read from DATA_DIR; writes will fail)`);
		}
	}

	return code;
}
