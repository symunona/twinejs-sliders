import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/**
 * The scene editor's view zoom: how big the stage is drawn, not what the camera frames.
 *
 * The part worth pinning is that the overlay stays on the sprite. Zoom resizes the box
 * the stage is drawn in and the overlay measures with client rects, so a selection box
 * drawn zoomed in and scrolled has to sit exactly where the sprite is.
 */

const SCENE = `[scene]
cast:
  mira:  {at: -0.4, pose: idle}
  joren:
    at: 0.35
beats:
  - mira: "Hello."
`;

async function openSceneEditor(page: Page, storyName: string) {
	await createStory(page, storyName);
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await showScenePreview(page);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});
}

function percent(page: Page) {
	return page.locator('.scene-preview-zoom-percent').first();
}

async function canvasWidth(page: Page) {
	return (await page.locator('.scene-stage-canvas').first().boundingBox())!
		.width;
}

async function viewportWidth(page: Page) {
	return page
		.locator('.scene-stage-viewport')
		.first()
		.evaluate(el => el.clientWidth);
}

test.describe('scene editor view zoom', () => {
	test('steps in and out, and the percentage resets to 100%', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Scene Zoom Steps ' + Date.now());

		await expect(percent(page)).toHaveText('100%');

		const fit = await canvasWidth(page);

		await page
			.getByTestId('scene-preview')
			.getByRole('button', {name: 'Zoom In'})
			.click();
		await expect(percent(page)).toHaveText('125%');
		// The scrollbar the zoom brings takes a little width back off the viewport.
		expect(await canvasWidth(page)).toBeCloseTo(
			(await viewportWidth(page)) * 1.25,
			-1
		);

		await page
			.getByTestId('scene-preview')
			.getByRole('button', {name: 'Zoom Out'})
			.click();
		await page
			.getByTestId('scene-preview')
			.getByRole('button', {name: 'Zoom Out'})
			.click();
		await expect(percent(page)).toHaveText('75%');
		expect(await canvasWidth(page)).toBeLessThan(fit);

		await percent(page).click();
		await expect(percent(page)).toHaveText('100%');
		expect(await canvasWidth(page)).toBeCloseTo(fit, 0);
	});

	test('ctrl + wheel over the stage zooms the view', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Scene Zoom Wheel ' + Date.now());

		const viewport = (await page
			.locator('.scene-stage-viewport')
			.first()
			.boundingBox())!;

		await page.mouse.move(
			viewport.x + viewport.width / 2,
			viewport.y + viewport.height / 2
		);
		await page.keyboard.down('Control');
		await page.mouse.wheel(0, -300);
		await page.keyboard.up('Control');
		await page.waitForTimeout(300);

		const shown = parseInt((await percent(page).textContent()) ?? '', 10);

		expect(shown).toBeGreaterThan(100);
	});

	test('the selection box stays on the sprite zoomed in and scrolled', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Scene Zoom Overlay ' + Date.now());

		const zoomIn = page
			.getByTestId('scene-preview')
			.getByRole('button', {name: 'Zoom In'});

		// 100 -> 125 -> 150 -> 200%.
		await zoomIn.click();
		await zoomIn.click();
		await zoomIn.click();
		await expect(percent(page)).toHaveText('200%');

		await page
			.locator('.scene-stage-viewport')
			.first()
			.evaluate(el => {
				el.scrollLeft = 80;
				el.scrollTop = 40;
			});
		await page.waitForTimeout(300);

		const mira = page.locator('.sliders-entity[data-entity-id="mira"]');
		const box = (await mira.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

		const selection = page.locator('.stage-editor-selection').first();

		await selection.waitFor();

		const marked = (await selection.boundingBox())!;

		expect(Math.abs(marked.x - box.x)).toBeLessThan(3);
		expect(Math.abs(marked.y - box.y)).toBeLessThan(3);
		expect(Math.abs(marked.width - box.width)).toBeLessThan(3);
		expect(Math.abs(marked.height - box.height)).toBeLessThan(3);
	});
});
