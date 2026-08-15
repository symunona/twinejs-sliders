import {expect, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {BASE_URL, createStory, shot} from './sliders-helpers';

// The asset library is one store per origin, shared by every tab. These tests therefore
// can't run against the same origin in parallel.
test.describe.configure({mode: 'serial'});

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');

const fixture = (name: string) => path.join(FIXTURES, name);

/** Empties the asset library so each test starts from nothing. */
async function clearAssetLibrary(page: import('@playwright/test').Page) {
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

/**
 * Opens the asset manager from the story edit toolbar. Both Sliders dialogs live on the
 * Story tab, next to Passage Tags.
 */
async function openAssetManager(page: import('@playwright/test').Page) {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await expect(page.getByRole('dialog', {name: 'Assets'})).toBeVisible();
}

/**
 * Drags a handle to a fraction of the sprite frame. The dialog body scrolls, so the
 * preview has to be brought into view before any coordinate is read.
 */
async function dragHandle(
	editor: import('@playwright/test').Locator,
	page: import('@playwright/test').Page,
	handle: string,
	to: {x: number; y: number}
) {
	const target = editor.locator(`[data-handle="${handle}"]`);

	await editor.locator('.sprite-preview').scrollIntoViewIfNeeded();

	const box = (await target.boundingBox())!;
	const frame = (await editor.locator('.sprite-preview-frame').boundingBox())!;

	await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
	await page.mouse.down();
	await page.mouse.move(
		frame.x + frame.width * to.x,
		frame.y + frame.height * to.y,
		{steps: 12}
	);
	await page.mouse.up();
}

/** The file input is visually hidden, so set files on it directly. */
async function uploadInto(
	page: import('@playwright/test').Page,
	dialogName: string,
	files: string[]
) {
	await page
		.getByRole('dialog', {name: dialogName})
		.locator('input[type="file"]')
		.setInputFiles(files);
}

test.describe('Sliders asset manager', () => {
	test.beforeEach(async ({context, page}) => {
		// The copy button uses the async Clipboard API.
		await context
			.grantPermissions(['clipboard-read', 'clipboard-write'])
			.catch(() => undefined);
		await clearAssetLibrary(page);
	});

	test('uploads a still PNG, converts it to WebP and shows it', async ({page}) => {
		await createStory(page, 'Asset upload test');
		await openAssetManager(page);
		await shot(page, '01-assets-empty');

		await uploadInto(page, 'Assets', [fixture('tavern-night.png')]);

		const tile = page.locator('.sliders-tile', {hasText: 'tavern-night'});

		await expect(tile).toBeVisible({timeout: 15000});

		// Still images are re-encoded to WebP on upload (spec 03).
		await expect(tile.locator('.sliders-tile-detail')).toContainText('webp');
		await expect(tile.locator('.sliders-tile-detail')).toContainText('1280×720');
		await expect(tile.locator('img')).toBeVisible();
		await shot(page, '02-assets-background-uploaded');
	});

	test('keeps an animated GIF animated instead of flattening it', async ({page}) => {
		await createStory(page, 'Animated asset test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'Objects'}).click();
		await uploadInto(page, 'Assets', [fixture('candle-flicker.gif')]);

		const tile = page.locator('.sliders-tile', {hasText: 'candle-flicker'});

		await expect(tile).toBeVisible({timeout: 15000});
		// `exact` matters: the tile also holds a disabled Edit button whose accessible name
		// begins "Animated images can't be edited", so a loose match is ambiguous and fails
		// strict mode rather than the assertion.
		await expect(tile.getByText('Animated', {exact: true})).toBeVisible();

		// Stored as-is: still a GIF, never re-encoded.
		await expect(tile.locator('.sliders-tile-detail')).toContainText('gif');
		await shot(page, '03-assets-animated-gif');
	});

	test('warns instead of silently duplicating a re-uploaded file', async ({page}) => {
		await createStory(page, 'Duplicate asset test');
		await openAssetManager(page);
		await uploadInto(page, 'Assets', [fixture('street-dusk.png')]);
		await expect(
			page.locator('.sliders-tile', {hasText: 'street-dusk'})
		).toBeVisible({timeout: 15000});

		await uploadInto(page, 'Assets', [fixture('street-dusk.png')]);
		await expect(page.locator('.sliders-upload-report')).toContainText(
			'already uploaded'
		);
		await expect(page.locator('.sliders-tile', {hasText: 'street-dusk'})).toHaveCount(
			1
		);
		await shot(page, '04-assets-duplicate-warning');
	});

	test('copies the YAML fragment, not the asset id', async ({page}) => {
		await createStory(page, 'Copy fragment test');
		await openAssetManager(page);
		await uploadInto(page, 'Assets', [fixture('tavern-night.png')]);

		const tile = page.locator('.sliders-tile', {hasText: 'tavern-night'});

		await expect(tile).toBeVisible({timeout: 15000});
		await expect(tile.locator('.copy-fragment-button')).toHaveAttribute(
			'data-fragment',
			'bg: tavern-night'
		);

		await tile.getByRole('button', {name: 'bg: tavern-night'}).click();
		await expect(tile.getByText('Copied')).toBeVisible();

		const clipboard = await page.evaluate(() =>
			navigator.clipboard.readText().catch(() => '')
		);

		expect(clipboard).toBe('bg: tavern-night');
		await shot(page, '05-assets-copied-fragment');
	});

	test('uploads files dropped onto a tab', async ({page}) => {
		await createStory(page, 'Drop upload test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'FX'}).click();

		const dropZone = page
			.getByRole('dialog', {name: 'Assets'})
			.locator('.upload-drop-zone:visible');
		const base64 = readFileSync(fixture('table.png')).toString('base64');
		const dataTransfer = await page.evaluateHandle(async encoded => {
			const binary = atob(encoded);
			const bytes = Uint8Array.from(binary, character => character.charCodeAt(0));
			const transfer = new DataTransfer();

			transfer.items.add(
				new File([bytes], 'rain-streaks.png', {type: 'image/png'})
			);
			return transfer;
		}, base64);

		await dropZone.dispatchEvent('dragover', {dataTransfer});
		await dropZone.dispatchEvent('drop', {dataTransfer});

		const tile = page.locator('.sliders-tile', {hasText: 'rain-streaks'});

		await expect(tile).toBeVisible({timeout: 15000});
		await expect(tile.locator('.copy-fragment-button')).toHaveAttribute(
			'data-fragment',
			'fx: [{id: rain-streaks, amount: 1}]'
		);
		await shot(page, '12-assets-dropped');
	});

	test('shows objects with an object fragment', async ({page}) => {
		await createStory(page, 'Object fragment test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'Objects'}).click();
		await uploadInto(page, 'Assets', [fixture('table.png')]);

		const tile = page.locator('.sliders-tile', {hasText: 'table'});

		await expect(tile).toBeVisible({timeout: 15000});
		await expect(tile.locator('.copy-fragment-button')).toHaveAttribute(
			'data-fragment',
			'table: {at: 0}'
		);
	});
});

test.describe('Sliders character editor', () => {
	test.beforeEach(async ({page}) => {
		await clearAssetLibrary(page);
	});

	test('creates a character, adds frames and drags an anchor', async ({page}) => {
		await createStory(page, 'Character editor test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'Characters'}).click();

		await page.getByRole('button', {name: 'New Character'}).first().click();
		await page
			.getByRole('textbox', {name: 'What should this character be called?'})
			.fill('Mira');
		await page.getByRole('button', {name: 'OK'}).click();

		const editor = page.getByRole('dialog', {name: 'Characters'});

		await expect(editor).toBeVisible({timeout: 10000});

		// Maximize so the whole sprite preview is on screen — the origin sits at the very
		// bottom of the frame.
		await editor.getByRole('button', {name: 'Maximize'}).click();
		await shot(page, '06-character-editor-new');

		// Frames arrive through the asset store, tagged with their owner character.
		await uploadInto(page, 'Characters', [
			fixture('mira-idle.png'),
			fixture('mira-arms-crossed.png'),
			fixture('mira-angry.png')
		]);

		await expect(editor.locator('.frame-list-item')).toHaveCount(3, {
			timeout: 20000
		});
		await expect(editor.locator('.sprite-preview img')).toBeVisible();
		await shot(page, '07-character-frames-added');

		// Anchors are stored as fractions of the frame, never pixels.
		const bubble = editor.locator('[data-handle="anchor:bubble"]');

		await expect(bubble).toBeVisible();

		const before = await bubble.getAttribute('data-y');

		await dragHandle(editor, page, 'anchor:bubble', {x: 0.7, y: 0.1});

		await expect
			.poll(async () => Number(await bubble.getAttribute('data-x')))
			.toBeCloseTo(0.7, 1);
		await expect
			.poll(async () => Number(await bubble.getAttribute('data-y')))
			.toBeCloseTo(0.1, 1);
		expect(await bubble.getAttribute('data-y')).not.toBe(before);

		// Fractions, so always within 0..1.
		const x = Number(await bubble.getAttribute('data-x'));

		expect(x).toBeGreaterThanOrEqual(0);
		expect(x).toBeLessThanOrEqual(1);

		await shot(page, '08-character-anchor-dragged');

		// The origin cross moves the guides with it.
		const origin = editor.locator('[data-handle="origin"]');

		await dragHandle(editor, page, 'origin', {x: 0.35, y: 0.9});

		await expect
			.poll(async () => Number(await origin.getAttribute('data-x')))
			.toBeCloseTo(0.35, 1);
		await shot(page, '09-character-origin-dragged');

		// Everything persists through the asset store.
		await page.reload();
		await page.getByRole('tab', {name: 'Story'}).click();
		await page.getByRole('button', {name: 'Characters', exact: true}).click();

		const reopened = page.getByRole('dialog', {name: 'Characters'});

		await expect(reopened.locator('.frame-list-item')).toHaveCount(3, {
			timeout: 20000
		});
		await expect
			.poll(async () =>
				Number(
					await reopened.locator('[data-handle="anchor:bubble"]').getAttribute('data-x')
				)
			)
			.toBeCloseTo(0.7, 1);
		await shot(page, '10-character-persisted');
	});

	test('shows a character as one tile with its frame count', async ({page}) => {
		await createStory(page, 'Character tile test');
		await openAssetManager(page);
		await page.getByRole('tab', {name: 'Characters'}).click();
		await page.getByRole('button', {name: 'New Character'}).first().click();
		await page
			.getByRole('textbox', {name: 'What should this character be called?'})
			.fill('Joren');
		await page.getByRole('button', {name: 'OK'}).click();
		await uploadInto(page, 'Characters', [fixture('joren-idle.png')]);
		await expect(
			page.getByRole('dialog', {name: 'Characters'}).locator('.frame-list-item')
		).toHaveCount(1, {timeout: 20000});

		const assets = page.getByRole('dialog', {name: 'Assets'});
		const tile = assets.locator('.sliders-tile', {hasText: 'Joren'});

		await expect(tile).toBeVisible({timeout: 15000});
		await expect(tile).toContainText('1 frame');
		await expect(tile.locator('.copy-fragment-button')).toHaveAttribute(
			'data-fragment',
			'joren: {at: 0, frame: joren-idle}'
		);

		// Character frames never appear in the flat background list.
		await assets.getByRole('tab', {name: 'Backgrounds'}).click();
		await expect(
			assets.locator('.sliders-tile', {hasText: 'joren-idle'})
		).toHaveCount(0);
		await shot(page, '11-character-tile');
	});
});
