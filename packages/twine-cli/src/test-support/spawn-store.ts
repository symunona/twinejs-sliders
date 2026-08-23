/**
 * Spawn a real story store for a test, on a free port, over a throwaway data directory.
 *
 * The Go server prints `listening on 127.0.0.1:<port>` as the first line of stdout for
 * exactly this reason (spec 11), so nothing here has to guess a port or poll for one. The
 * binary is built on demand, because a stale binary passing a test is worse than a slow
 * one.
 */
import {execFileSync, spawn, type ChildProcess} from 'node:child_process';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';

const repoRoot = resolve(__dirname, '../../../..');
const serverDir = join(repoRoot, 'server');

export interface Store {
	url: string;
	token: string;
	dataDir: string;
	stop(): void;
}

let binary: string | undefined;

function buildOnce(): string {
	if (!binary) {
		const out = join(mkdtempSync(join(tmpdir(), 'twine-store-bin-')), 'twine-store');

		execFileSync('go', ['build', '-o', out, '.'], {cwd: serverDir, stdio: 'pipe'});
		binary = out;
	}
	return binary;
}

export async function spawnStore(): Promise<Store> {
	const bin = buildOnce();
	const dataDir = mkdtempSync(join(tmpdir(), 'twine-store-data-'));
	const token = 'test-token-' + Math.random().toString(16).slice(2, 10).padEnd(8, '0');
	const envFile = join(dataDir, '.env');

	writeFileSync(envFile, `AUTH_TOKEN=${token}\nDATA_DIR=${join(dataDir, 'data')}\nCORS_ORIGINS=*\n`);

	const child: ChildProcess = spawn(bin, ['--env', envFile, '--addr', '127.0.0.1:0'], {
		cwd: dataDir,
		stdio: ['ignore', 'pipe', 'pipe']
	});

	const url = await new Promise<string>((ok, fail) => {
		const timer = setTimeout(() => fail(new Error('store did not announce a port')), 10_000);
		let seen = '';

		child.stdout!.on('data', (chunk: Buffer) => {
			seen += chunk.toString();

			const match = /listening on (\S+)/.exec(seen);

			if (match) {
				clearTimeout(timer);
				ok(`http://${match[1]}`);
			}
		});
		child.on('exit', code => {
			clearTimeout(timer);
			fail(new Error(`store exited early with ${code}`));
		});
	});

	// A hook that fails before `stop()` would otherwise leave this server running, and jest
	// waits for it forever — which is how one timed-out setup turns into a wedged box.
	const reap = () => {
		try {
			child.kill('SIGKILL');
		} catch {
			// Already gone.
		}
	};

	process.once('exit', reap);

	return {
		url,
		token,
		dataDir: join(dataDir, 'data'),
		stop() {
			process.removeListener('exit', reap);
			child.kill('SIGTERM');
			rmSync(dataDir, {force: true, recursive: true});
		}
	};
}
