import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	waitForPassageSave
} from './sliders-helpers';

/**
 * The Scene menu in the story format's toolbar.
 *
 * Worth driving through the real UI because the menu lives in ANOTHER REPO
 * (sliders-format) and reaches this one only through
 * `localStorage['sliders-last-scene']`. Nothing type-checks across that seam —
 * only this test does.
 *
 * One test, not three: it is a single story built up step by step, and each step
 * depends on what the last one left in the editor.
 */

const STORY_NAME = 'Scene Toolbar E2E';

const TAVERN_SCENE = [
	'[scene]',
	'id: e2e-tavern',
	'bg: tavern-night',
	'cast:',
	'  mira: {at: -0.4}',
	'props:',
	'  candle: {at: 0.1}',
	'beats:',
	'  - mira: "The last thing I edited."',
	''
].join('\n');

/** CodeMirror is not a textarea; ask the instance itself what it holds. */
function editorValue(page: Page) {
	return page.evaluate(
		() =>
			(
				document.querySelector('.CodeMirror') as unknown as
					| {CodeMirror: {getValue(): string}}
					| undefined
			)?.CodeMirror.getValue() ?? ''
	);
}

/**
 * Add a passage and open its editor. Twine's New button creates a passage but
 * leaves the editor closed, and names it `Untitled Passage <n>` — which is what
 * the caller passes, since the names do not matter here.
 */
async function newPassage(page: Page, defaultName: string) {
	await closeDialogs(page);
	await page.getByRole('tab', {name: 'Passage'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await closeDialogs(page);
	await openPassage(page, defaultName);
}

async function sceneMenuItem(page: Page, item: RegExp) {
	await page.getByRole('button', {name: 'Scene', exact: true}).click();

	const button = page.getByRole('button', {name: item});

	await button.waitFor({timeout: 5000});
	await button.click();
	await waitForPassageSave();
}

test('the Scene menu inserts, remembers and overlays scenes', async ({page}) => {
	await createStory(page, STORY_NAME);

	// --- Insert Scene: the skeleton is the one place to learn the format ----
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, '');
	await sceneMenuItem(page, /^Insert Scene$/);

	const skeleton = await editorValue(page);

	for (const key of [
		'id:',
		'from:',
		'bg:',
		'camera:',
		'cast:',
		'props:',
		'fx:',
		'beats:',
		'links:'
	]) {
		expect(skeleton).toContain(key);
	}

	// The badge renders only when the scene has errors or warnings.
	await expect(page.getByTestId('scene-preview-badge')).toHaveCount(0);

	// --- Editing a scene makes it the last scene ---------------------------
	await setPassageText(page, TAVERN_SCENE);
	await waitForPassageSave();
	await newPassage(page, 'Untitled Passage 1');
	await sceneMenuItem(page, /^Insert Last Scene \(e2e-tavern\)$/);

	const copied = await editorValue(page);

	expect(copied).toContain('bg: tavern-night');
	expect(copied).toContain('The last thing I edited.');
	// A verbatim copy would be a duplicate id.
	expect(copied).not.toMatch(/^id: e2e-tavern$/m);
	await expect(page.getByTestId('scene-preview-badge')).toHaveCount(0);

	// --- Overlay: a patch that names the scene it builds on -----------------
	await newPassage(page, 'Untitled Passage 2');
	await sceneMenuItem(page, /^Overlay on 'e2e-tavern'$/);

	const overlay = await editorValue(page);

	expect(overlay).toContain('id: e2e-tavern-next');
	expect(overlay).toContain('from: e2e-tavern');
	// The stub patches a character the base scene actually has.
	expect(overlay).toContain('Inherited cast: mira');
	expect(overlay).toContain('mira: {at: -0.4}');
});
