/** @jest-environment node */
/**
 * End-to-end: copy a story, then modify the copy, against a real server.
 *
 * The two failure modes this is here to catch are the ones a unit test cannot see. A copy
 * that shares an id, an ifid or a passage id with its source looks fine until two of them
 * are open at once; and a `put` that rebuilds the body rather than splicing one passage
 * silently reverts whatever else moved. Both need a store with rev bookkeeping in it, so
 * this drives the built CLI against a spawned one.
 */
import {execFileSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join, resolve} from 'node:path';
import {spawnStore, type Store} from '../test-support/spawn-store';

const pkgDir = resolve(__dirname, '../..');
const bundle = join(pkgDir, 'dist/twine-cli.mjs');

jest.setTimeout(300_000);

let store: Store;
let work: string;

/** The scene block is deliberately commented and oddly spaced: `put` must not reflow it. */
const RIDGE = `Dust, and something burning below.

[scene]
id: ridge-dusk
bg: ridge                       # asset id, never a path
camera: {at: [0, 0], zoom: 0.9}
cast:
  scout: {at: -0.35, frame: idle}
beats:
  - scout: "Three ways down."
  - mark: choosing
links:
  descend: {to: Descent}
  wait:    {to: Descent, transition: fade}
`;

const DESCENT = `Scree, then a crack in the rock.

[scene]
id: descent
from: ridge-dusk@choosing
beats:
  - scout: "Cave, or the riverbed."
links:
  back: {to: Ridge}
`;

function story() {
	return {
		id: '11111111-1111-4111-8111-111111111111',
		ifid: 'AAAAAAAA-1111-4111-8111-111111111111',
		name: 'Ridge Fixture',
		lastUpdate: '2026-08-22T00:00:00.000Z',
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: 'p-ridge',
		storyFormat: 'Sliders',
		storyFormatVersion: '2.3.1',
		stylesheet: '',
		tags: [],
		tagColors: {},
		zoom: 1,
		passages: [
			{
				id: 'p-ridge',
				story: '11111111-1111-4111-8111-111111111111',
				name: 'Ridge',
				tags: ['act1'],
				text: RIDGE,
				left: 100,
				top: 100,
				width: 100,
				height: 100,
				highlighted: false,
				selected: false
			},
			{
				id: 'p-descent',
				story: '11111111-1111-4111-8111-111111111111',
				name: 'Descent',
				tags: [],
				text: DESCENT,
				left: 300,
				top: 100,
				width: 100,
				height: 100,
				highlighted: false,
				selected: false
			}
		]
	};
}

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
				// Without this the config would find the checkout's own server/.env and read
				// the developer's real store.
				TWINE_DATA: store.dataDir,
				HOME: work
			}
		});
	} catch (error) {
		if (opts.expectFail) {
			const e = error as {status: number; stdout: string; stderr: string};

			return `EXIT ${e.status}\n${e.stdout}${e.stderr}`;
		}
		throw error;
	}
}

async function api(path: string, init: RequestInit = {}) {
	const response = await fetch(`${store.url}/api/v1${path}`, {
		...init,
		headers: {
			authorization: `Bearer ${store.token}`,
			'content-type': 'application/json',
			...(init.headers ?? {})
		}
	});

	if (!response.ok) {
		throw new Error(`${path} -> ${response.status} ${await response.text()}`);
	}
	return response.json();
}

beforeAll(async () => {
	if (!existsSync(bundle)) {
		execFileSync('node', [join(pkgDir, 'build.mjs')], {stdio: 'pipe'});
	}
	store = await spawnStore();
	work = mkdtempSync(join(tmpdir(), 'twine-cli-work-'));

	await api(`/stories/${story().id}`, {
		method: 'PUT',
		body: JSON.stringify({story: story(), client: 'fixture'})
	});
}, 300_000);

afterAll(() => {
	store?.stop();
	if (work) {
		rmSync(work, {force: true, recursive: true});
	}
});

describe('copy', () => {
	let copyId: string;

	beforeAll(() => {
		const out = cli(['copy', 'ridge-fixture', '--name', 'Ridge Copy', '--reid', 'c-']);
		const match = /([0-9a-f-]{36})/.exec(out);

		expect(match).not.toBeNull();
		copyId = match![1];
	});

	it('gives the copy its own identity', async () => {
		const source = story();
		const copy = (await api(`/stories/${copyId}`)) as typeof source;

		expect(copy.id).not.toBe(source.id);
		expect(copy.ifid).not.toBe(source.ifid);
		expect(copy.name).toBe('Ridge Copy');

		const sourceIds = source.passages.map(p => p.id);

		for (const passage of copy.passages) {
			expect(sourceIds).not.toContain(passage.id);
			// A passage still pointing at the old story is the bug this catches.
			expect(passage.story).toBe(copy.id);
		}
	});

	it('carries names, tags and positions across untouched', async () => {
		const source = story();
		const copy = (await api(`/stories/${copyId}`)) as typeof source;

		for (const original of source.passages) {
			const twin = copy.passages.find(p => p.name === original.name)!;

			expect(twin).toBeDefined();
			expect(twin.tags).toEqual(original.tags);
			expect(twin.left).toBe(original.left);
			expect(twin.top).toBe(original.top);
		}
	});

	it('rewrites scene ids and every reference to them together', async () => {
		const copy = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;
		const ridge = copy.passages.find(p => p.name === 'Ridge')!;
		const descent = copy.passages.find(p => p.name === 'Descent')!;

		expect(ridge.text).toContain('id: c-ridge-dusk');
		expect(descent.text).toContain('id: c-descent');
		// The @mark must survive the rename, and point at the renamed scene.
		expect(descent.text).toContain('from: c-ridge-dusk@choosing');
		expect(descent.text).not.toContain('from: ridge-dusk@choosing');
	});

	it('changes nothing else in the text — comments and spacing included', async () => {
		const copy = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;
		const ridge = copy.passages.find(p => p.name === 'Ridge')!;

		expect(ridge.text).toBe(RIDGE.replace('id: ridge-dusk', 'id: c-ridge-dusk'));
	});

	it('leaves the source story alone', async () => {
		const source = (await api(`/stories/${story().id}`)) as ReturnType<typeof story>;

		expect(source.passages.find(p => p.name === 'Ridge')!.text).toBe(RIDGE);
		expect((await api('/stories')).stories.find((s: {id: string}) => s.id === story().id).rev).toBe(1);
	});

	it('starts the copy at rev 1 with its own history', async () => {
		const revisions = await api(`/stories/${copyId}/revisions`);

		expect(revisions.current).toBe(1);
	});
});

describe('modify the copy', () => {
	let copyId: string;
	let file: string;

	beforeAll(async () => {
		const out = cli(['copy', 'ridge-fixture', '--name', 'Ridge Edit']);

		copyId = /([0-9a-f-]{36})/.exec(out)![1];
		file = join(work, 'ridge.md');
		cli(['cat', `${copyId}/Ridge`, '-o', file]);
	});

	it('hands out the passage text verbatim under a receipt', () => {
		const text = readFileSync(file, 'utf8');
		const body = text.slice(text.indexOf('\n---\n', 4) + 5);

		expect(body).toBe(RIDGE);
		expect(text).toContain(`story: ${copyId}`);
		expect(text).toContain('passage: Ridge');
		expect(text).toMatch(/rev: \d+/);
		expect(text).toMatch(/hash: [0-9a-f]{64}/);
	});

	it('writes the edit back and bumps the rev', async () => {
		const before = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;

		writeFileSync(file, readFileSync(file, 'utf8').replace('zoom: 0.9', 'zoom: 1.25'));
		cli(['put', `${copyId}/Ridge`, file]);

		const after = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;

		expect(after.passages.find(p => p.name === 'Ridge')!.text).toContain('zoom: 1.25');
		// Everything else in the passage survived the splice.
		expect(after.passages.find(p => p.name === 'Ridge')!.text).toBe(
			before.passages.find(p => p.name === 'Ridge')!.text.replace('zoom: 0.9', 'zoom: 1.25')
		);
	});

	it('touches only the passage it was given', async () => {
		const after = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;

		expect(after.passages.find(p => p.name === 'Descent')!.text).toBe(DESCENT);
		expect(after.passages).toHaveLength(2);
	});

	it('refuses a stale write of the same passage', async () => {
		// The receipt in `file` is now a rev behind, and its passage has changed.
		const out = cli(['put', `${copyId}/Ridge`, file], {expectFail: true});

		expect(out).toMatch(/^EXIT 3/);
	});

	it('still accepts a write when a different passage moved underneath it', async () => {
		const fresh = join(work, 'ridge-fresh.md');

		cli(['cat', `${copyId}/Ridge`, '-o', fresh]);

		// Someone else edits Descent while we hold Ridge.
		const body = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;
		const rev = (await api('/stories')).stories.find((s: {id: string}) => s.id === copyId).rev;

		body.passages.find(p => p.name === 'Descent')!.text = DESCENT + '\nlater\n';
		await api(`/stories/${copyId}`, {
			method: 'PUT',
			body: JSON.stringify({story: body, client: 'someone-else'}),
			headers: {'if-match': `"${rev}"`}
		});

		writeFileSync(fresh, readFileSync(fresh, 'utf8').replace('Three ways down.', 'Two ways down.'));
		cli(['put', `${copyId}/Ridge`, fresh]);

		const after = (await api(`/stories/${copyId}`)) as ReturnType<typeof story>;

		expect(after.passages.find(p => p.name === 'Ridge')!.text).toContain('Two ways down.');
		// The other edit is still there: the splice rebased onto it rather than over it.
		expect(after.passages.find(p => p.name === 'Descent')!.text).toContain('later');
	});
});
