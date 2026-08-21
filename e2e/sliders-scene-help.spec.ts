import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	openSceneErrors,
	setPassageText,
	waitForPassageSave
} from './sliders-helpers';

/**
 * Three things an author meets before they know the format: the help window, the links
 * Insert Scene fills in for them, and the underline under a variable nothing sets.
 *
 * One story, built up step by step, because each step needs what the last one left in the
 * editor — the same reason `sliders-scene-toolbar.spec.ts` is one test.
 */

const STORY_NAME = 'Scene Help E2E';

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

async function sceneMenuItem(page: Page, item: RegExp) {
	await page.getByRole('button', {name: 'Scene', exact: true}).click();

	const button = page.getByRole('button', {name: item});

	await button.waitFor({timeout: 5000});
	await button.click();
	await waitForPassageSave();
}

test('scene help, prefilled links and unset variables', async ({page}) => {
	await createStory(page, STORY_NAME);
	await openPassage(page, 'Untitled Passage');

	// --- The help window ----------------------------------------------------
	await page.getByRole('button', {name: 'Scene help'}).click();

	const help = page.getByRole('dialog', {name: 'Scene Help'});

	await expect(help).toBeVisible();
	// The completion key sits above the tabs, where every section can see it.
	await expect(help.getByText('pick a name instead of typing it')).toBeVisible();

	for (const tab of [
		'Scene',
		'Stage',
		'Characters',
		'Beats',
		'Animation',
		'Links',
		'Reuse'
	]) {
		await help.getByRole('tab', {name: tab, exact: true}).click();
	}

	// Every top-level key is documented; the tables are built from the parser's own list.
	await help.getByRole('tab', {name: 'Scene', exact: true}).click();

	for (const key of ['id', 'from', 'bg', 'camera', 'cast', 'props', 'fx', 'beats']) {
		await expect(help.getByRole('rowheader', {name: key, exact: true})).toBeVisible();
	}

	await help.getByRole('button', {name: 'Close'}).click();

	// --- Insert Scene borrows the links the passage already has -------------
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, 'Go out to [[Street]] or [[Fight->Tavern Fight]].');
	await sceneMenuItem(page, /^Insert Scene$/);

	const filled = await editorValue(page);

	// The example's forward target is gone; the passage's real links took its place, one
	// keeping the worked example's props and the rest written out plainly.
	expect(filled).not.toContain('Next Passage');
	expect(filled).toContain('Street: {to: Street, if: has_weapon');
	expect(filled).toContain('Fight: {to: Tavern Fight}');
	// Nothing links TO this passage yet, so the back example is left as it was: a worked
	// example beats a half-rewritten one.
	expect(filled).toContain('back:   Other Passage');

	// --- if: on a variable nothing sets ------------------------------------
	// The skeleton keeps teaching `if:`, so the one error left is that variable.
	const errors = await openSceneErrors(page);

	await expect(errors).toContainText('has_weapon');

	// Setting it in a vars section clears that error. The still-unwritten `Other Passage`
	// the back example points at is a different complaint, and stays.
	await setPassageText(
		page,
		`has_weapon: true\n--\n${filled.replace(/^\n/, '')}`
	);
	await waitForPassageSave();
	await expect(await openSceneErrors(page)).not.toContainText('has_weapon', {
		timeout: 10000
	});

	// --- back: comes from whatever links here -------------------------------
	await closeDialogs(page);
	await openPassage(page, 'Street');
	await setPassageText(page, 'A wet street.');
	await sceneMenuItem(page, /^Insert Scene$/);

	const street = await editorValue(page);

	expect(street).toContain('back:   Untitled Passage');
	// Street links nowhere, so the forward example stays a worked example.
	expect(street).toContain('onward: {to: Next Passage');

	await closeDialogs(page);
});
