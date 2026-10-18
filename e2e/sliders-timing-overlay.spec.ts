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
 * The timing overlay (spec 06): the whole scene on the player's clock over the stage. Two
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
	await page.screenshot({path: '/root/tmp/timing-overlay.png'});

	await overlay.getByTestId('timing-beat').first().click();
	await expect(page.getByTestId('scene-preview-beat')).toHaveText('1 / 3');

	await page.keyboard.press('Escape');
	await expect(overlay).toHaveCount(0);
});
