/**
 * Manual verification that the scene preview renders inside the Twine passage editor.
 * Run against a dev server:  U=http://127.0.0.1:5183 node verify-preview.mjs
 */
import {chromium} from '@playwright/test';
import {readFileSync} from 'node:fs';

const U = process.env.U ?? 'http://127.0.0.1:5183';
const SCENE = `[scene]
id: tavern-night
bg: tavern-night

cast:
  mira:  {at: -0.4, frame: arms-crossed}
  joren: {at: 0.35, frame: idle, flip: true, layer: back}

props:
  table: {at: 0}

beats:
  - mira: "You shouldn't have come back."
  - joren: "And yet."
  - mark: tense
  - mira: {frame: angry, at: -0.25, say: "Get out."}
  - box: "The candle gutters."
`;

const browser = await chromium.launch();
const page = await browser.newPage({viewport: {width: 1400, height: 1000}});
const logs = [];
page.on('console', m => m.type() === 'error' && logs.push(m.text()));
page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));

await page.goto(U);
const skip = page.getByRole('button', {name: 'Skip'});
const tab = page.getByRole('tab', {name: 'Story'});
await Promise.race([
	skip.waitFor({timeout: 20000}).catch(() => {}),
	tab.waitFor({timeout: 20000}).catch(() => {})
]);
if (await skip.isVisible().catch(() => false)) await skip.click();
await tab.waitFor();

await page.getByRole('button', {name: 'New', exact: true}).click();
await page
	.getByRole('textbox', {name: /what should your story be named/i})
	.fill('Preview Verify');
await page.getByRole('button', {name: 'Create'}).click();
await page.getByRole('tab', {name: 'Passage'}).waitFor();

await page.getByRole('button', {name: 'Untitled Passage', exact: true}).click();
await page.getByRole('tab', {name: 'Passage'}).click();
await page.getByRole('button', {name: 'Edit'}).click();

const cm = page.locator('.CodeMirror textarea').first();
await cm.click({force: true});
await page.keyboard.insertText(SCENE);
await page.waitForTimeout(2000);

const preview = page.getByTestId('scene-preview');
console.log('preview visible:', await preview.isVisible().catch(() => false));

const info = await page.evaluate(() => {
	const p = document.querySelector('[data-testid="scene-preview"]');
	if (!p) return null;
	return {
		entities: [...p.querySelectorAll('[data-entity-id]')].map(e => ({
			id: e.getAttribute('data-entity-id'),
			layer: e.getAttribute('data-layer'),
			transform: getComputedStyle(e).transform.slice(0, 60)
		})),
		layers: [...p.querySelectorAll('.sliders-layer')].map(e =>
			e.getAttribute('data-layer')
		),
		bubbles: [...p.querySelectorAll('.sliders-bubble')].map(e => e.textContent.trim()),
		placeholders: [...p.querySelectorAll('.sliders-placeholder')].map(e =>
			e.getAttribute('data-asset-id')
		),
		beat: p.querySelector('[data-testid="scene-preview-beat"]')?.textContent,
		errors: [...p.querySelectorAll('[data-testid="scene-preview-errors"] li')].map(e =>
			e.textContent.trim()
		)
	};
});
console.log(JSON.stringify(info, null, 1));

await page.screenshot({path: '/tmp/sliders-shots/verify-preview-beat0.png'});

// Step every beat and report what the dialogue layer shows.
for (let i = 1; i <= 5; i++) {
	await page.getByRole('button', {name: 'Next beat'}).click();
	await page.waitForTimeout(500);
	const d = await page.evaluate(() => {
		const p = document.querySelector('[data-testid="scene-preview"]');
		return {
			beat: p.querySelector('[data-testid="scene-preview-beat"]')?.textContent,
			bubbles: [...p.querySelectorAll('.sliders-bubble')].map(e => ({
				who: e.getAttribute('data-speaker'),
				text: e.textContent.trim().slice(0, 40),
				left: Math.round(e.getBoundingClientRect().left),
				top: Math.round(e.getBoundingClientRect().top)
			})),
			box: p.querySelector('.sliders-box')?.textContent.trim().slice(0, 40) ?? null
		};
	});
	console.log('beat', i, JSON.stringify(d));
}
await page.screenshot({path: '/tmp/sliders-shots/verify-preview-final.png'});
console.log('console errors:', logs.filter(l => !/Warning:/.test(l)).slice(0, 4));
await browser.close();
