import {expect, Page} from '@playwright/test';

export const BASE_URL = process.env.SLIDERS_E2E_URL ?? 'http://localhost:5173';

/** Saving passage text is debounced; this waits long enough for it to land. */
export async function waitForPassageSave() {
	await new Promise(resolve => setTimeout(resolve, 1200));
}

/**
 * Get past the first-run welcome flow.
 *
 * One `Skip` click lands directly in the story library and commits the pref — no reload,
 * and no second confirmation button.
 */
export async function skipWelcome(page: Page) {
	await page.goto(BASE_URL);

	const skip = page.getByRole('button', {name: 'Skip'});
	const storyTab = page.getByRole('tab', {name: 'Story'});

	// The app hydrates asynchronously, so wait for EITHER the welcome screen or the
	// library before deciding. Checking isVisible() straight after goto() races and
	// silently skips the click.
	await Promise.race([
		skip.waitFor({timeout: 20000}).catch(() => undefined),
		storyTab.waitFor({timeout: 20000}).catch(() => undefined)
	]);

	if (await skip.isVisible().catch(() => false)) {
		await skip.click();
	}

	await storyTab.waitFor({timeout: 15000});
}

export async function createStory(page: Page, name: string) {
	await skipWelcome(page);
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await page
		.getByRole('textbox', {
			name: 'What should your story be named? You can change this later.'
		})
		.fill(name);
	await page.getByRole('button', {name: 'Create'}).click();
	await expect(page.getByRole('tab', {name: 'Passage'})).toBeVisible();
}

/** Switch the open story to a given story format via Story > Details. */
export async function setStoryFormat(page: Page, formatName: string) {
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Details'}).click();

	const select = page.getByRole('combobox', {name: /story format/i});

	await select.waitFor({timeout: 8000});

	// Formats load asynchronously; the list shows "Loading N Story Formats…" until done.
	await expect
		.poll(async () => (await select.locator('option').allTextContents()).join('|'), {
			timeout: 15000
		})
		.toContain(formatName);

	const labels = await select.locator('option').allTextContents();
	const match = labels.find(l => l.includes(formatName));

	if (!match) {
		throw new Error(`No story format option matching "${formatName}" in: ${labels.join(', ')}`);
	}

	// selectOption needs a literal label, not a regex.
	await select.selectOption({label: match});
	await page.keyboard.press('Escape');
}

/**
 * Make sure we're inside a story's edit route, re-entering from the library if a
 * previous step navigated away. Serial tests share one page, so this keeps each of them
 * from depending on exactly where the last one left off.
 */
export async function openStory(page: Page, name: string) {
	if (
		await page
			.getByRole('tab', {name: 'Passage'})
			.isVisible()
			.catch(() => false)
	) {
		return;
	}

	await closeDialogs(page);
	await page.goto(BASE_URL);
	await page.getByRole('tab', {name: 'Story'}).waitFor({timeout: 15000});
	await page.getByRole('button', {name, exact: true}).click();
	await page.getByRole('button', {name: 'Edit', exact: true}).click();
	await page.getByRole('tab', {name: 'Passage'}).waitFor({timeout: 15000});
}

export async function openPassage(page: Page, name: string) {
	const button = page.getByRole('button', {name, exact: true});

	await button.waitFor({timeout: 15000});
	await button.scrollIntoViewIfNeeded().catch(() => undefined);
	await button.click();
	await expect(page.getByRole('button', {name, exact: true})).toHaveAttribute(
		'aria-pressed',
		'true'
	);
	await page.getByRole('tab', {name: 'Passage'}).click();
	// `exact` matters: the Sliders dialogs add "Edit Character" buttons.
	await page.getByRole('button', {name: 'Edit', exact: true}).click();
}

/**
 * Dismiss any open dialogs so toolbar buttons aren't shadowed.
 *
 * Every click is explicitly bounded: the project sets `actionTimeout: 0`, so a click on
 * a element that never becomes actionable would otherwise hang until the test timeout.
 */
export async function closeDialogs(page: Page) {
	for (let i = 0; i < 8; i++) {
		const close = page.getByRole('button', {name: 'Close', exact: true});

		if ((await close.count()) === 0) {
			return;
		}

		await close
			.last()
			.click({timeout: 3000})
			.catch(() => undefined);
		await page.waitForTimeout(150);
	}
}

/**
 * Replace the open passage's text.
 *
 * CodeMirror doesn't behave like a plain textarea, so this selects all and types.
 */
export async function setPassageText(page: Page, text: string) {
	const editor = page.locator('.CodeMirror textarea').first();

	await editor.click({force: true});
	await page.keyboard.press('Control+a');
	await page.keyboard.press('Delete');
	await editor.fill(text).catch(async () => {
		await page.keyboard.insertText(text);
	});
	await waitForPassageSave();
}

export async function renamePassage(page: Page, newName: string) {
	// There are several Rename buttons (route toolbar, passage dialog) and the route
	// one is disabled whenever no passage is selected. Take the first enabled one.
	const renames = page.getByRole('button', {name: 'Rename'});

	await renames.first().waitFor({timeout: 10000});

	const count = await renames.count();
	let clicked = false;

	for (let i = 0; i < count; i++) {
		if (await renames.nth(i).isEnabled()) {
			await renames.nth(i).click();
			clicked = true;
			break;
		}
	}

	if (!clicked) {
		throw new Error('No enabled Rename button found');
	}

	// PromptButton renders "What should “X” be renamed to?" as the field's label.
	const field = page.getByRole('textbox', {name: /be renamed to/i});

	await field.waitFor({timeout: 5000});
	await field.fill(newName);
	await page.getByRole('button', {name: 'OK'}).click();
	await expect(field).toBeHidden({timeout: 5000});
}

/** Create a new passage and give it a name and text. */
export async function createPassage(page: Page, name: string, text: string) {
	await page.getByRole('tab', {name: 'Passage'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	await renamePassage(page, name);
	await setPassageText(page, text);
}

export async function closeAllDialogs(page: Page) {
	const closeButtons = page.getByRole('button', {name: /^close$/i});
	const count = await closeButtons.count();

	for (let i = count - 1; i >= 0; i--) {
		await closeButtons.nth(i).click().catch(() => undefined);
	}
}

export async function shot(page: Page, name: string) {
	await page.screenshot({path: `/tmp/sliders-shots/${name}.png`, fullPage: false});
}
