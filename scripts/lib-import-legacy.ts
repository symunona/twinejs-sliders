/**
 * Old per-story art backup → shared asset library on a server. Run via the .mjs next to it:
 *
 *   node scripts/lib-import-legacy.mjs [--dry-run] [--json] <storyDir>...
 *   node scripts/lib-import-legacy.mjs --all <backupRoot>
 *
 * <storyDir> is one folder of a backup made like backups/demos-2026-09-28/:
 *   story.json (story, passages), assets.json (old manifest: assets, characters),
 *   blobs-by-id/<a_id><ext>, optional sidecars/<a_id>.<kind><ext>.
 *
 * Server + token: --server/--token, else LIB_SERVER_URL/LIB_TOKEN, else the twine-cli
 * profile (--profile, default the config's) in ~/.config/twine-cli/config.json.
 * Token is never printed. Idempotent: re-run skips what is there. See legacy-import.ts.
 */
import {
	HttpTransport,
	LibraryEngine,
	MemoryBlobCache,
	MemoryLocalDb
} from '@sliders/asset-library';
import type {AssetMeta, Character} from '@sliders/scene-types';
import {readdirSync, readFileSync, existsSync, statSync} from 'node:fs';
import {homedir} from 'node:os';
import {join} from 'node:path';
import {
	importLegacyStory,
	LegacyBackup,
	LegacyImportReport
} from '../src/store/asset-library/legacy-import';

const USAGE = `lib-import-legacy [--dry-run] [--json] [--server URL --token T | --profile P]
                  (<storyDir>... | --all <backupRoot>)
  storyDir: story.json, assets.json, blobs-by-id/<a_id><ext>[, sidecars/<a_id>.<kind><ext>]
  server/token: flags, else LIB_SERVER_URL/LIB_TOKEN, else twine-cli profile`;

interface Args {
	dirs: string[];
	dryRun: boolean;
	json: boolean;
	server?: string;
	token?: string;
	profile?: string;
}

function parseArgs(argv: string[]): Args {
	const args: Args = {dirs: [], dryRun: false, json: false};

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];

		switch (arg) {
			case '--dry-run':
				args.dryRun = true;
				break;
			case '--json':
				args.json = true;
				break;
			case '--server':
				args.server = argv[++i];
				break;
			case '--token':
				args.token = argv[++i];
				break;
			case '--profile':
				args.profile = argv[++i];
				break;
			case '--all': {
				const root = argv[++i];

				for (const name of readdirSync(root).sort()) {
					if (existsSync(join(root, name, 'assets.json'))) {
						args.dirs.push(join(root, name));
					}
				}

				break;
			}
			case '-h':
			case '--help':
				console.log(USAGE);
				process.exit(0);
				break;
			default:
				if (arg.startsWith('-')) {
					throw new Error(`unknown flag ${arg}`);
				}

				args.dirs.push(arg);
		}
	}

	return args;
}

function target(args: Args): {server: string; token: string} {
	let server = args.server ?? process.env.LIB_SERVER_URL;
	let token = args.token ?? process.env.LIB_TOKEN;

	if (!server || !token) {
		const config = JSON.parse(
			readFileSync(join(homedir(), '.config/twine-cli/config.json'), 'utf8')
		);
		const profile = config.profiles?.[args.profile ?? config.profile ?? 'live'];

		server = server ?? profile?.server;
		token = token ?? profile?.token;
	}

	if (!server || !token) {
		throw new Error('no server/token: --server/--token, LIB_SERVER_URL/LIB_TOKEN or a twine-cli profile');
	}

	return {server, token};
}

function readBackup(dir: string): LegacyBackup {
	const rawStory = JSON.parse(readFileSync(join(dir, 'story.json'), 'utf8'));
	const story = rawStory.story ?? rawStory;
	const manifest = JSON.parse(readFileSync(join(dir, 'assets.json'), 'utf8'));
	const blobDir = join(dir, 'blobs-by-id');
	const files = existsSync(blobDir) ? readdirSync(blobDir) : [];
	const sideDir = join(dir, 'sidecars');
	const sideFiles = existsSync(sideDir) ? readdirSync(sideDir) : [];
	const bytesOf = (path: string) => new Uint8Array(readFileSync(path));

	return {
		assets: (manifest.assets ?? []) as AssetMeta[],
		characters: (manifest.characters ?? []) as Character[],
		story: {id: story.id, name: story.name, passages: story.passages ?? []},
		async blob(meta) {
			const file = files.find(name => name.startsWith(`${meta.id}.`));

			return file ? bytesOf(join(blobDir, file)) : undefined;
		},
		async sidecar(meta, kind) {
			const file = sideFiles.find(name => name.startsWith(`${meta.id}.${kind}`));

			return file ? bytesOf(join(sideDir, file)) : undefined;
		}
	};
}

function summary(report: LegacyImportReport): string {
	const count = (part: LegacyImportReport['assets']) =>
		`${part.created.length} new, ${part.skipped.length} skipped, ${part.failed.length} failed${
			'merged' in part && (part as {merged: string[]}).merged.length
				? `, ${(part as {merged: string[]}).merged.length} exact dups merged`
				: ''
		}`;
	const lines = [
		`${report.dryRun ? '[dry-run] ' : ''}${report.storyName} (${report.storyId})`,
		`  collection  ${report.collection.name}${report.collection.created ? ' (new)' : ''}`,
		`  assets      ${count(report.assets)}`,
		`  characters  ${count(report.characters)}`
	];

	if (!report.dryRun) {
		lines.push(
			`  refs        ${report.refs}${
				report.unresolved.length ? `, unresolved: ${report.unresolved.join(', ')}` : ''
			}`
		);
	}

	for (const line of [...report.assets.failed, ...report.characters.failed]) {
		lines.push(`  FAIL ${line}`);
	}

	for (const line of report.warnings) {
		lines.push(`  warn ${line}`);
	}

	return lines.join('\n');
}

async function main() {
	const args = parseArgs(process.argv.slice(2));

	if (!args.dirs.length) {
		throw new Error('no story folders given (see --help)');
	}

	for (const dir of args.dirs) {
		if (!statSync(dir).isDirectory()) {
			throw new Error(`${dir} is not a folder`);
		}
	}

	const {server, token} = target(args);
	const engine = new LibraryEngine({
		blobs: new MemoryBlobCache(),
		clientName: 'lib-import-legacy',
		db: new MemoryLocalDb(),
		debounceMs: 60_000,
		transport: new HttpTransport(server, token, 'lib-import-legacy')
	});

	await engine.start();
	await engine.sync();
	console.error(`server ${server}: ${engine.collections().length} collections, ${engine.assets().length} assets`);

	const reports: LegacyImportReport[] = [];
	let failed = false;

	for (const dir of args.dirs) {
		const report = await importLegacyStory(engine, readBackup(dir), {
			dryRun: args.dryRun
		});

		if (!args.dryRun) {
			await engine.flush();
			await engine.idle();
		}

		reports.push(report);
		failed ||= !!(report.assets.failed.length || report.characters.failed.length);

		if (!args.json) {
			console.log(summary(report));
		}
	}

	if (!args.dryRun) {
		await engine.flush();
		await engine.idle();
	}

	const status = engine.status();

	await engine.dispose();

	if (args.json) {
		console.log(JSON.stringify({reports, status}, null, 1));
	} else {
		console.log(`pending ${status.pending}, conflicts ${status.conflicts}`);
	}

	if (failed || status.pending || status.conflicts) {
		process.exitCode = 1;
	}
}

main().catch(error => {
	console.error(`lib-import-legacy: ${(error as Error).message}`);
	process.exit(2);
});
