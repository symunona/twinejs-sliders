import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	openSceneErrors,
	setPassageText,
	setStoryFormat
} from './sliders-helpers';

/**
 * `of:` — relative placement (D17), end to end through the real editor.
 *
 * Two properties are worth a browser, and neither can be seen from a unit test:
 *
 *  1. A child is DRAWN at its parent's position plus its own offset. That is the whole
 *     feature, and it crosses the parser, the merge, `resolveStage` and the renderer.
 *  2. Dragging the PARENT moves the child on screen while writing only the parent's `at:`.
 *     A child that stayed put would mean resolution never ran; a child whose own `at:` got
 *     rewritten would mean the editor resolved in the wrong direction.
 *
 * No assets: unresolved entities draw as labelled placeholders with real rects, so the
 * geometry is exercised without a fixture.
 */

/**
 * The candle is in `front` deliberately. Both props would otherwise default to `mid` and
 * sit at the same baseline y, so their z would tie and the rects overlap — a click meant
 * for the candle would land on whichever won the tie-break.
 */
const SCENE = `[scene]
id: of-scene
props:
  table:  {at: -0.3}       # keep this comment
  candle: {of: table, at: 0.4, layer: front}
`;

function cmText(page: Page) {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate((el: any) => el.CodeMirror.getValue());
}

async function openSceneEditor(page: Page, storyName: string, scene = SCENE) {
	await createStory(page, storyName);
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, scene);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});
}

/** Sprite centre in page px. */
async function centreOf(page: Page, id: string) {
	const box = (await page
		.locator(`.sliders-entity[data-entity-id="${id}"]`)
		.boundingBox())!;

	return {x: box.x + box.width / 2, y: box.y + box.height / 2};
}

async function dragEntity(page: Page, id: string, dx: number, dy: number) {
	const from = await centreOf(page, id);

	await page.mouse.move(from.x, from.y);
	await page.mouse.down();
	await page.mouse.move(from.x + dx, from.y + dy, {steps: 12});
	await page.mouse.up();
	await page.waitForTimeout(700);
}

test.describe('of: relative placement', () => {
	test('draws a child at its parent plus its own offset', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Of Draw ' + Date.now());

		await page.locator('[data-entity-id="candle"]').waitFor({timeout: 20000});

		const table = await centreOf(page, 'table');
		const candle = await centreOf(page, 'candle');

		// table sits at -0.3 and the candle 0.4 to its right, so the candle resolves to
		// +0.1 — right of the table, and right of stage centre.
		const stage = (await page.locator('.sliders-stage-box').boundingBox())!;
		const centreX = stage.x + stage.width / 2;

		expect(candle.x).toBeGreaterThan(table.x);
		expect(candle.x).toBeGreaterThan(centreX);

		// 0.4 of a half-width to the right of the table, within a few px of rounding.
		expect(candle.x - table.x).toBeCloseTo(0.4 * (stage.width / 2), -1);
	});

	test('dragging the parent carries the child and writes only the parent', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Of Drag Parent ' + Date.now());

		await page.locator('[data-entity-id="candle"]').waitFor({timeout: 20000});

		const before = await centreOf(page, 'candle');
		const gap = before.x - (await centreOf(page, 'table')).x;

		await dragEntity(page, 'table', 140, 0);

		const after = await centreOf(page, 'candle');
		const text = await cmText(page);

		// The child moved with its parent...
		expect(after.x).toBeGreaterThan(before.x + 100);
		// ...keeping the offset that makes it a child and not a coincidence.
		expect(after.x - (await centreOf(page, 'table')).x).toBeCloseTo(gap, -1);

		// ...and only the parent's at: was rewritten. The child's offset is untouched,
		// which is the difference between relative placement and moving two sprites.
		expect(text).toContain('candle: {of: table, at: 0.4, layer: front}');
		expect(text).not.toContain('table:  {at: -0.3}');
		expect(text).toContain('# keep this comment');
	});

	test('dragging the child writes an offset, not an absolute position', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Of Drag Child ' + Date.now());

		await page.locator('[data-entity-id="candle"]').waitFor({timeout: 20000});

		const stage = (await page.locator('.sliders-stage-box').boundingBox())!;

		// Half a half-width left: the candle's absolute x goes 0.1 -> -0.4, so its OFFSET
		// from a table at -0.3 has to land near -0.1. An editor that wrote the absolute
		// value would put -0.4 in the file and the sprite would jump on the next parse.
		await dragEntity(page, 'candle', -0.5 * (stage.width / 2), 0);

		const text = await cmText(page);
		const match = /candle: \{of: table, at: ([-0-9.]+), layer: front\}/.exec(text);

		expect(match).not.toBeNull();
		expect(Number(match![1])).toBeCloseTo(-0.1, 1);

		// And the sprite stays where it was dropped once the parse catches up.
		await page.waitForTimeout(600);

		const candle = await centreOf(page, 'candle');

		expect(candle.x).toBeCloseTo(stage.x + stage.width / 2 - 0.4 * (stage.width / 2), -1);
	});

	test('reports a parent that is not on stage', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(
			page,
			'Of Unknown ' + Date.now(),
			'[scene]\nprops:\n  candle: {of: tabel, at: 0.4}\n'
		);

		await expect(await openSceneErrors(page)).toContainText('tabel');
	});
});
