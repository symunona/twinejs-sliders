import {expect, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/**
 * The timing overlay (spec 06): the whole scene on the player's clock, docked under the
 * stage, as wide as its beats; hovering it scrubs the stage. Two
 * entities moving in one beat are two groups with bars side by side, two people talking at
 * once are two say rows, a click wait is a double edge with a mouse, auto-advance dashed.
 */

const SCENE = `[scene]
autoAdvance: 0
cast:
  mira: {at: -0.4}
  joren: {at: 0.4}
beats:
  - mira: {at: -0.1, dur: 2}
    joren: {at: 0.1, pose: wave}
  - mira: "Now!"
    joren: "Now!"
  - box: "Later."
`;

test('timing overlay: rows per entity, both speakers, click waits marked', async ({page}) => {
	test.setTimeout(180000);
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, 'Timing ' + Date.now());
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await showScenePreview(page);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});

	// Beat 2: both bubbles on stage at once.
	await page.getByRole('button', {name: 'Next beat'}).click();
	await page.getByRole('button', {name: 'Next beat'}).click();
	await expect(page.locator('.sliders-bubble')).toHaveCount(2);

	await page
		.getByRole('button', {name: "Timing: every beat on the player's clock, over the stage"})
		.first()
		.click();

	const overlay = page.getByTestId('timing-overlay');

	await expect(overlay).toBeVisible();
	await expect(overlay.getByTestId('timing-group')).toHaveCount(3);
	await expect(overlay.locator('[data-group="mira"] [data-kind="move"] .timing-bar')).toHaveCount(1);
	await expect(overlay.locator('[data-group="joren"] [data-kind="say"] .timing-bar')).toHaveText('Now!');
	await expect(overlay.locator('.timing-header .timing-edge.advance-reader')).toHaveCount(2);
	await expect(overlay.locator('.timing-beat-mouse')).toHaveCount(2);

	// Docked to the stage's bottom, not over all of it; as wide as its 3 beat columns.
	const stageBox = (await page.locator('.scene-stage-viewport').first().boundingBox())!;
	const box = (await overlay.boundingBox())!;

	expect(Math.abs(box.y + box.height - (stageBox.y + stageBox.height))).toBeLessThan(4);
	expect(box.height).toBeLessThan(stageBox.height * 0.6);
	// Label 96 + 3 x 176 + padding 24, at most the whole preview (sidebar included).
	const preview = (await page.locator('.scene-stage-view').first().boundingBox())!;

	expect(box.width).toBeLessThanOrEqual(Math.min(648, preview.width) + 1);
	expect(box.width).toBeGreaterThan(Math.min(648, preview.width) - 2);

	// Hover halfway through beat 1's 2s move: mira is drawn between where she starts and ends.
	const sprite = page.locator('[data-entity-id="mira"]').first();
	const centre = async () => {
		const b = (await sprite.boundingBox())!;

		return b.x + b.width / 2;
	};
	const track = overlay.locator('.timing-header .timing-track');
	const trackBox = (await track.boundingBox())!;
	const columns = overlay.getByTestId('timing-beat');
	const first = (await columns.first().boundingBox())!;
	const y = trackBox.y + trackBox.height / 2;

	await page.mouse.move(first.x + 2, y);
	await page.waitForTimeout(150);
	const start = await centre();

	await page.mouse.move(first.x + first.width - 2, y);
	await page.waitForTimeout(150);
	const end = await centre();

	await page.mouse.move(first.x + first.width / 2, y);
	await page.waitForTimeout(150);
	const mid = await centre();

	expect(end).toBeGreaterThan(start + 10);
	expect(mid).toBeGreaterThan(start + 2);
	expect(mid).toBeLessThan(end - 2);

	// Hover her move bar: start and end ghosted, the solid one in between.
	const bar = overlay.locator('[data-group="mira"] [data-kind="move"] .timing-bar');
	const barBox = (await bar.boundingBox())!;

	await page.mouse.move(barBox.x + barBox.width / 2, barBox.y + barBox.height / 2);
	await expect(page.locator('[data-entity-id^="__timing-ghost-"]')).toHaveCount(2);
	await page.screenshot({path: '/root/tmp/timing-overlay-hover.png'});

	// Leaving puts the stage back on the scrubber's beat: no ghosts, mira at beat 2's place.
	await page.mouse.move(stageBox.x + 10, stageBox.y + 10);
	await expect(page.locator('[data-entity-id^="__timing-ghost-"]')).toHaveCount(0);
	await page.waitForTimeout(150);
	expect(Math.abs((await centre()) - end)).toBeLessThan(3);
	await page.screenshot({path: '/root/tmp/timing-overlay.png'});

	await overlay.getByTestId('timing-beat').first().click();
	await expect(page.getByTestId('scene-preview-beat')).toHaveText('1 / 3');

	await page.keyboard.press('Escape');
	await expect(overlay).toHaveCount(0);
});
