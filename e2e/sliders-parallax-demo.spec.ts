import {expect, Page, test} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
	BASE_URL,
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/**
 * `motion:` on entities — the parallax demo (docs/sliders/demos/parallax-hills.md).
 *
 * Four tiling layers as `fit: cover` planes, each scrolling at its own speed, over a still
 * sky. What is pinned: every layer's ART runs the preset animation and has its trailing
 * copy, the layers actually move between two moments, faster ones further, and the story
 * exports with its art as a bundle that imports anywhere.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const LAYERS = [
	'parallax-sky.png',
	'parallax-clouds.png',
	'parallax-far.png',
	'parallax-mid.png',
	'parallax-near.png'
];

const OUT =
	process.env.SLIDERS_E2E_SCRATCH ?? path.join(os.tmpdir(), 'sliders-parallax-e2e');

export const PARALLAX_SCENE = `[scene]
bg: parallax-sky
props:
  clouds: {ref: parallax-clouds, fit: cover, z: -5, motion: {id: scroll_infinite_left, speed: 80}}
  far:    {ref: parallax-far, fit: cover, z: -4, motion: {id: scroll_infinite_left, speed: 40}}
  mid:    {ref: parallax-mid, fit: cover, z: -3, motion: {id: scroll_infinite_left, speed: 20}}
  near:   {ref: parallax-near, fit: cover, z: -2, motion: {id: scroll_infinite_left, speed: 8}, locked: true}
beats:
  - box: "Four layers, four speeds. The nearer, the faster."
`;

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

/** Where each layer's art is right now, px left of where it started. */
function offsets(page: Page) {
	return page.evaluate(() => {
		const out: Record<string, number> = {};

		for (const id of ['clouds', 'far', 'mid', 'near']) {
			const art = document.querySelector<HTMLElement>(
				`.sliders-entity[data-entity-id="${id}"] > .sliders-entity-art:not(.sliders-entity-art-tile)`
			);

			out[id] = art ? new DOMMatrix(getComputedStyle(art).transform).m41 : NaN;
		}

		return out;
	});
}

test('parallax demo: layers scroll at their own speeds and export as a bundle', async ({
	browser
}) => {
	test.setTimeout(300000);
	mkdirSync(OUT, {recursive: true});

	const context = await browser.newContext({acceptDownloads: true});
	const page = await context.newPage();

	await page.setViewportSize({width: 1400, height: 1000});
	await clearAssetLibrary(page);
	await createStory(page, 'Parallax Hills');
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);

	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await page
		.getByRole('dialog', {name: 'Library'})
		.locator('input[type="file"]')
		.setInputFiles(LAYERS.map(name => path.join(FIXTURES, name)));

	for (const name of LAYERS) {
		await expect(
			page.locator('.sliders-tile', {hasText: name.replace('.png', '')})
		).toBeVisible({timeout: 30000});
	}

	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, PARALLAX_SCENE);
	await showScenePreview(page);

	const near = page.locator(
		'.sliders-entity[data-entity-id="near"] > .sliders-entity-art:not(.sliders-entity-art-tile)'
	);

	await expect(near).toHaveAttribute('data-motion', 'scroll_infinite_left');
	await expect(near.locator('img')).toBeVisible({timeout: 20000});
	await expect(
		page.locator('.sliders-entity[data-entity-id="near"] > .sliders-entity-art-tile')
	).toHaveCount(1);
	expect(
		await near.evaluate(el => getComputedStyle(el).animationName)
	).toBe('sliders-bg-scroll-left');

	const first = await offsets(page);

	await page.getByTestId('scene-preview').screenshot({path: '/root/tmp/parallax-1.png'});
	await page.waitForTimeout(1500);

	const second = await offsets(page);

	await page.getByTestId('scene-preview').screenshot({path: '/root/tmp/parallax-2.png'});

	const moved = (id: string) => Math.abs(second[id] - first[id]);

	// Every layer moves, and the nearer a layer the further it went in the same time.
	expect(moved('clouds')).toBeGreaterThan(0);
	expect(moved('far')).toBeGreaterThan(moved('clouds'));
	expect(moved('mid')).toBeGreaterThan(moved('far'));
	expect(moved('near')).toBeGreaterThan(moved('mid'));

	// The locked near layer covers the stage, but the stage still picks nothing up there.
	const stage = (await page.getByTestId('stage-editor').boundingBox())!;

	await page.mouse.click(stage.x + stage.width / 2, stage.y + stage.height * 0.9);
	await expect(page.locator('.stage-editor-selection')).toHaveCount(0);

	await closeDialogs(page);
	await page.getByRole('tab', {name: 'Build'}).click();

	const [download] = await Promise.all([
		page.waitForEvent('download', {timeout: 60000}),
		page.getByRole('button', {name: 'Export With Assets'}).click()
	]);

	await download.saveAs(path.join(OUT, 'Parallax Hills.sliders.zip'));
	await context.close();
});
