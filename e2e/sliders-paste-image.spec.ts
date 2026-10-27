import {expect, Locator, Page, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	shot,
	showScenePreview
} from './sliders-helpers';

/**
 * Ctrl+V with a picture on the clipboard, in the Library and in the scene editor: one
 * modal asks object / character / background, then the Library shows the new art with its
 * rename open.
 *
 * The paste is a synthetic `paste` event carrying a real PNG: headless Chrome has no
 * clipboard to put one on, and the app only reads `event.clipboardData`.
 */

// One asset library per origin: no parallel tests against it.
test.describe.configure({mode: 'default'});

const PNG = readFileSync(
	path.join(__dirname, 'fixtures', 'assets', 'mira-idle.png')
).toString('base64');

async function pasteImage(target: Locator) {
	await target.focus();
	await target.evaluate((element, base64) => {
		const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
		const data = new DataTransfer();

		data.items.add(new File([bytes], 'image.png', {type: 'image/png'}));
		element.dispatchEvent(
			new ClipboardEvent('paste', {
				bubbles: true,
				cancelable: true,
				clipboardData: data
			})
		);
	}, PNG);
}

async function setUp(page: Page, name: string) {
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, name);
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
}

function renameField(page: Page) {
	return page.getByRole('textbox', {name: /be renamed to/i});
}

test.describe('pasting an image', () => {
	test('in the Library: asks, uploads, opens the rename', async ({page}) => {
		test.setTimeout(120000);
		await setUp(page, 'Paste Library ' + Date.now());
		await page.getByRole('tab', {name: 'Story'}).click();
		await page
			.getByRole('button', {name: 'Assets', exact: true})
			.first()
			.click();

		const library = page.getByRole('dialog', {name: 'Library'});

		await expect(library).toBeVisible();
		await pasteImage(library);
		await expect(page.getByTestId('paste-image-modal')).toBeVisible();
		await shot(page, 'paste-image-modal');
		await page.keyboard.press('b');
		await expect(renameField(page)).toHaveValue(/^pasted/);
		await expect(page.getByRole('tab', {name: 'Backgrounds'})).toHaveAttribute(
			'aria-selected',
			'true'
		);
		await shot(page, 'paste-image-rename');
		// Selected: typing replaces the stand-in name.
		await page.keyboard.type('night-sky');
		await page.getByRole('button', {name: 'OK'}).click();
		await expect(library.getByText('night-sky', {exact: true})).toBeVisible();
	});

	test('in the scene editor: places it, then opens the rename', async ({
		page
	}) => {
		test.setTimeout(180000);
		await setUp(page, 'Paste Scene ' + Date.now());
		await openPassage(page, 'Untitled Passage');
		await setPassageText(page, '[scene]\nbeats:\n  - box: "Hi."\n');
		await showScenePreview(page);
		await page.locator('.scene-stage').first().waitFor({timeout: 20000});

		const preview = page.getByTestId('scene-preview');

		await pasteImage(preview);
		await expect(page.getByTestId('paste-image-modal')).toBeVisible();
		await page.getByTestId('paste-image-object').click();
		await expect(renameField(page)).toHaveValue(/^pasted/);
		await expect(
			page.locator('.sliders-entity[data-entity-id^="pasted"]')
		).toHaveCount(1);
		await page.keyboard.type('lantern');
		await page.getByRole('button', {name: 'OK'}).click();
		await expect(
			page
				.getByRole('dialog', {name: 'Library'})
				.getByText('lantern', {exact: true})
		).toBeVisible();
		// The scene follows the rename (`rename-plan.ts`).
		await expect
			.poll(
				() =>
					page
						.locator('.CodeMirror')
						.first()
						.evaluate((el: any) => el.CodeMirror.getValue()),
				{timeout: 8000}
			)
			.toContain('lantern: {at: [0, 0]}');
	});

	test('a new character: opens the character editor with its id rename', async ({
		page
	}) => {
		test.setTimeout(120000);
		await setUp(page, 'Paste Character ' + Date.now());
		await page.getByRole('tab', {name: 'Story'}).click();
		await page
			.getByRole('button', {name: 'Assets', exact: true})
			.first()
			.click();

		const library = page.getByRole('dialog', {name: 'Library'});

		await pasteImage(library);
		await page.keyboard.press('c');

		const idField = page.getByTestId('editable-title-input');

		await expect(idField).toHaveValue(/^pasted/);
		await shot(page, 'paste-image-character');
		await page.keyboard.type('mira');
		await page.keyboard.press('Enter');
		await expect(idField).toBeHidden();
		await expect(
			page
				.locator('.sliders-characters-dialog')
				.getByText('mira', {exact: true})
				.first()
		).toBeVisible();
	});
});
