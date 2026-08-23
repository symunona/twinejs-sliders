/** @jest-environment node */
/**
 * End-to-end: build a story from nothing, using only the CLI.
 *
 * This is the path a story never takes in the editor, so it is the one most likely to
 * produce something the editor cannot open: a body missing the fields Twine expects, a
 * passage with no position, an asset uploaded without a manifest row. Each assertion here
 * is a thing that has to be true before the editor will draw it.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnStore, type Store} from '../test-support/spawn-store';

const pkgDir = resolve(__dirname, '../..');
const bundle = join(pkgDir, 'dist/twine-cli.mjs');

jest.setTimeout(300_000);

let store: Store;
let work: string;

const RIDGE = `The ridge falls away into dust. Below, something is burning.

[scene]
id: ridge-dusk
bg: ridge-dusk
camera: {at: [0, 0], zoom: 1}
beats:
  - box: "Three ways down, and the light is going."
  - mark: choosing
links:
  descend: {to: Descent, icon: boot}
  signal: {to: Signal Fire, icon: flame}
  wait: {to: Nightfall, transition: fade}
`;

const DESCENT = `Scree, then a crack in the rock wide enough to enter.

[scene]
id: descent
from: ridge-dusk
beats:
  - box: "Cave, or the riverbed. Not both."
links:
  cave: {to: The Cave}
  river: {to: The Riverbed}
`;

const SIGNAL = `Someone built this fire to be seen.

[scene]
id: signal-fire
beats:
  - box: "The flame leans east."
links:
  answer: {to: The Answer}
  hide: {to: The Riverbed, transition: fade}
`;

function cli(args: string[], opts: {expectFail?: boolean} = {}) {
	try {
		return execFileSync('node', [bundle, ...args], {
			encoding: 'utf8',
			// Closed stdin, not jest's. A command that ever reads stdin would otherwise
			// block here for as long as the runner lives.
			input: '',
			env: {
				...process.env,
				TWINE_STORE_URL: store.url,
				TWINE_STORE_TOKEN: store.token,
				TWINE_DATA: store.dataDir,
				HOME: work
			}
		});
	} catch (error) {
		const e = error as {status: number; stdout: string; stderr: string};

		if (opts.expectFail) {
			return `EXIT ${e.status}\n${e.stdout ?? ''}${e.stderr ?? ''}`;
		}
		throw new Error(`${args.join(' ')} failed (${e.status}): ${e.stdout}${e.stderr}`);
	}
}

async function api(path: string) {
	const response = await fetch(`${store.url}/api/v1${path}`, {
		headers: {authorization: `Bearer ${store.token}`}
	});

	if (!response.ok) {
		throw new Error(`${path} -> ${response.status}`);
	}
	return response.json();
}

function write(name: string, text: string) {
	const file = join(work, name);

	writeFileSync(file, text);
	return file;
}

let storyId: string;

beforeAll(async () => {
	if (!existsSync(bundle)) {
		execFileSync('node', [join(pkgDir, 'build.mjs')], {stdio: 'pipe'});
	}
	store = await spawnStore();
	work = mkdtempSync(join(tmpdir(), 'twine-cli-new-'));

	const created = cli(['new', '--name', 'Ridge Signal']);

	storyId = /([0-9a-f-]{36})/.exec(created)![1];

	// A 1x1 webp standing in for artwork: the point is the manifest row and the blob, not
	// the pixels.
	const art = join(work, 'ridge.webp');

	writeFileSync(
		art,
		Buffer.from(
			'UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA==',
			'base64'
		)
	);
	cli(['put', `${storyId}:ridge-dusk`, art, '--kind', 'bg']);

	// The story starts with one untitled passage; rename it by editing the receipt, then
	// add the rest with --new.
	const start = join(work, 'start.md');

	cli(['cat', `${storyId}/Untitled Passage`, '-o', start]);
	writeFileSync(
		start,
		readFileSync(start, 'utf8')
			.replace('name: Untitled Passage', 'name: Ridge')
			.replace(/\n---\n[\s\S]*$/, `\n---\n${RIDGE}`)
	);
	cli(['put', `${storyId}/Untitled Passage`, start]);

	cli(['put', `${storyId}/Descent`, write('descent.txt', DESCENT), '--new']);
	cli(['put', `${storyId}/Signal Fire`, write('signal.txt', SIGNAL), '--new']);
	cli(['put', `${storyId}/Nightfall`, write('night.txt', 'Waiting costs the night.\n'), '--new']);
	cli(['put', `${storyId}/The Cave`, write('cave.txt', 'Cold air off the stone.\n'), '--new']);
	cli(['put', `${storyId}/The Riverbed`, write('river.txt', 'Dry stones, one boot print.\n'), '--new']);
	cli(['put', `${storyId}/The Answer`, write('answer.txt', 'A second flame answers.\n'), '--new']);
}, 300_000);

afterAll(() => {
	store?.stop();
	if (work) {
		rmSync(work, {force: true, recursive: true});
	}
});

it('produces a body the editor can open', async () => {
	const body = await api(`/stories/${storyId}`);

	// The fields the editor reads before it draws anything.
	expect(body.ifid).toMatch(/^[0-9A-F-]{36}$/);
	expect(body.storyFormat).toBeTruthy();
	expect(typeof body.zoom).toBe('number');
	expect(body.startPassage).toBeTruthy();
	expect(body.passages.some((p: {id: string}) => p.id === body.startPassage)).toBe(true);
});

it('has every passage the CLI created, each with a position', async () => {
	const body = await api(`/stories/${storyId}`);
	const names = body.passages.map((p: {name: string}) => p.name).sort();

	expect(names).toEqual(
		['Descent', 'Nightfall', 'Ridge', 'Signal Fire', 'The Answer', 'The Cave', 'The Riverbed'].sort()
	);

	// Passages stacked at the origin are technically valid and unusable.
	const seen = new Set<string>();

	for (const passage of body.passages) {
		expect(typeof passage.left).toBe('number');
		expect(typeof passage.top).toBe('number');
		expect(passage.story).toBe(storyId);
		expect(seen.has(`${passage.left},${passage.top}`)).toBe(false);
		seen.add(`${passage.left},${passage.top}`);
	}
});

it('kept the scene text exactly as written', async () => {
	const body = await api(`/stories/${storyId}`);
	const ridge = body.passages.find((p: {name: string}) => p.name === 'Ridge');

	expect(ridge.text).toBe(RIDGE);
});

it('has three decision points, one of them three-way', () => {
	const graph = cli(['graph', storyId, '--format', 'jsonl'])
		.trim()
		.split('\n')
		.map(line => JSON.parse(line) as {passage: string; links: string[]});

	const branching = graph.filter(node => node.links.length >= 2);

	expect(branching).toHaveLength(3);
	expect(branching.some(node => node.passage === 'Ridge' && node.links.length === 3)).toBe(true);
});

it('uploaded the art and wired it into the manifest', async () => {
	const manifest = await api(`/stories/${storyId}/assets`);
	const row = manifest.assets.find((asset: {name: string}) => asset.name === 'ridge-dusk');

	expect(row).toBeDefined();
	expect(row.kind).toBe('bg');
	expect(manifest.missing).toEqual([]);

	// And the scene's reference resolves to it.
	const resolved = cli(['assets', storyId, '--scene', 'ridge-dusk', '--json'])
		.trim()
		.split('\n')
		.map(line => JSON.parse(line) as {via: string; present: string; id: string});

	expect(resolved.find(entry => entry.via === 'bg:')).toMatchObject({
		id: row.id,
		present: 'present'
	});
});

it('lints clean', () => {
	expect(cli(['lint', storyId])).toContain('0 errors');
});

it('refuses to create a passage that already exists', () => {
	const out = cli(
		['put', `${storyId}/Descent`, write('dupe.txt', 'again\n'), '--new'],
		{expectFail: true}
	);

	expect(out).toMatch(/^EXIT 2/);
});
