import {expect, Page, test} from '@playwright/test';
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
 * A `scroll_infinite_*` loop is two CSS animations, the art and its trailing twin, and the
 * hand-off only lands on the frame edge while both are at the same point of the lap. An
 * edit that changes the art (here a grade) rebuilds the twin mid-lap; it used to restart
 * at 0 while the art carried on, and the stage showed through as a stripe.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const SCENE = `[scene]
bg: {id: parallax-sky, fx: scroll_infinite_right, speed: 3}
props:
  near: {ref: parallax-far, fit: cover, z: -2, motion: {id: scroll_infinite_left, speed: 3}}
beats:
  - box: "one"
`;

/** Each copy's place in its lap, ms. */
function laps(page: Page) {
	return page.evaluate(() => {
		const at = (selector: string) => {
			const animation = document
				.querySelector(selector)
				?.getAnimations()
				.find(a => a instanceof CSSAnimation);

			return Math.round(Number(animation?.currentTime ?? NaN));
		};
		const near = '.sliders-entity[data-entity-id="near"] > .sliders-entity-art';

		return {
			art: at(`${near}:not(.sliders-entity-art-tile)`),
			artTile: at(`${near}.sliders-entity-art-tile`),
			bg: at('.sliders-bg:not(.sliders-bg-tile)'),
			bgTile: at('.sliders-bg-tile')
		};
	});
}

test('scroll twin stays on the lap of the copy it trails', async ({page}) => {
	test.setTimeout(120000);
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, 'Scroll Twin');
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.locator('.route-toolbar-tab-link', {hasText: 'Assets'}).click();
	await page
		.getByRole('dialog', {name: 'Library'})
		.locator('input[type="file"]')
		.setInputFiles(
			['parallax-sky.png', 'parallax-far.png'].map(name =>
				path.join(FIXTURES, name)
			)
		);
	await expect(
		page.locator('.sliders-tile', {hasText: 'parallax-far'})
	).toBeVisible({timeout: 30000});
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await showScenePreview(page);
	await expect(page.locator('.sliders-entity-art-tile')).toHaveCount(1);
	// Into the second lap, so a twin restarted at 0 cannot match by luck.
	await page.waitForTimeout(4000);
	await setPassageText(
		page,
		SCENE.replace('speed: 3}}', 'speed: 3}, grade: {brightness: -20}}')
	);
	await expect(
		page.locator('.sliders-entity-art-tile[style*="filter"]')
	).toHaveCount(1, {timeout: 10000});

	const now = await laps(page);

	expect(now.art).toBeGreaterThan(3000);
	expect(Math.abs(now.artTile - now.art)).toBeLessThan(50);
	expect(Math.abs(now.bgTile - now.bg)).toBeLessThan(50);
});
