import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat
} from './sliders-helpers';

/**
 * The full screen player: the stage with nothing else on the screen, read by tapping.
 *
 * The last beat carries a link on purpose — that is the one beat a tap must NOT step past,
 * because the click belongs to the choice.
 */
const SCENE = `[scene]
id: player-scene
cast:
  mira:  {at: -0.4, frame: idle}
  joren: {at: 0.35}
beats:
  - mira: "One."
  - joren: "Two."
  - mira: "Will you [[stay]] or [[go]]?"
`;

async function openPlayer(page: Page, storyName: string) {
	await createStory(page, storyName);
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});
	await page.locator('.sliders-entity[data-entity-id="mira"]').waitFor({
		timeout: 20000
	});
	await page.getByRole('button', {name: 'Full screen'}).click();
	await page.waitForTimeout(500);
}

/** Empty ground, high above the floor the characters stand on. */
async function tapEmptyStage(page: Page) {
	const box = (await page.locator('.stage-editor').boundingBox())!;

	await page.mouse.click(box.x + 40, box.y + 40);
	await page.waitForTimeout(400);
}

function beatCounter(page: Page) {
	return page.getByTestId('scene-preview-beat');
}

test.describe('full screen player', () => {
	test('a tap on the stage steps to the next beat until a link appears', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openPlayer(page, 'Player Tap ' + Date.now());

		await expect(beatCounter(page)).toHaveText('0 / 3');

		await tapEmptyStage(page);
		await expect(beatCounter(page)).toHaveText('1 / 3');

		await tapEmptyStage(page);
		await expect(beatCounter(page)).toHaveText('2 / 3');

		await tapEmptyStage(page);
		await expect(beatCounter(page)).toHaveText('3 / 3');

		// Beat 3 asks the reader to choose, so the stage stops taking taps.
		await tapEmptyStage(page);
		await expect(beatCounter(page)).toHaveText('3 / 3');
	});

	test('the corner navigator steps both ways', async ({page}) => {
		test.setTimeout(180000);
		await openPlayer(page, 'Player Nav ' + Date.now());

		const nav = page.getByTestId('scene-preview-nav');

		await expect(nav).toBeVisible();

		const stage = (await page.locator('.scene-stage').boundingBox())!;
		const box = (await nav.boundingBox())!;

		// Bottom right of the player, which is what makes it stay out of the scene.
		expect(box.x).toBeGreaterThan(stage.x + stage.width / 2);
		expect(box.y).toBeGreaterThan(stage.y + stage.height / 2);

		await nav.getByRole('button', {name: 'Next beat'}).click();
		await expect(beatCounter(page)).toHaveText('1 / 3');

		await nav.getByRole('button', {name: 'Previous beat'}).click();
		await expect(beatCounter(page)).toHaveText('0 / 3');
	});

	test('the small preview keeps the editor click, not the page turn', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openPlayer(page, 'Player Small ' + Date.now());

		await page.getByRole('button', {name: 'Full screen'}).click();
		await page.waitForTimeout(400);

		await expect(page.getByTestId('scene-preview-nav')).toHaveCount(0);

		await tapEmptyStage(page);
		await expect(beatCounter(page)).toHaveText('0 / 3');
	});
});
