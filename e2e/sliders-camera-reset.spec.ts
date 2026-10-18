import {expect, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/** Camera pane heading's reset: one click, whole `camera:` key gone, undo brings it back. */

const SCENE = `[scene]
bg: ~
camera: {at: [0.3, -0.2], zoom: 2}
beats:
  - box: "one"
`;

test('camera reset drops the camera key, undo restores it', async ({page}) => {
	test.setTimeout(120000);
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, 'Camera Reset');
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await showScenePreview(page);

	const sidebar = page.getByTestId('scene-sidebar');
	const pane = page.getByTestId('scene-settings-camera-group');

	if (!(await pane.isVisible().catch(() => false))) {
		await sidebar.getByRole('tab', {name: 'Camera'}).click();
	}

	const reset = page.getByTestId('scene-settings-camera-reset');

	await expect(reset).toBeEnabled({timeout: 10000});
	await page.screenshot({
		path: '/root/tmp/camera-reset-button.png',
		clip: (await pane.boundingBox()) ?? undefined
	});
	await page.screenshot({path: '/root/tmp/camera-reset-dialog.png'});
	await reset.click();

	const text = () =>
		page.evaluate(() =>
			(
				document.querySelector('.CodeMirror') as unknown as {
					CodeMirror: {getValue(): string};
				}
			).CodeMirror.getValue()
		);

	await expect.poll(text).not.toContain('camera:');
	await expect(reset).toBeDisabled();

	await page.locator('.CodeMirror textarea').first().focus();
	await page.keyboard.press('Control+z');
	await expect.poll(text).toContain('camera: {at: [0.3, -0.2], zoom: 2}');
	await expect(reset).toBeEnabled();
});
