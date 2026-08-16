import {expect, Page, test} from '@playwright/test';
import {readFileSync} from 'node:fs';
import * as path from 'node:path';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat
} from './sliders-helpers';

/**
 * The visual editor (spec 10): drag a sprite, resize it, and get YAML back.
 *
 * This is the acceptance test for the one rule the whole design rests on — **the text is
 * the source of truth** — and for the property that makes it usable: a write must be a
 * minimal splice, not a reformat. Every assertion about a surviving comment or a preserved
 * block style is testing that, not being fussy.
 *
 * It also pins ONE gesture = ONE undo, which is the difference between a drag handle people
 * use and one they turn off.
 *
 * No assets are uploaded on purpose. Unresolved entities render as labelled placeholders,
 * which still have real rects, so the geometry is exercised without a fixture dependency.
 */

const SCENE = `[scene]
id: visual-editor-scene
cast:
  mira:  {at: -0.4, frame: idle}   # keep this comment
  joren:
    at: 0.35
    layer: back
beats:
  - mira: "Hello."
`;

/** The live CodeMirror document, not the debounced copy in the story store. */
function cmText(page: Page) {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate((el: any) => el.CodeMirror.getValue());
}

async function openSceneEditor(page: Page, storyName: string) {
	await createStory(page, storyName);
	await setStoryFormat(page, 'Sliders');
	// setStoryFormat leaves Story > Details open, and a second dialog on the stack marks
	// the passage editor disabled.
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, SCENE);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});
}

/** Drag from the centre of an entity's rect by a pixel offset. */
async function dragEntity(page: Page, id: string, dx: number, dy: number) {
	// `.sliders-entity`, not the bare attribute: the selection marker carries the same id.
	const box = (await page
		.locator(`.sliders-entity[data-entity-id="${id}"]`)
		.boundingBox())!;
	const x = box.x + box.width / 2;
	const y = box.y + box.height / 2;

	await page.mouse.move(x, y);
	await page.mouse.down();
	// Stepped, so the drag threshold and the pointermove path are both exercised.
	await page.mouse.move(x + dx, y + dy, {steps: 12});
	await page.mouse.up();
	await page.waitForTimeout(700);
}

test.describe('visual scene editor', () => {
	test('dragging a sprite writes at: and leaves the rest of the file alone', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Drag ' + Date.now());

		const before = await cmText(page);

		await page.locator('[data-entity-id="mira"]').waitFor({timeout: 20000});
		await dragEntity(page, 'mira', 120, 0);

		const after = await cmText(page);

		expect(after).not.toEqual(before);

		// The moved value changed...
		expect(after).not.toContain('at: -0.4,');
		expect(after).toMatch(/mira: {2}\{at: [-0-9.]+, frame: idle\}/);

		// ...and nothing else did. A naive parse -> mutate -> stringify fails every one of
		// these: the comment goes, joren collapses to flow style, the quotes change.
		expect(after).toContain('# keep this comment');
		expect(after).toContain('  joren:\n    at: 0.35\n    layer: back');
		expect(after).toContain('- mira: "Hello."');
		expect(after).toContain('id: visual-editor-scene');
	});

	test('a corner handle writes scale:, and one undo takes it back', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Resize ' + Date.now());

		const mira = page.locator('[data-entity-id="mira"]');

		await mira.waitFor({timeout: 20000});

		// Select it; handles only appear for a single selection.
		const box = (await mira.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(300);

		const handles = page.locator('[data-handle]');

		await expect(handles).toHaveCount(4);

		const beforeResize = await cmText(page);
		const handle = (await handles.first().boundingBox())!;

		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(handle.x + 60, handle.y + 60, {steps: 10});
		await page.mouse.up();
		await page.waitForTimeout(700);

		const afterResize = await cmText(page);

		expect(afterResize).toMatch(/scale: [0-9.]+/);
		expect(afterResize).toContain('# keep this comment');

		// One gesture, one history entry. A drag that costs sixty undos is unusable, and a
		// drag that costs zero has not gone through the document at all.
		await page.locator('.CodeMirror textarea').first().click({force: true});
		await page.keyboard.press('Control+z');
		await page.waitForTimeout(500);

		expect(await cmText(page)).toEqual(beforeResize);
	});

	/**
	 * The regression this file exists to keep out.
	 *
	 * A resize is a press-and-move over the stage, and without a `preventDefault` the browser
	 * treats it as a text selection. The next press then lands INSIDE that selection, which
	 * starts a native drag, which makes the browser take the pointer away and fire
	 * `pointercancel` — so the drag in flight was thrown away and the sprite snapped back to
	 * where it started. Three gestures in a row is the shortest sequence that shows it.
	 */
	test('a drag still works after a resize', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Drag After Resize ' + Date.now());

		const mira = page.locator('.sliders-entity[data-entity-id="mira"]');

		await mira.waitFor({timeout: 20000});

		const box = (await mira.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(300);

		await dragEntity(page, 'mira', 100, 0);

		const handles = page.locator('[data-handle]');

		await expect(handles).toHaveCount(4);

		const handle = (await handles.first().boundingBox())!;

		await page.mouse.move(handle.x + handle.width / 2, handle.y + handle.height / 2);
		await page.mouse.down();
		await page.mouse.move(handle.x - 40, handle.y - 40, {steps: 10});
		await page.mouse.up();
		await page.waitForTimeout(700);

		const afterResize = await cmText(page);

		expect(afterResize).toMatch(/scale: [0-9.]+/);

		await dragEntity(page, 'mira', 80, 0);

		// The third gesture has to reach the document. Comparing whole documents rather than
		// just looking for `at:` — the pointercancel bug wrote nothing at all.
		expect(await cmText(page)).not.toEqual(afterResize);
	});

	test('the lock stops the stage editing the file, and survives a reload', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Lock ' + Date.now());

		const mira = page.locator('.sliders-entity[data-entity-id="mira"]');

		await mira.waitFor({timeout: 20000});

		const lock = page.getByRole('button', {name: /^Lock the stage/});

		await lock.click();
		await page.waitForTimeout(300);

		const locked = await cmText(page);

		// Selection still works — the lock is about writing, not about looking.
		const box = (await mira.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(300);

		// No resize handles, because there is nothing to resize into.
		await expect(page.locator('[data-handle]')).toHaveCount(0);

		await dragEntity(page, 'mira', 120, 0);
		expect(await cmText(page)).toEqual(locked);

		// Keyboard gestures are off too.
		await page.keyboard.press('f');
		await page.waitForTimeout(500);
		expect(await cmText(page)).toEqual(locked);

		// The lock is a working posture, not a per-dialog toggle, so it is remembered.
		expect(
			await page.evaluate(() => window.localStorage.getItem('sliders.preview.locked'))
		).toEqual('true');

		await page.getByRole('button', {name: 'Unlock the stage'}).click();
		await page.waitForTimeout(300);
		await dragEntity(page, 'mira', 120, 0);
		expect(await cmText(page)).not.toEqual(locked);
	});

	/**
	 * The selection toolbar is always in the layout, empty or not. In full screen the stage
	 * takes whatever height is left, so a row that appeared with the selection would resize
	 * the stage — and the whole scene would jump — on the very click that selected a sprite.
	 */
	test('selecting a sprite in full screen does not move the stage', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Full Screen ' + Date.now());

		await page.locator('.sliders-entity[data-entity-id="mira"]').waitFor({
			timeout: 20000
		});
		await page.getByRole('button', {name: 'Full screen'}).click();
		await page.waitForTimeout(500);

		const stage = page.locator('.scene-stage');
		const before = (await stage.boundingBox())!;
		const mira = page.locator('.sliders-entity[data-entity-id="mira"]');
		const sprite = (await mira.boundingBox())!;

		await page.mouse.click(sprite.x + sprite.width / 2, sprite.y + sprite.height / 2);
		await page.waitForTimeout(400);

		await expect(page.getByTestId('scene-preview-selection')).toBeVisible();

		const after = (await stage.boundingBox())!;

		expect(after.height).toEqual(before.height);
		expect(after.y).toEqual(before.y);
	});

	test('an image file dropped on the stage becomes a prop', async ({page}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor File Drop ' + Date.now());

		const stage = page.locator('.stage-editor');

		await stage.waitFor({timeout: 20000});

		const png = readFileSync(
			path.join(__dirname, 'fixtures', 'assets', 'table.png')
		).toString('base64');
		const box = (await stage.boundingBox())!;

		// Playwright cannot synthesize an OS drag, so the drop is dispatched by hand — the
		// `DataTransfer` and the `File` on it are exactly what a real drop carries.
		await stage.evaluate(
			(element, {base64, clientX, clientY}) => {
				const bytes = Uint8Array.from(atob(base64), c => c.charCodeAt(0));
				const file = new File([bytes], 'dropped-table.png', {type: 'image/png'});
				const data = new DataTransfer();

				data.items.add(file);

				for (const type of ['dragover', 'drop']) {
					element.dispatchEvent(
						new DragEvent(type, {
							bubbles: true,
							cancelable: true,
							clientX,
							clientY,
							dataTransfer: data
						})
					);
				}
			},
			{
				base64: png,
				clientX: Math.round(box.x + box.width * 0.35),
				clientY: Math.round(box.y + box.height * 0.7)
			}
		);

		await expect
			.poll(() => cmText(page), {timeout: 20000})
			.toMatch(/props:\s*\n\s*dropped-table: \{at:/);

		// It went through the library, so it is a real asset with a name scenes can use.
		expect(await cmText(page)).toContain('# keep this comment');
	});

	test('keyboard gestures on the selection write their own keys', async ({
		page
	}) => {
		test.setTimeout(180000);
		await openSceneEditor(page, 'Visual Editor Keys ' + Date.now());

		const mira = page.locator('[data-entity-id="mira"]');

		await mira.waitFor({timeout: 20000});

		const box = (await mira.boundingBox())!;

		await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
		await page.waitForTimeout(300);

		// f flips. Full screen had to move to shift+f to free this key up.
		await page.keyboard.press('f');
		await page.waitForTimeout(600);
		expect(await cmText(page)).toContain('flip: true');

		// ...and flipping back removes the key rather than writing the default out.
		await page.keyboard.press('f');
		await page.waitForTimeout(600);
		expect(await cmText(page)).not.toContain('flip:');

		// mod+] steps the layer. Shift+bracket is unbindable: the browser reports it as }.
		await page.keyboard.press('ControlOrMeta+]');
		await page.waitForTimeout(600);
		expect(await cmText(page)).toMatch(/mira:.*layer: (mid|front)/);

		// Delete removes the entry. This scene has no from:, so it goes entirely.
		await page.keyboard.press('Delete');
		await page.waitForTimeout(700);

		const afterDelete = await cmText(page);

		expect(afterDelete).not.toContain('mira:  {');
		// The other cast member and the beats are untouched.
		expect(afterDelete).toContain('  joren:\n    at: 0.35\n    layer: back');
		expect(afterDelete).toContain('- mira: "Hello."');
	});
});
