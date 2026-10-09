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
 * Scene editor handles, in a real browser: the squeeze, the lock, the move strip along the
 * selection box and a double click in the passage text.
 *
 * No assets: unresolved props draw as labelled placeholders, which have real rects.
 */

const SCENE = `[scene]
props:
  crate:  {at: -0.3}
  lamp:   {at: 0.3}
  barrel: {at: -0.25, z: 3}
beats:
  - box: "Hello."
`;

function cmText(page: Page) {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate((el: any) => el.CodeMirror.getValue());
}

async function openSceneEditor(page: Page, storyName: string, scene = SCENE) {
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, storyName);
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, scene);
	await showScenePreview(page);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});
	await page.locator('.sliders-entity[data-entity-id="lamp"]').waitFor();
}

function sprite(page: Page, id: string) {
	return page.locator(`.sliders-entity[data-entity-id="${id}"]`);
}

async function centre(page: Page, id: string) {
	const box = (await sprite(page, id).boundingBox())!;

	return {x: box.x + box.width / 2, y: box.y + box.height / 2, box};
}

async function select(page: Page, id: string) {
	const {x, y} = await centre(page, id);

	await page.mouse.click(x, y);
	await expect(
		page.locator(`.stage-editor-selection[data-entity-id="${id}"]`)
	).toBeVisible();
}

async function drag(page: Page, from: {x: number; y: number}, dx: number, dy: number) {
	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + dx, from.y + dy, {steps: 10});
	await page.mouse.up();
	await page.waitForTimeout(700);
}

test.describe('scene editor handles', () => {
	test('an edge handle squeezes one side, and the row resets the aspect', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'UX Squeeze ' + Date.now());
		await select(page, 'lamp');

		const before = (await sprite(page, 'lamp').boundingBox())!;
		const edge = (await page.getByTestId('stage-editor-edge-e').boundingBox())!;

		await drag(
			page,
			{x: edge.x + edge.width / 2, y: edge.y + edge.height / 2},
			before.width * 0.5,
			0
		);

		expect(await cmText(page)).toMatch(/lamp:\s+\{at: [-\d.]+, stretch: \[1\.5, 1\]\}/);

		const after = (await sprite(page, 'lamp').boundingBox())!;

		// Wider by half, same height, and the LEFT edge stayed where it was.
		expect(after.width).toBeCloseTo(before.width * 1.5, 0);
		expect(after.height).toBeCloseTo(before.height, 0);
		expect(after.x).toBeCloseTo(before.x, 0);

		const reset = page.getByRole('button', {name: 'Reset aspect ratio'});

		await expect(reset).toBeVisible();
		await page.screenshot({path: '/root/tmp/ux-squeeze.png'});
		await reset.click();
		await page.waitForTimeout(700);

		expect(await cmText(page)).not.toContain('stretch');
		await expect(reset).toHaveCount(0);
	});

	test('a press on a handle never switches the selection', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'UX Handle Press ' + Date.now());
		// crate sits under barrel (z: 3), so crate's corners lie on top of barrel.
		await page.locator('.CodeMirror').first().evaluate((el: any) => {
			const cm = el.CodeMirror;

			cm.setCursor({ch: 4, line: 2});
		});
		await expect(
			page.locator('.stage-editor-selection[data-entity-id="crate"]')
		).toBeVisible();

		const corner = (await page
			.locator('.stage-editor-handle.ne')
			.boundingBox())!;

		await page.mouse.click(corner.x + corner.width / 2, corner.y + corner.height / 2);
		await page.waitForTimeout(300);

		await expect(
			page.locator('.stage-editor-selection[data-entity-id="crate"]')
		).toBeVisible();
		await expect(
			page.locator('.stage-editor-selection[data-entity-id="barrel"]')
		).toHaveCount(0);
	});

	test('the selection outline drags even where another sprite is drawn on top', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'UX Move Edge ' + Date.now());
		await page.locator('.CodeMirror').first().evaluate((el: any) => {
			el.CodeMirror.setCursor({ch: 4, line: 2});
		});

		const strip = page.getByTestId('stage-editor-move-edge-s');

		await expect(strip).toBeVisible();
		await expect(strip).toHaveCSS('cursor', 'move');

		const box = (await strip.boundingBox())!;

		// The bottom strip of crate runs under barrel, which is drawn in front of it. Off
		// centre: the middle of the edge is the `s` squeeze handle.
		await drag(page, {x: box.x + box.width * 0.2, y: box.y + box.height / 2}, -60, 0);

		const text = await cmText(page);

		expect(text).not.toContain('crate:  {at: -0.3}');
		expect(text).toContain('barrel: {at: -0.25, z: 3}');
	});

	test('a locked prop cannot be picked up from the stage', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'UX Lock ' + Date.now());
		await select(page, 'lamp');
		await page.getByRole('button', {name: 'Lock in place: the stage will not pick it up'}).click();
		await page.waitForTimeout(700);

		expect(await cmText(page)).toContain('lamp:   {at: 0.3, locked: true}');
		await expect(
			page.locator('.stage-editor-selection.locked[data-entity-id="lamp"]')
		).toBeVisible();
		await expect(page.getByTestId('stage-editor-edge-e')).toHaveCount(0);

		// Click away, then on the lamp: nothing is picked up.
		const {x, y, box} = await centre(page, 'lamp');

		await page.mouse.click(box.x + box.width + 80, y);
		await page.mouse.click(x, y);
		await page.waitForTimeout(300);
		await expect(
			page.locator('.stage-editor-selection[data-entity-id="lamp"]')
		).toHaveCount(0);

		// A drag on it moves nothing either.
		await drag(page, {x, y}, 80, 0);
		expect(await cmText(page)).toContain('lamp:   {at: 0.3, locked: true}');
	});

	test('double click on a line in the passage text shows that entity on the stage', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'UX Double Click ' + Date.now());

		const line = page.locator('.CodeMirror-line', {hasText: 'lamp:'}).first();

		await line.dblclick();

		await expect(
			page.locator('.stage-editor-selection[data-entity-id="lamp"]')
		).toBeVisible();
		await expect(
			page.locator('.stage-editor-selection.flash[data-entity-id="lamp"]')
		).toBeVisible();
		// The stage took the keyboard: an arrow nudges the lamp, not the caret.
		await expect(page.getByTestId('stage-editor')).toBeFocused();
		await page.keyboard.press('ArrowRight');
		await page.waitForTimeout(700);
		expect(await cmText(page)).not.toContain('lamp:   {at: 0.3}');
	});
});
