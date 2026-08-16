import {expect, Page, test} from '@playwright/test';
import * as path from 'node:path';
import {BASE_URL, createStory, shot} from './sliders-helpers';

/**
 * Per-frame fit: registration, not expression. Sprite sheets rarely agree, so each frame
 * can be nudged and scaled until the poses line up — and the rig must NOT follow it, or a
 * speech bubble would jitter every time the frame swapped.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const fixture = (name: string) => path.join(FIXTURES, name);

test.describe.configure({mode: 'serial'});

const assetDialog = (page: Page) => page.getByRole('dialog', {name: 'Assets'});
const characterDialog = (page: Page) =>
	page.getByRole('dialog', {name: 'Characters'}).last();

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

/** Drags a handle to a fraction of the sprite frame. */
async function dragHandle(
	editor: import('@playwright/test').Locator,
	page: Page,
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

async function openCharacterWithFrames(page: Page, name: string) {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Assets', exact: true}).click();
	await expect(assetDialog(page)).toBeVisible();
	await assetDialog(page).getByRole('tab', {name: 'Characters'}).click();
	await assetDialog(page).getByRole('button', {name: 'New Character'}).click();
	await page
		.getByRole('textbox', {name: 'What should this character be called?'})
		.fill(name);
	await page.getByRole('button', {name: 'OK'}).click();

	const editor = characterDialog(page);

	await expect(editor).toBeVisible({timeout: 10000});

	// Unmaximized, the preview and the fit controls sit below the fold — a drag aimed at
	// the sprite would land outside the viewport entirely.
	await editor.getByRole('button', {name: 'Maximize'}).click();
	await editor
		.locator('input[type="file"]')
		.setInputFiles([fixture('mira-idle.png'), fixture('mira-angry.png')]);
	await expect(editor.locator('.frame-list-item')).toHaveCount(2, {
		timeout: 25000
	});

	return editor;
}

/** The transform the fit writes onto the frame image. */
const spriteTransform = (page: Page) =>
	characterDialog(page)
		.locator('.sprite-preview-frame > img:not(.sprite-onion)')
		.first()
		.evaluate(el => el.style.transform);

/**
 * An unfitted frame in the EDITOR still writes the identity transform — only the renderer
 * bothers to leave the attribute off. What matters is that it is identity.
 */
const IDENTITY = 'translate(0%, 0%) scale(1)';

test.describe('Per-frame fit', () => {
	test('pans a frame, leaves the rig alone, and persists', async ({page}) => {
		test.setTimeout(180000);
		await clearAssetLibrary(page);
		await createStory(page, 'Frame fit');

		const editor = await openCharacterWithFrames(page, 'Mira');
		const frame = editor.locator('.sprite-preview-frame');

		// Untouched frames store no fit at all.
		expect(await spriteTransform(page)).toBe(IDENTITY);

		const originBefore = await editor
			.locator('[data-readout="origin"]')
			.textContent();
		const box = (await frame.boundingBox())!;

		// Drag the art itself — starting well clear of the origin cross and anchor dots,
		// which take their own mousedown.
		await page.mouse.move(box.x + box.width * 0.85, box.y + box.height * 0.5);
		await page.mouse.down();
		await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.35, {
			steps: 10
		});
		await page.mouse.up();

		const dragged = await spriteTransform(page);

		// Explicitly not identity: `translate(0%, 0%)` would satisfy a looser pattern and
		// let a drag that did nothing pass.
		expect(dragged).not.toBe(IDENTITY);
		expect(dragged).toMatch(/translate\(-\d+\.?\d*%, -\d+\.?\d*%\) scale\(1\)/);

		// The rig stays where it was: you align art to the rig, not the other way round.
		expect(await editor.locator('[data-readout="origin"]').textContent()).toBe(
			originBefore
		);


		// Zoom is uniform and lands on the same image.
		await editor.getByRole('slider', {name: /frame zoom/i}).fill('1.4');
		await expect
			.poll(() => spriteTransform(page))
			.toContain('scale(1.4)');

		await shot(page, 'frame-fit-panned');

		// Selecting the other frame shows an unfitted image, proving fit is per frame.
		await editor.locator('[data-frame="mira-angry"] .frame-list-select').click();
		await expect.poll(() => spriteTransform(page)).toBe(IDENTITY);

		// Back to the first, and the fit survived a round trip through the store.
		await editor.locator('[data-frame="mira-idle"] .frame-list-select').click();
		await expect.poll(() => spriteTransform(page)).toContain('scale(1.4)');

		// Reload: the fit is in the manifest, not just React state. The slider rides the
		// editor's 400ms save debounce -- a drag commits on mouseup, a slider does not --
		// so give that write time to land before pulling the page out from under it.
		await page.waitForTimeout(1500);
		await page.reload();
		await page.getByRole('tab', {name: 'Story'}).click();
		await page.getByRole('button', {name: 'Assets', exact: true}).click();
		await assetDialog(page).getByRole('tab', {name: 'Characters'}).click();
		await assetDialog(page).getByRole('button', {name: 'Edit'}).first().click();
		await expect(characterDialog(page)).toBeVisible({timeout: 10000});
		await characterDialog(page).getByRole('button', {name: 'Maximize'}).click();
		await expect.poll(() => spriteTransform(page)).toContain('scale(1.4)');

		// --- apply to all, and reset ------------------------------------------------
		// Same test rather than a second one: OPFS is scoped to the browser context, and
		// a fresh test would open on an empty library.
		const reopened = characterDialog(page);

		await reopened
			.getByRole('button', {name: 'Apply This Fit To All Frames'})
			.click();
		await reopened.locator('[data-frame="mira-angry"] .frame-list-select').click();
		await expect.poll(() => spriteTransform(page)).toContain('scale(1.4)');

		await reopened.getByRole('button', {name: 'Reset Frame Position'}).click();
		await expect.poll(() => spriteTransform(page)).toBe(IDENTITY);

		// The frame it was copied from keeps its fit -- reset is per frame too.
		await reopened.locator('[data-frame="mira-idle"] .frame-list-select').click();
		await expect.poll(() => spriteTransform(page)).toContain('scale(1.4)');
	});

	/**
	 * Anchors belong to the frame, not the character.
	 *
	 * A character drawn in profile, sitting, or turned away has their mouth somewhere else,
	 * and one rig shared by every pose leaves the speech bubble pointing at the back of
	 * their head. Dragging on one frame therefore has to leave the others alone.
	 */
	test('rigs each frame separately, and applies one rig to all on request', async ({
		page
	}) => {
		test.setTimeout(180000);
		await clearAssetLibrary(page);
		await createStory(page, 'Per-frame anchors');

		const editor = await openCharacterWithFrames(page, 'Mira');
		const bubble = editor.locator('[data-handle="anchor:bubble"]');
		const bubbleX = async () => Number(await bubble.getAttribute('data-x'));

		await expect(bubble).toBeVisible();

		const before = await bubbleX();

		await dragHandle(editor, page, 'anchor:bubble', {x: 0.8, y: 0.12});
		await expect.poll(bubbleX).toBeCloseTo(0.8, 1);

		// The other frame still has the rig it started with.
		await editor.locator('[data-frame="mira-angry"] .frame-list-select').click();
		await expect.poll(bubbleX).toBeCloseTo(before, 2);

		// ...and going back shows the drag, so this is two rigs, not one being reset.
		await editor.locator('[data-frame="mira-idle"] .frame-list-select').click();
		await expect.poll(bubbleX).toBeCloseTo(0.8, 1);

		// Copying a rig across is the escape hatch for a sheet whose poses do line up.
		await editor
			.getByRole('button', {name: 'Apply This Frame\u2019s Anchors To All Frames'})
			.click();
		await editor.locator('[data-frame="mira-angry"] .frame-list-select').click();
		await expect.poll(bubbleX).toBeCloseTo(0.8, 1);

		// Straight through the store, not just React state.
		await page.waitForTimeout(1500);
		await page.reload();
		await page.getByRole('tab', {name: 'Story'}).click();
		await page.getByRole('button', {name: 'Assets', exact: true}).click();
		await assetDialog(page).getByRole('tab', {name: 'Characters'}).click();
		await assetDialog(page).getByRole('button', {name: 'Edit'}).first().click();
		await expect(characterDialog(page)).toBeVisible({timeout: 10000});
		await characterDialog(page).getByRole('button', {name: 'Maximize'}).click();
		await expect
			.poll(async () =>
				Number(
					await characterDialog(page)
						.locator('[data-handle="anchor:bubble"]')
						.getAttribute('data-x')
				)
			)
			.toBeCloseTo(0.8, 1);
	});

	test('opens the asset editor on a frame image', async ({page}) => {
		test.setTimeout(180000);
		await clearAssetLibrary(page);
		await createStory(page, 'Frame edit');

		const editor = await openCharacterWithFrames(page, 'Mira');

		// Frames are ordinary assets, so cropping and background removal are the asset
		// editor -- reached straight from the frame rather than the library, which hides
		// character frames.
		await editor
			.locator('[data-frame="mira-idle"]')
			.getByRole('button', {name: 'Edit Image'})
			.click();

		const assetEditor = page.getByRole('dialog', {name: /^Edit /});

		await expect(assetEditor).toBeVisible({timeout: 20000});
		// Overwriting keeps the asset id, so the frame keeps pointing at it; saving as new
		// reports a fresh id back and the frame is repointed.
		await expect(
			assetEditor.getByRole('button', {name: 'Overwrite Original'})
		).toBeVisible({timeout: 20000});
		await expect(
			assetEditor.getByRole('button', {name: 'Save As New Asset'})
		).toBeVisible();
		await shot(page, 'frame-asset-editor');
	});
});
