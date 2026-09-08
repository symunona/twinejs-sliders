import {expect, Page, test} from '@playwright/test';
import {createStory, skipWelcome} from './sliders-helpers';

/**
 * The route toolbar is exactly two control heights tall, and the rest of the app
 * positions itself against that constant. A `.button-bar` wraps by default, so a
 * tab with more buttons than fit used to grow the second row to two lines --
 * centred in a row half its height, which put the first button on top of the
 * tabs and swallowed every click on them. Nothing else in the suite would say
 * why: Playwright only reports "intercepts pointer events".
 */
async function expectRowsStaySeparate(page: Page, tabs: string[]) {
	for (const tab of tabs) {
		await page.getByRole('tab', {name: tab}).click();

		const layout = await page.evaluate(() => {
			const panels = document.querySelector('.route-toolbar-panels')!;
			const {height, y} = panels.getBoundingClientRect();
			const shadowed = Array.from(
				document.querySelectorAll('.route-toolbar-tab')
			)
				.filter(tabEl => {
					const box = tabEl.getBoundingClientRect();

					return (
						document.elementFromPoint(
							box.x + box.width / 2,
							box.y + box.height / 2
						) !== tabEl
					);
				})
				.map(tabEl => tabEl.textContent);

			return {height, shadowed, y};
		});

		expect(layout.y, `${tab}: second row starts below the first`).toBe(40);
		expect(layout.height, `${tab}: second row is one row tall`).toBeLessThanOrEqual(
			40
		);
		expect(layout.shadowed, `${tab}: tabs covered by the second row`).toEqual([]);
	}
}

/* Narrow enough that the widest tab's buttons cannot all fit at their natural
   size, which is the case that used to wrap. */
for (const width of [1600, 1280, 1024, 800]) {
	test.describe(`route toolbar at ${width}px`, () => {
		test.beforeEach(async ({page}) => {
			await page.setViewportSize({height: 720, width});
		});

		test('the story library toolbar keeps its tabs clickable', async ({
			page
		}) => {
			await skipWelcome(page);
			await expectRowsStaySeparate(page, [
				'Story',
				'Library',
				'Build',
				'View',
				'Twine',
				'Sync'
			]);
		});

		test('the story editor toolbar keeps its tabs clickable', async ({page}) => {
			await createStory(page, `Toolbar ${width} ${Date.now()}`);
			await expectRowsStaySeparate(page, [
				'Passage',
				'Story',
				'Build',
				'Twine',
				'Sync'
			]);
		});
	});
}
