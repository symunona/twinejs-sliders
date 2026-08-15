import {expect, Page, test} from '@playwright/test';
import * as path from 'node:path';
import {BASE_URL, createStory, shot} from './sliders-helpers';

// One asset library per origin, so these can't share it with each other.
test.describe.configure({mode: 'serial'});

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');

const fixture = (name: string) => path.join(FIXTURES, name);

async function clearAssetLibrary(page: Page) {
	await page.goto(BASE_URL);
	await page.evaluate(async () => {
		if (navigator.storage?.getDirectory) {
			const root = await navigator.storage.getDirectory();

			await root
				.removeEntry('sliders-assets', {recursive: true})
				.catch(() => undefined);
		}

		indexedDB.deleteDatabase('sliders-assets');
	});
}

async function openAssetManager(page: Page) {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await expect(page.getByRole('dialog', {name: 'Assets'})).toBeVisible();
}

async function uploadInto(page: Page, dialogName: string, files: string[]) {
	await page
		.getByRole('dialog', {name: dialogName})
		.locator('input[type="file"]')
		.setInputFiles(files);
}

/** Uploads one background and opens the editor on it. */
async function openEditor(page: Page, file: string, name: string) {
	await openAssetManager(page);
	await uploadInto(page, 'Assets', [fixture(file)]);

	const tile = page.locator('.sliders-tile', {hasText: name});

	await expect(tile).toBeVisible({timeout: 15000});
	await tile.getByRole('button', {name: 'Edit Image'}).click();

	const editor = page.getByRole('dialog', {name: `Edit ${name}`});

	await expect(editor).toBeVisible();
	await expect(editor.locator('canvas')).toBeVisible();
	return editor;
}

test.describe('Sliders asset editor', () => {
	test.beforeEach(async ({page}) => {
		await clearAssetLibrary(page);
	});

	test('opens maximized and crops, resizes and adjusts into a new asset', async ({
		page
	}) => {
		await createStory(page, 'Asset edit test');

		const editor = await openEditor(page, 'street-dusk.png', 'street-dusk');

		// Editing wants the whole window, so the dialog opens maximized.
		await expect(page.locator('.maximized .asset-editor-dialog')).toBeVisible();
		await shot(page, '20-asset-editor-open');

		// Crop by dragging across the middle of the preview.

		const canvas = editor.locator('.asset-editor-canvas canvas');
		const frame = (await canvas.boundingBox())!;

		await page.mouse.move(frame.x + frame.width * 0.2, frame.y + frame.height * 0.2);
		await page.mouse.down();
		await page.mouse.move(frame.x + frame.width * 0.7, frame.y + frame.height * 0.8, {
			steps: 12
		});
		await page.mouse.up();
		await expect(editor.locator('.asset-editor-detail').first()).toContainText(
			/^6\d\d×4\d\d at 2\d\d, 1\d\d$/
		);

		// The output size follows the crop, and is smaller than the original.

		const width = editor.getByRole('spinbutton', {name: 'Width'});

		await expect(width).not.toHaveValue('1280');

		// Halve it, with the aspect lock on.
		await width.fill('320');
		await width.blur();
		await expect(editor.getByRole('spinbutton', {name: 'Height'})).not.toHaveValue(
			'0'
		);

		await editor.getByRole('slider', {name: /Gamma/}).fill('1.6');
		await editor.getByRole('slider', {name: /Brightness/}).fill('20');
		await shot(page, '21-asset-editor-cropped');

		await editor.getByRole('textbox', {name: 'Name'}).fill('street-dusk-cropped');
		await editor.getByRole('button', {name: 'Save As New Asset'}).click();

		// The editor closes, and the edit lands as a second asset--the original is
		// still there.
		await expect(editor).toBeHidden({timeout: 15000});

		const saved = page.locator('.sliders-tile', {hasText: 'street-dusk-cropped'});

		await expect(saved).toBeVisible({timeout: 15000});
		await expect(saved.locator('.sliders-tile-detail')).toContainText('320×');
		await expect(page.locator('.sliders-tile', {hasText: 'street-dusk'})).toHaveCount(
			2
		);
		await shot(page, '22-asset-editor-saved');
	});

	test('refuses to edit an animated GIF', async ({page}) => {
		await createStory(page, 'Animated edit test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'Objects'}).click();
		await uploadInto(page, 'Assets', [fixture('candle-flicker.gif')]);

		const tile = page.locator('.sliders-tile', {hasText: 'candle-flicker'});

		await expect(tile).toBeVisible({timeout: 15000});
		await expect(
			tile.getByRole('button', {name: "Animated images can't be edited"})
		).toBeDisabled();
	});

	test('removes the background on this machine', async ({page}) => {
		// The model and the ONNX runtime are both fetched on first use.
		test.setTimeout(300000);
		await createStory(page, 'Background removal test');

		const editor = await openEditor(page, 'mira-idle.png', 'mira-idle');

		await editor.getByRole('button', {name: 'Remove Background'}).click();
		await expect(
			editor.getByRole('button', {name: 'Restore Background'})
		).toBeVisible({timeout: 240000});
		await shot(page, '23-asset-editor-background-removed');

		// The cutout has transparent pixels where the flat background was.
		const cornerAlpha = await editor.locator('canvas').evaluate(node => {
			const canvas = node as HTMLCanvasElement;

			return canvas
				.getContext('2d')!
				.getImageData(1, 1, 1, 1).data[3];
		});

		expect(cornerAlpha).toBeLessThan(32);

		await editor.getByRole('button', {name: 'Save As New Asset'}).click();
		await expect(editor).toBeHidden({timeout: 30000});
		await expect(
			page.locator('.sliders-tile', {hasText: 'mira-idle-edit'})
		).toBeVisible({timeout: 15000});
	});
});
