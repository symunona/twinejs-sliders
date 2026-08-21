import {expect, Page, test} from '@playwright/test';
import * as path from 'node:path';
import {
	BROKEN_PASSAGE,
	SAMPLE_PASSAGES,
	SAMPLE_STORY_NAME
} from './fixtures/sample-story';
import {
	BASE_URL,
	createStory,
	closeDialogs,
	openPassage,
	openSceneErrors,
	openStory,
	renamePassage,
	setPassageText,
	shot
} from './sliders-helpers';

/**
 * The whole pipeline, through the real UI:
 *
 *   upload assets -> define characters -> author scenes -> preview renders REAL sprites
 *   -> beats drive bubbles -> scene links reach the story map -> errors surface
 *
 * This is the acceptance test for the spec in docs/sliders/.
 */

const FIXTURES = path.join(__dirname, 'fixtures', 'assets');
const fixture = (name: string) => path.join(FIXTURES, name);

test.describe.configure({mode: 'serial'});

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
	await expect(assetDialog(page)).toBeVisible();
}

const assetDialog = (page: Page) => page.getByRole('dialog', {name: 'Assets'});

/** Character dialogs stack on top of the Assets dialog, so scope tab clicks to it. */
async function assetTab(page: Page, name: string) {
	await assetDialog(page).getByRole('tab', {name}).click();
}

async function uploadInto(page: Page, dialogName: string, files: string[]) {
	await page
		.getByRole('dialog', {name: dialogName})
		.locator('input[type="file"]')
		.setInputFiles(files);
}

/** Frame names default to the filename slug; scenes refer to them by `frame:`. */
async function renameFrame(page: Page, from: string, to: string) {
	// One dialog per character (D8), so target the most recently opened.
	const editor = page.getByRole('dialog', {name: 'Characters'}).last();
	const item = editor.locator(`[data-frame="${from}"]`);

	await item.scrollIntoViewIfNeeded();
	await item.getByRole('button', {name: 'Rename Frame'}).click();
	await page
		.getByRole('textbox', {name: /what should this frame be called/i})
		.fill(to);
	await page.getByRole('button', {name: 'OK'}).click();
	await expect(editor.locator(`[data-frame="${to}"]`)).toBeVisible({
		timeout: 10000
	});
}

async function createCharacter(
	page: Page,
	name: string,
	frames: {file: string; as: string}[]
) {
	await assetTab(page, 'Characters');
	await assetDialog(page).getByRole('button', {name: 'New Character'}).click();
	await page
		.getByRole('textbox', {name: 'What should this character be called?'})
		.fill(name);
	await page.getByRole('button', {name: 'OK'}).click();

	const editor = page.getByRole('dialog', {name: 'Characters'}).last();

	await expect(editor).toBeVisible({timeout: 10000});
	await editor.locator('input[type="file"]').setInputFiles(frames.map(f => fixture(f.file)));
	await expect(editor.locator('.frame-list-item')).toHaveCount(frames.length, {
		timeout: 25000
	});

	for (const frame of frames) {
		const slug = frame.file.replace(/\.[a-z]+$/, '');

		if (slug !== frame.as) {
			await renameFrame(page, slug, frame.as);
		}
	}
}

test.describe('Sliders end to end', () => {
	test('builds the sample story and renders real sprites in the preview', async ({
		page
	}) => {
		// Uploads four sprites plus two backgrounds and transcodes each to WebP.
		test.setTimeout(300000);
		// Cleared once, not per test — the later tests in this serial block read the
		// library and the story this one builds.
		await clearAssetLibrary(page);
		await createStory(page, SAMPLE_STORY_NAME);

		// --- assets -------------------------------------------------------
		await openAssetManager(page);
		await uploadInto(page, 'Assets', [
			fixture('tavern-night.png'),
			fixture('street-dusk.png')
		]);
		await expect(
			page.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toBeVisible({timeout: 20000});

		await assetTab(page, 'Objects');
		await uploadInto(page, 'Assets', [
			fixture('table.png'),
			fixture('candle-flicker.gif')
		]);
		await expect(page.locator('.sliders-tile', {hasText: 'table'})).toBeVisible({
			timeout: 20000
		});

		// The animated GIF must survive upload as a GIF, not be flattened to WebP.
		await expect(
			page.locator('.sliders-tile', {hasText: 'candle-flicker'})
		).toContainText('gif');
		await shot(page, 'int-01-assets');

		// --- characters ---------------------------------------------------
		await createCharacter(page, 'mira', [
			{file: 'mira-idle.png', as: 'idle'},
			{file: 'mira-arms-crossed.png', as: 'arms-crossed'},
			{file: 'mira-angry.png', as: 'angry'}
		]);
		await shot(page, 'int-02-character-mira');

		await createCharacter(page, 'joren', [{file: 'joren-idle.png', as: 'idle'}]);
		await shot(page, 'int-03-character-joren');

		await closeDialogs(page);

		// --- author the story ---------------------------------------------
		const [first, ...rest] = SAMPLE_PASSAGES;

		await openPassage(page, 'Untitled Passage');
		await renamePassage(page, first.name);
		await setPassageText(page, first.text);

		const preview = page.getByTestId('scene-preview');

		await expect(preview).toBeVisible({timeout: 10000});

		// THE point of the whole exercise: real images, not placeholders.
		await expect(preview.locator('[data-entity-id="mira"] img')).toBeVisible({
			timeout: 20000
		});
		await expect(preview.locator('[data-entity-id="joren"] img')).toBeVisible({
			timeout: 20000
		});
		await expect(preview.locator('img.sliders-bg')).toBeVisible({timeout: 20000});
		await expect(preview.locator('.sliders-placeholder')).toHaveCount(0, {
			timeout: 20000
		});
		await shot(page, 'int-04-preview-real-sprites');

		// Layers land where the scene said.
		await expect(preview.locator('[data-entity-id="joren"]')).toHaveAttribute(
			'data-layer',
			'back'
		);
		await expect(preview.locator('[data-entity-id="mira"]')).toHaveAttribute(
			'data-layer',
			'mid'
		);

		// --- beats drive dialogue -----------------------------------------
		await expect(page.getByTestId('scene-preview-beat')).toHaveText('0 / 7');
		await page.getByRole('button', {name: 'Next beat'}).click();

		const bubble = preview.locator('.sliders-bubble');

		await expect(bubble).toHaveCount(1);
		await expect(bubble).toHaveAttribute('data-speaker', 'mira');
		await expect(bubble).toContainText("You shouldn't have come back");
		await shot(page, 'int-05-beat-bubble');

		await page.getByRole('button', {name: 'Next beat'}).click();
		await expect(bubble).toHaveAttribute('data-speaker', 'joren');

		// --- remaining passages -------------------------------------------
		// Twine auto-creates a passage for every new [[link]] in the source, so the
		// targets already exist; opening them also proves the link parsing worked.
		await closeDialogs(page);

		for (const passage of rest) {
			await openPassage(page, passage.name);
			await setPassageText(page, passage.text);
			await closeDialogs(page);
		}

		await shot(page, 'int-06-all-passages');

		await test.step('a from: scene inherits the stage it patches', async () => {
			await closeDialogs(page);
			await openPassage(page, 'Tavern - Fight');

			const preview = page.getByTestId('scene-preview');

			await expect(preview).toBeVisible({timeout: 10000});

			// `from: tavern-night@tense` never declares joren or the props, but they are
			// inherited, so they must still be on stage.
			await expect(preview.locator('[data-entity-id="joren"]')).toBeVisible({
				timeout: 20000
			});
			await expect(preview.locator('[data-entity-id="table"]')).toBeVisible({
				timeout: 20000
			});

			// And mira's patch applied on top of what was inherited.
			await expect(preview.locator('[data-entity-id="mira"]')).toBeVisible();
			await shot(page, 'int-07-from-patch');
		});

		await test.step('entity removal with ~ takes characters off the stage', async () => {
			await closeDialogs(page);
			await openPassage(page, 'Street');

			const preview = page.getByTestId('scene-preview');

			await expect(preview).toBeVisible({timeout: 10000});
			await expect(preview.locator('[data-entity-id="mira"]')).toBeVisible({
				timeout: 20000
			});

			// Street sets `joren: ~`, `candle: ~`, `table: ~`.
			await expect(preview.locator('[data-entity-id="joren"]')).toHaveCount(0);
			await expect(preview.locator('[data-entity-id="table"]')).toHaveCount(0);
			await shot(page, 'int-08-removal');
		});

		await test.step('scene links reach the story map', async () => {
			await closeDialogs(page);

			// Both link forms must be found by parsePassageText.
			for (const target of ['Tavern - Fight', 'Street']) {
				await expect(
					page.getByRole('button', {name: target, exact: true})
				).toBeVisible();
			}
		});

		await test.step('reports scene errors without blanking the preview', async () => {
			await closeDialogs(page);
			// Runs last, so it can safely overwrite an existing passage rather than
			// needing an unreachable one.
			await openPassage(page, 'Street');
			await setPassageText(page, BROKEN_PASSAGE.text);

			const errors = await openSceneErrors(page);

			await expect(errors).toBeVisible({timeout: 10000});
			await expect(errors).toContainText('chast');
			await expect(errors).toContainText('cast');
			await expect(errors).toContainText(/layer/i);

			// Crucially the stage still rendered.
			await expect(
				page.getByTestId('scene-preview').locator('.scene-stage')
			).toBeVisible();
			await shot(page, 'int-09-errors');
		});

	});
});
