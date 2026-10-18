import {expect, test} from '@playwright/test';
import * as path from 'node:path';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/**
 * Grid on = ruler numbers along the stage's bottom and left edges, in scene units, and they
 * stay on their lines under the view zoom.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const SCENE = `[scene]
bg: parallax-sky
beats:
  - box: "one"
`;
const SHOTS = process.env.GRID_RULER_SHOTS;

test('grid ruler numbers the lines in scene units', async ({page}) => {
	test.setTimeout(120000);
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, 'Grid Ruler');
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.locator('.route-toolbar-tab-link', {hasText: 'Assets'}).click();
	await page
		.getByRole('dialog', {name: 'Library'})
		.locator('input[type="file"]')
		.setInputFiles([path.join(FIXTURES, 'parallax-sky.png')]);
	await expect(
		page.locator('.sliders-tile', {hasText: 'parallax-sky'})
	).toBeVisible({timeout: 30000});
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await showScenePreview(page);

	const grid = page.locator('button[aria-label^="Show the stage grid"]');

	if ((await grid.getAttribute('aria-pressed')) !== 'true') {
		await grid.click();
	}

	const rulerX = page.getByTestId('stage-editor-ruler-x');
	const rulerY = page.getByTestId('stage-editor-ruler-y');

	await expect(rulerX.locator('[data-scene="0"]')).toHaveText('0');
	await expect(rulerY.locator('[data-scene="0"]')).toHaveText('0');
	await expect(rulerY.locator('.baseline')).toHaveText('-0.85');

	// The number sits on its line: the centre label starts 2px right of the centre line.
	const onLine = async () => {
		const line = await page
			.locator('.stage-editor-grid-line.x.centre')
			.boundingBox();
		const label = await rulerX.locator('[data-scene="0"]').boundingBox();

		expect(label!.x - line!.x).toBeGreaterThanOrEqual(1);
		expect(label!.x - line!.x).toBeLessThanOrEqual(4);
	};

	await onLine();
	await expect(rulerX.locator('[data-scene]')).not.toHaveCount(0);
	await expect(page.locator('.stage-editor-ruler-label').first()).toHaveCSS(
		'pointer-events',
		'none'
	);
	if (SHOTS) {
		await page.locator('.scene-stage-view').screenshot({path: `${SHOTS}/grid-ruler-100.png`});
	}

	const zoomIn = page.locator('.scene-preview-zoom button[aria-label="Zoom In"]');

	await zoomIn.click();
	await zoomIn.click();
	await expect(page.locator('.scene-preview-zoom-percent')).toHaveText('150%');
	await onLine();
	if (SHOTS) {
		await page.locator('.scene-stage-view').screenshot({path: `${SHOTS}/grid-ruler-150.png`});
	}

	// Scrolled in a zoomed view the rulers follow the viewport's edge, not the stage's.
	await page.locator('.scene-stage-viewport').evaluate(v => {
		v.scrollTop = 0;
		v.scrollLeft = 200;
	});
	const viewport = (await page.locator('.scene-stage-viewport').boundingBox())!;

	await expect
		.poll(async () =>
			Math.abs(viewport.y + viewport.height - (await rulerX.boundingBox())!.y)
		)
		.toBeLessThan(2);
	if (SHOTS) {
		await page
			.locator('.scene-stage-view')
			.screenshot({path: `${SHOTS}/grid-ruler-150-scrolled.png`});
	}
});
