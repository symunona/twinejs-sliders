/**
 * Harness for the two-browser server-sync suite (spec 11, "Testing → 3. Playwright, two
 * browsers").
 *
 * Two things make this layer worth having, and both are in here rather than in the specs:
 *
 * - **A real Go server, one per spec file.** The binary is built once into the OS temp
 *   directory and then spawned with `--addr 127.0.0.1:0 --data <fresh tmpdir>`, so
 *   parallel spec files never share a port or a byte of state. The port is read off the
 *   first line of stdout, which `server/main.go` guarantees is `listening on host:port`.
 * - **Two browser contexts, not two pages.** `localStorage`, IndexedDB and OPFS are all
 *   per context, so two contexts are two genuinely independent editors — which is the
 *   only way to watch one see the other. Two pages in one context would share the story
 *   library and prove nothing.
 *
 * Nothing here sleeps. Everything either polls `window.__slidersSync` with `expect.poll`
 * or leans on `expect(locator)` auto-waiting. The one deliberate exception is lock
 * expiry, and even that waits on observable state rather than on a clock.
 */

import {
	Browser,
	BrowserContext,
	Locator,
	Page,
	expect,
	test as base
} from '@playwright/test';
import {ChildProcess, execFileSync, spawn} from 'node:child_process';
import * as fs from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {BASE_URL} from './sliders-helpers';

// ---------------------------------------------------------------------------
// Building and running the server
// ---------------------------------------------------------------------------

/**
 * The one shared token, 32 characters. `Config.Validate` refuses anything under 16, and
 * a fixed value keeps a failed run reproducible by hand:
 *
 *     AUTH_TOKEN=sliders-e2e-shared-token-32chars go run . --addr 127.0.0.1:9099
 */
export const AUTH_TOKEN = 'sliders-e2e-shared-token-32chars';

/** The image fixtures the bundle suite already uses. Real bytes, known dimensions. */
export const ASSET_FIXTURES = path.join(__dirname, 'fixtures', 'assets');
export const assetFixture = (name: string) => path.join(ASSET_FIXTURES, name);

const GO = process.env.SLIDERS_GO ?? '/home/ignotas/.local/go/bin/go';
const SERVER_DIR = path.join(__dirname, '..', 'server');
const BUILD_DIR = path.join(os.tmpdir(), 'sliders-server-e2e');
const BINARY = path.join(BUILD_DIR, 'twine-store');

let buildPromise: string | undefined;

/**
 * `go build` the server, once.
 *
 * Workers are separate processes, so the module-level memo only covers one of them; the
 * rest are made safe by building to a private path and `rename`-ing it into place, which
 * is atomic. Go's build cache makes every build after the first take about a second.
 */
export function buildServer(): string {
	if (buildPromise) {
		return buildPromise;
	}

	fs.mkdirSync(BUILD_DIR, {recursive: true});

	const scratch = `${BINARY}.${process.pid}`;

	try {
		execFileSync(GO, ['build', '-o', scratch, '.'], {
			cwd: SERVER_DIR,
			stdio: 'pipe'
		});
		fs.renameSync(scratch, BINARY);
	} catch (error) {
		const detail =
			error && typeof error === 'object' && 'stderr' in error
				? String((error as {stderr?: Buffer}).stderr ?? '')
				: String(error);

		throw new Error(
			`Could not build the story server with ${GO}:\n${detail}\n` +
				'Set SLIDERS_GO if the Go toolchain lives somewhere else.'
		);
	}

	buildPromise = BINARY;
	return BINARY;
}

export interface StoryIndexRow {
	id: string;
	ifid: string;
	name: string;
	rev: number;
	updatedAt: string;
	lastClient: string;
	passageCount: number;
	bytes: number;
	assetCount: number;
	assetBytes: number;
	deleted: boolean;
}

/**
 * One `twine-story-store` process and its data directory.
 *
 * `stop()` and `start()` are separate from `dispose()` on purpose: story 12 kills the
 * server mid-edit and brings it back on the same port and the same data, which is the
 * only honest way to test that a parked push flushes.
 */
export class TestServer {
	readonly token = AUTH_TOKEN;
	readonly dataDir: string;

	private child?: ChildProcess;
	private boundPort = 0;
	private stderr = '';

	constructor(dataDir: string) {
		this.dataDir = dataDir;
	}

	get port(): number {
		return this.boundPort;
	}

	get url(): string {
		return `http://127.0.0.1:${this.boundPort}`;
	}

	get running(): boolean {
		return !!this.child && this.child.exitCode === null && !this.child.killed;
	}

	async start(): Promise<void> {
		if (this.running) {
			return;
		}

		fs.mkdirSync(this.dataDir, {recursive: true});

		const binary = buildServer();
		const child = spawn(
			binary,
			[
				'--addr',
				`127.0.0.1:${this.boundPort}`,
				'--data',
				this.dataDir,
				// An explicit missing path, so a stray .env in the working directory
				// cannot change what the suite is testing. Missing is not an error.
				'--env',
				path.join(this.dataDir, 'no-such.env')
			],
			{
				env: {
					...process.env,
					AUTH_TOKEN,
					// The editor is served from localhost:5173 and the API from
					// 127.0.0.1:<port>, so every request is cross-origin and preflighted.
					CORS_ORIGINS: '*'
				},
				stdio: ['ignore', 'pipe', 'pipe']
			}
		);

		this.child = child;
		this.stderr = '';
		child.stderr?.on('data', chunk => {
			this.stderr = (this.stderr + String(chunk)).slice(-4000);
		});

		this.boundPort = await new Promise<number>((resolve, reject) => {
			let buffer = '';
			const timer = setTimeout(
				() =>
					reject(
						new Error(
							`Server did not announce a port within 15s.\n${this.stderr}`
						)
					),
				15000
			);

			const done = (fn: () => void) => {
				clearTimeout(timer);
				child.stdout?.off('data', onData);
				fn();
			};

			const onData = (chunk: Buffer) => {
				buffer += String(chunk);

				const match = /listening on [^\s:]+:(\d+)/.exec(buffer);

				if (match) {
					done(() => resolve(Number(match[1])));
				}
			};

			child.stdout?.on('data', onData);
			child.once('error', error => done(() => reject(error)));
			child.once('exit', code =>
				done(() =>
					reject(
						new Error(`Server exited with code ${code}.\n${this.stderr}`)
					)
				)
			);
		});

		// Bound is not the same as answering. One health check turns a mysterious
		// timeout in the first test into a clear failure here.
		await expect
			.poll(async () => (await this.probe('/api/v1/health'))?.ok ?? false, {
				message: 'server never answered /health',
				timeout: 10000
			})
			.toBe(true);
	}

	/** SIGTERM by default; `force` is SIGKILL, which is what a crash looks like. */
	async stop(options: {force?: boolean} = {}): Promise<void> {
		const child = this.child;

		this.child = undefined;

		if (!child || child.exitCode !== null) {
			return;
		}

		await new Promise<void>(resolve => {
			const hard = setTimeout(() => child.kill('SIGKILL'), 3000);

			child.once('exit', () => {
				clearTimeout(hard);
				resolve();
			});
			child.kill(options.force ? 'SIGKILL' : 'SIGTERM');
		});
	}

	async ensureRunning(): Promise<void> {
		if (!this.running) {
			await this.start();
		}
	}

	async dispose(): Promise<void> {
		await this.stop({force: true});
		fs.rmSync(this.dataDir, {force: true, recursive: true});
	}

	/** A request that carries the token, from the test process rather than the browser. */
	async api(apiPath: string, init: RequestInit = {}): Promise<Response> {
		return fetch(`${this.url}${apiPath}`, {
			...init,
			headers: {
				Authorization: `Bearer ${this.token}`,
				'X-Client-Id': 'playwright',
				'X-Client-Name': 'playwright',
				...(init.headers ?? {})
			}
		});
	}

	private async probe(apiPath: string): Promise<Response | undefined> {
		try {
			return await fetch(`${this.url}${apiPath}`);
		} catch {
			return undefined;
		}
	}

	/** The server's own view of the library. Used to check claims the UI makes. */
	async stories(): Promise<StoryIndexRow[]> {
		const response = await this.api('/api/v1/stories');

		expect(response.status, 'GET /stories').toBe(200);

		const body = (await response.json()) as {stories: StoryIndexRow[]};

		return body.stories ?? [];
	}

	async storyNamed(name: string): Promise<StoryIndexRow | undefined> {
		return (await this.stories()).find(story => story.name === name);
	}

	/**
	 * Erase every story, tombstones included.
	 *
	 * The server is worker scoped, so without this a story published by one test would
	 * turn up as a ghost in the next one. `?purge=1` removes the directory rather than
	 * tombstoning, which is exactly "this run never happened".
	 */
	async purgeAll(): Promise<void> {
		for (const story of await this.stories()) {
			await this.api(`/api/v1/stories/${story.id}?purge=1`, {
				method: 'DELETE'
			});
		}
	}
}

// ---------------------------------------------------------------------------
// Editors
// ---------------------------------------------------------------------------

export interface Editor {
	readonly name: string;
	readonly clientId: string;
	readonly context: BrowserContext;
	readonly page: Page;
	close(): Promise<void>;
}

export interface EditorOptions {
	/** Distinct per editor: it is how presence and locks tell two browsers apart. */
	clientId?: string;
	autosave?: boolean;
	/** How long the push queue waits after a keystroke. 50ms, not the shipped 5s. */
	debounceMs?: number;
}

/**
 * Prefs, written the way `local-storage/prefs/load.ts` reads them: an index key listing
 * ids, and one JSON blob per pref. Seeded through `addInitScript` so they are in place
 * before the first line of app code runs — dispatching them through the UI would mean
 * every test paid for the prefs dialog, and the one spec that does use the dialog is the
 * point of `server-prefs.spec.ts`.
 */
async function seedPrefs(
	context: BrowserContext,
	prefs: Record<string, unknown>,
	debounceMs: number
): Promise<void> {
	await context.addInitScript(
		({debounce, values}) => {
			try {
				const ids: string[] = [];

				Object.entries(values).forEach(([name, value], index) => {
					const id = `e2e-pref-${index}`;

					ids.push(id);
					window.localStorage.setItem(
						`twine-prefs-${id}`,
						JSON.stringify({id, name, value})
					);
				});

				window.localStorage.setItem('twine-prefs', ids.join(','));
				window.localStorage.setItem(
					'sliders.sync.debounceMs',
					String(debounce)
				);
			} catch {
				// A context with storage disabled is not a case this suite covers.
			}
		},
		{debounce: debounceMs, values: prefs}
	);
}

/**
 * Make every websocket this context opens killable from a test.
 *
 * Playwright 1.45 has no `page.routeWebSocket`, and `context.route` never sees an
 * upgrade, so "the socket is down" has to be arranged inside the page. Blocked sockets
 * are pointed at a closed loopback port, which fails the way a dead server does rather
 * than throwing somewhere the app has no handler for.
 */
async function installWebSocketSwitch(context: BrowserContext): Promise<void> {
	await context.addInitScript(() => {
		const Native = window.WebSocket;
		const live: WebSocket[] = [];

		(window as unknown as {__e2eSockets: WebSocket[]}).__e2eSockets = live;

		class SwitchableWebSocket extends Native {
			constructor(url: string | URL, protocols?: string | string[]) {
				let blocked = false;

				try {
					blocked =
						window.localStorage.getItem('sliders.e2e.blockWebSocket') === '1';
				} catch {
					blocked = false;
				}

				super(blocked ? 'ws://127.0.0.1:1/e2e-blocked' : url, protocols);
				live.push(this);
			}
		}

		window.WebSocket = SwitchableWebSocket as unknown as typeof WebSocket;
	});
}

export async function openEditor(
	browser: Browser,
	server: TestServer,
	name: string,
	options: EditorOptions = {}
): Promise<Editor> {
	const clientId =
		options.clientId ??
		`${name}-0000-4000-8000-${name.padEnd(12, '0').slice(0, 12)}`;
	const context = await browser.newContext();

	await seedPrefs(
		context,
		{
			backendAutosave: options.autosave ?? true,
			backendClientId: clientId,
			backendToken: server.token,
			backendUrl: server.url,
			backendUsername: name,
			// Nothing in this suite is about the donation prompt or the welcome route,
			// and both of them cover the toolbar.
			donateShown: true,
			welcomeSeen: true
		},
		options.debounceMs ?? 50
	);
	await installWebSocketSwitch(context);

	const page = await context.newPage();

	await page.goto(BASE_URL);
	await waitForLibrary(page);

	let closed = false;

	return {
		clientId,
		close: async () => {
			if (closed) {
				return;
			}

			closed = true;
			await context.close();
		},
		context,
		name,
		page
	};
}

/** Cut this editor off from the API and close the socket it already has. */
export async function goOffline(editor: Editor): Promise<void> {
	await editor.context.route('**/api/v1/**', route => route.abort('failed'));
	await editor.page.evaluate(() => {
		try {
			window.localStorage.setItem('sliders.e2e.blockWebSocket', '1');
		} catch {
			// ignore
		}

		const sockets = (window as unknown as {__e2eSockets?: WebSocket[]})
			.__e2eSockets;

		sockets?.forEach(socket => socket.close());
	});
}

export async function goOnline(editor: Editor): Promise<void> {
	await editor.context.unroute('**/api/v1/**');
	await editor.page.evaluate(() => {
		try {
			window.localStorage.removeItem('sliders.e2e.blockWebSocket');
		} catch {
			// ignore
		}
	});
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface WorkerFixtures {
	server: TestServer;
}

interface TestFixtures {
	alice: Editor;
	bob: Editor;
	/** Auto: every test starts against a running server with an empty library. */
	freshServer: void;
}

export const test = base.extend<TestFixtures, WorkerFixtures>({
	alice: async ({browser, server}, use) => {
		const editor = await openEditor(browser, server, 'alice');

		await use(editor);
		await editor.close();
	},
	bob: async ({browser, server}, use) => {
		const editor = await openEditor(browser, server, 'bob');

		await use(editor);
		await editor.close();
	},
	freshServer: [
		async ({server}, use) => {
			await server.ensureRunning();
			await server.purgeAll();
			await use();
		},
		{auto: true}
	],
	server: [
		async ({}, use, workerInfo) => {
			const dataDir = fs.mkdtempSync(
				path.join(os.tmpdir(), `sliders-store-w${workerInfo.workerIndex}-`)
			);
			const server = new TestServer(dataDir);

			await server.start();
			await use(server);
			await server.dispose();
		},
		{scope: 'worker'}
	]
});

export {expect};

// ---------------------------------------------------------------------------
// Locators
// ---------------------------------------------------------------------------

/** The library card for a story, matched on its heading so no name is a prefix of another. */
export function storyCard(page: Page, name: string): Locator {
	return page
		.locator('.story-card')
		.filter({has: page.getByRole('heading', {name, exact: true})});
}

export function ghostCard(page: Page, name: string): Locator {
	return page.locator(
		`[data-testid="ghost-story-card"][data-story-name="${name}"]`
	);
}

export function syncBadge(page: Page, name: string): Locator {
	return storyCard(page, name).getByTestId('story-card-sync-badge');
}

export function passageCard(page: Page, name: string): Locator {
	return page
		.locator('.passage-card')
		.filter({has: page.getByRole('heading', {name, exact: true})});
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

export async function waitForLibrary(page: Page): Promise<void> {
	const skip = page.getByRole('button', {name: 'Skip'});
	const storyTab = page.getByRole('tab', {name: 'Story'});

	await Promise.race([
		skip.waitFor({timeout: 20000}).catch(() => undefined),
		storyTab.waitFor({timeout: 20000}).catch(() => undefined)
	]);

	if (await skip.isVisible().catch(() => false)) {
		await skip.click();
	}

	await storyTab.waitFor({timeout: 20000});
}

/** Back to the library from wherever the test left off, dialogs and all. */
export async function goToLibrary(page: Page): Promise<void> {
	await dismissDialogs(page);
	await page.goto(BASE_URL);
	await waitForLibrary(page);
}

export async function dismissDialogs(page: Page): Promise<void> {
	for (let i = 0; i < 8; i++) {
		const close = page.getByRole('button', {name: 'Close', exact: true});

		if ((await close.count()) === 0) {
			return;
		}

		await close
			.last()
			.click({timeout: 3000})
			.catch(() => undefined);
	}
}

export async function newStory(page: Page, name: string): Promise<void> {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await page
		.getByRole('textbox', {
			name: 'What should your story be named? You can change this later.'
		})
		.fill(name);
	await page.getByRole('button', {name: 'Create'}).click();
	await expect(page.getByRole('tab', {name: 'Passage'})).toBeVisible({
		timeout: 20000
	});
}

/** Select a library card, which is what enables the Story tab's buttons. */
export async function selectStory(page: Page, name: string): Promise<void> {
	await storyCard(page, name).click();
	await page.getByRole('tab', {name: 'Story'}).click();
}

export async function enterStory(page: Page, name: string): Promise<void> {
	await selectStory(page, name);
	await page.getByRole('button', {name: 'Edit', exact: true}).click();
	await page.getByRole('tab', {name: 'Passage'}).waitFor({timeout: 20000});
}

/**
 * Back to the library the way a person does it, through the toolbar's Back button.
 *
 * `goToLibrary` navigates, and a navigation throws away the push queue with the rest of
 * the page. Any test about something the queue is holding has to come back this way.
 */
export async function backToLibrary(page: Page): Promise<void> {
	await dismissDialogs(page);
	await page
		.getByRole('button', {name: /^(Back|Story Library)$/})
		.first()
		.click();
	await page.getByRole('tab', {name: 'Library'}).waitFor({timeout: 20000});
}

export async function refreshServer(page: Page): Promise<void> {
	await page.getByRole('tab', {name: 'Library'}).click();

	const button = page.getByTestId('library-refresh-server');

	await expect(button).toBeEnabled({timeout: 20000});
	await button.click();
}

export async function publishStory(page: Page, name: string): Promise<void> {
	await selectStory(page, name);
	await page.getByTestId('story-publish').click();
	await expect(syncBadge(page, name)).toBeVisible({timeout: 20000});
}

// ---------------------------------------------------------------------------
// Passages
// ---------------------------------------------------------------------------

/**
 * The text CodeMirror is actually showing.
 *
 * Read off the editor instance rather than the DOM: CodeMirror 5 only renders the lines
 * in view, so `textContent` quietly lies about anything longer than the viewport.
 */
export async function editorText(page: Page): Promise<string> {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate(
			(element: HTMLElement & {CodeMirror?: {getValue(): string}}) =>
				element.CodeMirror?.getValue() ?? ''
		);
}

/** Type into the open passage. Waits for the text to land in the editor, not on a clock. */
export async function typePassage(page: Page, text: string): Promise<void> {
	const textarea = page.locator('.CodeMirror textarea').first();

	await textarea.click({force: true});
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Delete');
	await page.keyboard.insertText(text);
	await expect.poll(() => editorText(page), {timeout: 10000}).toBe(text);
}

/**
 * Create a passage, name it and give it text, from inside the story edit route.
 *
 * Deliberately not `createPassage` from `sliders-helpers`: that one ends in a fixed 1.2s
 * sleep, and this suite waits on state instead.
 */
export async function addPassage(
	page: Page,
	name: string,
	text: string
): Promise<void> {
	const headings = page.locator('.passage-card h2');

	await page.getByRole('tab', {name: 'Passage'}).click();

	const before = await headings.allTextContents();

	await page.getByRole('button', {name: 'New', exact: true}).click();

	// `createUntitledPassage` does not select what it creates, so the new card has to be
	// found by name before anything can be done to it. Diffing the headings is the only
	// way that stays right whatever "Untitled Passage 3" happens to be called today.
	await expect.poll(async () => headings.count(), {timeout: 20000}).toBe(
		before.length + 1
	);

	const created = (await headings.allTextContents()).find(
		heading => !before.includes(heading)
	);

	if (!created) {
		throw new Error('The New button did not add a passage card');
	}

	await openPassageEditor(page, created);
	await renameOpenPassage(page, name);
	await typePassage(page, text);
}

/**
 * Rename the passage whose editor is open.
 *
 * There are several Rename buttons on screen (route toolbar, passage dialog) and the
 * route's one is disabled until a passage is selected, so this polls for one that is
 * enabled rather than reading the DOM once and giving up.
 */
export async function renameOpenPassage(
	page: Page,
	name: string
): Promise<void> {
	const renames = page.getByRole('button', {name: 'Rename'});

	await expect
		.poll(
			async () => {
				const count = await renames.count();

				for (let i = 0; i < count; i++) {
					if (await renames.nth(i).isEnabled()) {
						return true;
					}
				}

				return false;
			},
			{message: 'no enabled Rename button appeared', timeout: 20000}
		)
		.toBe(true);

	const count = await renames.count();

	for (let i = 0; i < count; i++) {
		if (await renames.nth(i).isEnabled()) {
			await renames.nth(i).click();
			break;
		}
	}

	const field = page.getByRole('textbox', {name: /be renamed to/i});

	await field.waitFor({timeout: 10000});
	await field.fill(name);
	await page.getByRole('button', {name: 'OK'}).click();
	await expect(field).toBeHidden({timeout: 10000});
}

/** Story tab → Assets, then hand the dialog real files. */
export async function uploadAssets(
	page: Page,
	files: string[]
): Promise<void> {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await expect(page.getByRole('dialog', {name: 'Assets'})).toBeVisible({
		timeout: 20000
	});
	await page
		.getByRole('dialog', {name: 'Assets'})
		.locator('input[type="file"]')
		.setInputFiles(files);
}

export async function openAssetManager(page: Page): Promise<Locator> {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();

	const dialog = page.getByRole('dialog', {name: 'Assets'});

	await expect(dialog).toBeVisible({timeout: 20000});
	return dialog;
}

/**
 * The intrinsic width of the picture the scene preview decoded.
 *
 * A stub, a dead blob URL or a lost byte all give 0, so this is the assertion a checkout
 * cannot satisfy by merely writing a manifest row.
 */
export async function previewImageWidth(page: Page): Promise<number> {
	const image = page.getByTestId('scene-preview').locator('img.sliders-bg');

	await expect(image).toBeVisible({timeout: 25000});
	return image.evaluate((element: HTMLImageElement) =>
		element.complete ? element.naturalWidth : 0
	);
}

/**
 * Add to the end of the open passage instead of replacing it.
 *
 * `typePassage` clears first, and select-all + delete + insert is *two* document changes.
 * With the suite's 50ms debounce those become two pushes and two revisions, which is fine
 * everywhere except the history test, where "how many versions did I save" is the thing
 * being counted.
 */
export async function appendPassage(page: Page, text: string): Promise<void> {
	const before = await editorText(page);

	await page.locator('.CodeMirror textarea').first().click({force: true});
	await page.keyboard.press('Control+End');
	await page.keyboard.insertText(text);
	await expect.poll(() => editorText(page), {timeout: 10000}).toBe(
		before + text
	);
}

/** Open a passage's editor from the story map. */
export async function openPassageEditor(
	page: Page,
	name: string
): Promise<void> {
	const card = page.getByRole('button', {name, exact: true});

	await card.waitFor({timeout: 20000});
	await card.click();
	await page.getByRole('tab', {name: 'Passage'}).click();
	await page.getByRole('button', {name: 'Edit', exact: true}).click();
	await expect(page.locator('.CodeMirror').first()).toBeVisible({
		timeout: 20000
	});
}

/**
 * A passage's text as it sits in `localStorage`, which is the store of record.
 *
 * The point of asking storage rather than the editor is story 12: when the server is
 * down, "local saves keep working" is a claim about the disk, not about the screen.
 */
export async function localPassageText(
	page: Page,
	passageName: string
): Promise<string | undefined> {
	return page.evaluate(name => {
		const ids = (window.localStorage.getItem('twine-passages') ?? '')
			.split(',')
			.filter(Boolean);

		for (const id of ids) {
			const raw = window.localStorage.getItem(`twine-passages-${id}`);

			if (!raw) {
				continue;
			}

			try {
				const passage = JSON.parse(raw) as {name?: string; text?: string};

				if (passage.name === name) {
					return passage.text;
				}
			} catch {
				// A corrupt row is not this suite's problem.
			}
		}

		return undefined;
	}, passageName);
}

// ---------------------------------------------------------------------------
// window.__slidersSync
// ---------------------------------------------------------------------------

export interface SyncSnapshotRecord {
	storyId: string;
	rev: number;
	state: string;
	pushedHash: string;
	lastError?: string;
}

export interface SyncSnapshot {
	connected?: boolean;
	ghosts?: {id: string; name: string; passageCount: number}[];
	records?: Record<string, SyncSnapshotRecord>;
	presence?: unknown;
}

export async function syncSnapshot(page: Page): Promise<SyncSnapshot | null> {
	return page.evaluate(
		() =>
			((window as unknown as {__slidersSync?: SyncSnapshot}).__slidersSync ??
				null) as SyncSnapshot | null
	);
}

export async function syncStateOf(
	page: Page,
	storyId: string
): Promise<string | undefined> {
	const snapshot = await syncSnapshot(page);

	return snapshot?.records?.[storyId]?.state;
}

export async function syncRevOf(
	page: Page,
	storyId: string
): Promise<number | undefined> {
	const snapshot = await syncSnapshot(page);

	return snapshot?.records?.[storyId]?.rev;
}

/**
 * Who else this editor can see in a story, according to the sync engine.
 *
 * Returns `null` when the presence layer has not published anything at all, so a spec
 * that depends on presence fails saying "presence is not exposed" rather than "expected
 * [alice], got []". Both a `{storyId: clients[]}` map and a flat `PresenceClient[]` are
 * accepted — the shape is the websocket layer's to choose.
 */
export async function presenceNames(
	page: Page,
	storyId: string,
	selfId?: string
): Promise<string[] | null> {
	return page.evaluate(
		({id, self}) => {
			const presence = (
				window as unknown as {__slidersSync?: {presence?: unknown}}
			).__slidersSync?.presence;

			if (presence === undefined || presence === null) {
				return null;
			}

			const clients = Array.isArray(presence)
				? (presence as {story?: string; id?: string; name?: string}[]).filter(
						client => client.story === id
					)
				: ((presence as Record<string, {id?: string; name?: string}[]>)[id] ??
					[]);

			return clients
				.filter(client => !self || client.id !== self)
				.map(client =>
					typeof client === 'string' ? client : (client.name ?? '')
				)
				.filter(Boolean)
				.sort();
		},
		{id: storyId, self: selfId}
	);
}

/**
 * Is the open passage editor read-only?
 *
 * Asked of the CodeMirror instance rather than of a `disabled` attribute: read-only is a
 * CodeMirror option, and a banner that says "locked" over an editor that still takes
 * keystrokes is exactly the bug this checks for.
 */
export async function editorIsReadOnly(page: Page): Promise<boolean> {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate(
			(element: HTMLElement & {CodeMirror?: {getOption(name: string): unknown}}) =>
				!!element.CodeMirror?.getOption('readOnly')
		);
}

/** Poll until a story's badge shows a state. The badge is what a person actually sees. */
export async function expectSyncState(
	page: Page,
	name: string,
	state: string,
	timeout = 20000
): Promise<void> {
	await expect(syncBadge(page, name)).toHaveAttribute(
		'data-sync-state',
		state,
		{timeout}
	);
}

/** The story body the server currently holds, whichever shape it answers in. */
export async function serverStory(
	server: TestServer,
	storyId: string
): Promise<{passages: {name: string; text: string}[]} | undefined> {
	const response = await server.api(`/api/v1/stories/${storyId}`);

	if (!response.ok) {
		return undefined;
	}

	const raw = (await response.json()) as Record<string, unknown>;

	return (raw.story ?? raw) as {passages: {name: string; text: string}[]};
}

/** The passage text the server currently holds. The last word on "did the save land". */
export async function serverPassageText(
	server: TestServer,
	storyId: string,
	passageName: string
): Promise<string | undefined> {
	const story = await serverStory(server, storyId);

	return story?.passages.find(passage => passage.name === passageName)?.text;
}
