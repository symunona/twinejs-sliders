/**
 * Standalone selector check for the Sliders E2E helpers.
 *
 * Not a test — a fast probe that the twinejs UI selectors we rely on still match, run
 * against a dev server before the real suite. Usage:
 *
 *   SLIDERS_E2E_URL=http://localhost:5182 node e2e/check-helpers.mjs
 */
import {chromium} from '@playwright/test';

const BASE = process.env.SLIDERS_E2E_URL ?? 'http://localhost:5182';
const results = [];

function record(step, ok, detail = '') {
	results.push({step, ok, detail});
	console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}${detail ? '  — ' + detail : ''}`);
}

const browser = await chromium.launch();
const page = await browser.newPage();

try {
	await page.goto(BASE, {waitUntil: 'domcontentloaded'});

	// One Skip click lands in the story library and commits the pref. Wait for either
	// screen first — the app hydrates async and isVisible() races otherwise.
	const skip = page.getByRole('button', {name: 'Skip'});
	const storyTab = page.getByRole('tab', {name: 'Story'});
	await Promise.race([
		skip.waitFor({timeout: 20000}).catch(() => undefined),
		storyTab.waitFor({timeout: 20000}).catch(() => undefined)
	]);
	if (await skip.isVisible().catch(() => false)) {
		await skip.click();
	}
	await storyTab.waitFor({timeout: 15000});
	record('skipWelcome', true);

	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	const nameField = page.getByRole('textbox', {
		name: 'What should your story be named? You can change this later.'
	});
	await nameField.waitFor({timeout: 5000});
	await nameField.fill('Helper Probe');
	await page.getByRole('button', {name: 'Create'}).click();
	await page.getByRole('tab', {name: 'Passage'}).waitFor({timeout: 8000});
	record('createStory', true);

	// Story format selector — needed by setStoryFormat().
	await page.getByRole('tab', {name: 'Story'}).click();
	await page.getByRole('button', {name: 'Details'}).click();
	const combo = page.getByRole('combobox', {name: /story format/i});
	const comboOk = await combo.isVisible().catch(() => false);
	const options = comboOk
		? await combo.locator('option').allTextContents()
		: [];
	record('setStoryFormat combobox', comboOk, options.join(' | '));

	await page.keyboard.press('Escape');

	// Open the default passage.
	await page.getByRole('tab', {name: 'Passage'}).click();
	const passageBtn = page.getByRole('button', {name: 'Untitled Passage', exact: true});
	const passageOk = await passageBtn.isVisible().catch(() => false);
	record('default passage button', passageOk);

	if (passageOk) {
		await passageBtn.click();
		await page.getByRole('button', {name: 'Edit'}).click();

		const cm = page.locator('.CodeMirror textarea').first();
		const cmOk = await cm.isVisible().catch(() => false);
		record('CodeMirror textarea', cmOk);

		if (cmOk) {
			await cm.click({force: true});
			await page.keyboard.insertText('probe text one two');
			await page.waitForTimeout(1300);
			const body = await page.locator('.CodeMirror').first().innerText();
			record('typing into CodeMirror', body.includes('probe text'), body.slice(0, 60));
		}

		const renameOk = await page
			.getByRole('button', {name: 'Rename'})
			.isVisible()
			.catch(() => false);
		record('rename button', renameOk);
	}
} catch (error) {
	record('unexpected error', false, error.message);
} finally {
	await page.screenshot({path: '/tmp/sliders-shots/helper-probe.png'});
	await browser.close();
}

const failed = results.filter(r => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
process.exit(failed.length ? 1 : 0);
