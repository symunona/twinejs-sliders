import {Browser, expect, Page, test} from '@playwright/test';
import {strFromU8, unzipSync} from 'fflate';
import {copyFileSync, mkdirSync, readFileSync} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	BASE_URL,
	closeDialogs,
	createStory,
	openPassage,
	openStory,
	setPassageText,
	setStoryFormat,
	shot,
	skipWelcome
} from './sliders-helpers';

/**
 * The `.sliders.zip` round trip (spec 08).
 *
 * The point of the feature is that a story and the art it names travel together, so this
 * exercises the whole loop through the real UI: upload -> author a `[scene]` -> Build tab
 * -> "Export With Assets" -> unzip and inspect -> import into a library that has never
 * seen those bytes -> the preview draws the actual picture.
 *
 * Every context here is a fresh one. The asset library is one store per origin, so
 * "somewhere that has never seen this art" cannot be faked by deleting rows; a new
 * BrowserContext gets its own OPFS, IndexedDB and localStorage, which is both cleaner and
 * closer to what the feature is for (another machine).
 */

test.describe.configure({mode: 'serial'});

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const fixture = (name: string) => path.join(FIXTURES, name);

const SCRATCH =
	process.env.SLIDERS_E2E_SCRATCH ??
	path.join(os.tmpdir(), 'sliders-bundle-e2e');

const STORY_NAME = 'Bundle Round Trip';

/**
 * Minimal but real: `bg:` is the one ref that must resolve by NAME rather than id, which
 * is the whole reason clashes cannot be renamed away on import.
 */
const SCENE_TEXT = `[scene]
id: tavern
bg: tavern-night
`;

/** Where the exported zip lands. Written by the first test, read by the second. */
const bundlePath = path.join(SCRATCH, `${STORY_NAME}.sliders.zip`);

async function clearAssetLibrary(page: Page) {
	await page.goto(BASE_URL);
	await page.evaluate(async () => {
		if (navigator.storage?.getDirectory) {
			const root = await navigator.storage.getDirectory();

			await root
				.removeEntry('sliders-assets', {recursive: true})
				.catch(() => undefined);
		}

		indexedDB.deleteDatabase('sliders-assets');
	});
}

async function openAssetManager(page: Page) {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await expect(page.getByRole('dialog', {name: 'Assets'})).toBeVisible();
}

/** The file input is visually hidden, so set files on it directly. */
async function uploadInto(page: Page, dialogName: string, files: string[]) {
	await page
		.getByRole('dialog', {name: dialogName})
		.locator('input[type="file"]')
		.setInputFiles(files);
}

/**
 * A context that has never seen this origin before — no stories, no assets.
 *
 * `clearAssetLibrary` still runs because OPFS survives longer than one might expect when
 * a previous run left the browser's profile behind.
 */
async function freshContext(browser: Browser) {
	const context = await browser.newContext({acceptDownloads: true});
	const page = await context.newPage();

	await clearAssetLibrary(page);
	return {context, page};
}

/**
 * The intrinsic size of the picture the preview actually decoded.
 *
 * This is the assertion that cannot be satisfied by a dialog saying a nice thing: a
 * placeholder, a dead blob URL or a lost byte all give 0, and the two backgrounds used
 * below have deliberately different dimensions, so it also says WHICH image won a clash.
 */
async function backgroundNaturalWidth(page: Page) {
	const bg = page.getByTestId('scene-preview').locator('img.sliders-bg');

	await expect(bg).toBeVisible({timeout: 20000});
	return await bg.evaluate((image: HTMLImageElement) =>
		image.complete ? image.naturalWidth : 0
	);
}

/** Library toolbar -> Import, then hand the dialog a `.sliders.zip`. */
async function importBundle(page: Page, zipPath: string) {
	// The Library tab only exists in the story list route, so come back to it however
	// the caller left off.
	await closeDialogs(page);
	await skipWelcome(page);
	await page.getByRole('tab', {name: 'Library'}).click();
	await page.getByRole('button', {name: 'Import', exact: true}).click();

	const dialog = page.getByRole('dialog', {name: 'Import Stories'});

	await expect(dialog).toBeVisible({timeout: 10000});

	// "Upload a Bundle" is an UploadButton, not a FileInput -- a zip is binary and
	// FileInput only does readAsText. Its input is visually hidden like every other
	// uploader in the app, so target it by accept rather than by clicking the label.
	await dialog
		.locator('input[type="file"][accept=".zip"]')
		.setInputFiles(zipPath);

	return dialog;
}

test.describe('Sliders bundle export and import', () => {
	test.beforeAll(() => {
		mkdirSync(SCRATCH, {recursive: true});
	});

	test('exports a story with its art and imports it into an empty library', async ({
		browser
	}) => {
		// Two full library loads plus a WebP transcode per asset.
		test.setTimeout(300000);

		const {context, page} = await freshContext(browser);

		await createStory(page, STORY_NAME);
		await setStoryFormat(page, 'Sliders');
		await closeDialogs(page);

		// street-dusk is the control: it is in the library and the story never names it,
		// so it must NOT be in the zip. A 40 MB library must not follow a one-scene story.
		await openAssetManager(page);
		await uploadInto(page, 'Assets', [
			fixture('tavern-night.png'),
			fixture('street-dusk.png')
		]);
		await expect(
			page.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toBeVisible({timeout: 25000});
		await expect(
			page.locator('.sliders-tile', {hasText: 'street-dusk'})
		).toBeVisible({timeout: 25000});
		await closeDialogs(page);

		await openPassage(page, 'Untitled Passage');
		await setPassageText(page, SCENE_TEXT);

		// Sanity: the art resolves here, so anything missing after the round trip was lost
		// by the bundle rather than never present.
		expect(await backgroundNaturalWidth(page)).toBe(1280);
		await closeDialogs(page);

		await page.getByRole('tab', {name: 'Build'}).click();

		const [download] = await Promise.all([
			page.waitForEvent('download', {timeout: 60000}),
			page.getByRole('button', {name: 'Export With Assets'}).click()
		]);

		expect(download.suggestedFilename()).toBe(`${STORY_NAME}.sliders.zip`);
		await download.saveAs(bundlePath);
		await shot(page, 'bundle-01-exported');
		await context.close();

		// --- the zip itself ------------------------------------------------
		const entries = unzipSync(new Uint8Array(readFileSync(bundlePath)));
		const names = Object.keys(entries);

		expect(names).toEqual(
			expect.arrayContaining(['sliders.json', 'story.json', 'story.html'])
		);

		const manifest = JSON.parse(strFromU8(entries['sliders.json']));

		expect(manifest.format).toBe('sliders-bundle');
		expect(manifest.version).toBe(1);
		expect(manifest.story.name).toBe(STORY_NAME);
		expect(manifest.unresolved).toEqual([]);

		const bundledNames = manifest.assets.map(
			(asset: {name: string}) => asset.name
		);

		expect(bundledNames).toContain('tavern-night');
		expect(bundledNames).not.toContain('street-dusk');
		expect(manifest.assets).toHaveLength(1);

		// The manifest must never promise a zip entry that is absent.
		const file = manifest.assets[0].file as string;

		expect(names).toContain(file);
		expect(entries[file].byteLength).toBeGreaterThan(0);

		// story.json is what import reads, so it has to carry the passage the scene is in.
		const story = JSON.parse(strFromU8(entries['story.json']));

		expect(story.name).toBe(STORY_NAME);
		expect(
			story.passages.some((passage: {text: string}) =>
				passage.text.includes('bg: tavern-night')
			)
		).toBe(true);

		// --- import somewhere that has never seen this art -------------------
		const second = await freshContext(browser);
		const dialog = await importBundle(second.page, bundlePath);

		await expect(dialog.locator('.bundle-report')).toBeVisible({
			timeout: 30000
		});
		await expect(dialog.locator('.bundle-report')).toContainText(
			'1 asset(s) will be added to your library.'
		);
		await shot(second.page, 'bundle-02-import-report');

		await dialog
			.getByRole('button', {name: 'Add These Assets and Import'})
			.click();
		await expect(dialog).toBeHidden({timeout: 30000});

		await openStory(second.page, STORY_NAME);
		await openPassage(second.page, 'Untitled Passage');

		// The art really came back: the browser decoded 1280x720 of real pixels, and no
		// placeholder stood in for it.
		expect(await backgroundNaturalWidth(second.page)).toBe(1280);
		await expect(
			second.page.getByTestId('scene-preview').locator('.sliders-placeholder')
		).toHaveCount(0);
		await shot(second.page, 'bundle-03-imported-art');

		// And it kept its name, which is what every `bg:` in the story resolves against.
		await closeDialogs(second.page);
		await openAssetManager(second.page);
		await expect(
			second.page.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toHaveCount(1, {timeout: 25000});
		await expect(
			second.page.locator('.sliders-tile', {hasText: 'street-dusk'})
		).toHaveCount(0);
		await second.context.close();
	});

	test('keeps the local image when a bundle clashes with it by name', async ({
		browser
	}) => {
		test.setTimeout(180000);

		// A different picture under the same name. Different DIMENSIONS on purpose: after
		// the import, the number the browser decodes says which bytes are stored, and no
		// amount of correct-looking metadata can fake it.
		const impostor = path.join(SCRATCH, 'tavern-night.png');

		copyFileSync(fixture('table.png'), impostor);

		const {context, page} = await freshContext(browser);

		await createStory(page, 'Clash Local Library');
		await openAssetManager(page);
		await uploadInto(page, 'Assets', [impostor]);
		await expect(
			page.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toBeVisible({timeout: 25000});
		await expect(
			page
				.locator('.sliders-tile', {hasText: 'tavern-night'})
				.locator('.sliders-tile-detail')
		).toContainText('640×300');
		await closeDialogs(page);

		const dialog = await importBundle(page, bundlePath);

		await expect(dialog.locator('.bundle-report')).toBeVisible({
			timeout: 30000
		});

		// The lossy outcome has to be loud: renaming the incoming asset would silently
		// repoint the scenes of the story arriving with it, so the bundle's copy is
		// dropped instead and the author is told which name it was.
		await expect(dialog.locator('.bundle-report')).toContainText(
			'clash by name with a different picture'
		);
		await expect(dialog.locator('.bundle-warnings')).toContainText(
			'tavern-night'
		);
		await expect(dialog.locator('.bundle-report')).not.toContainText(
			'will be added to your library'
		);
		await shot(page, 'bundle-04-clash-report');

		await dialog
			.getByRole('button', {name: 'Add These Assets and Import'})
			.click();
		await expect(dialog).toBeHidden({timeout: 30000});

		// Still one asset under that name, and still the local one.
		await openStory(page, 'Clash Local Library');
		await openAssetManager(page);

		const tile = page.locator('.sliders-tile', {hasText: 'tavern-night'});

		await expect(tile).toHaveCount(1, {timeout: 25000});
		await expect(tile.locator('.sliders-tile-detail')).toContainText('640×300');
		await closeDialogs(page);

		// The imported story now renders the local artwork under the name it asked for --
		// wrong pixels, working refs. That is the documented trade, so assert on it.
		// Back to the library first: `openStory` short-circuits when a story is already
		// open, and the one open here is the wrong one.
		await page.goto(BASE_URL);
		await openStory(page, STORY_NAME);
		await openPassage(page, 'Untitled Passage');
		expect(await backgroundNaturalWidth(page)).toBe(640);
		await shot(page, 'bundle-05-clash-local-art-wins');
		await context.close();
	});
});
