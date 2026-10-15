import {expect, Page, test} from '@playwright/test';
import {
	closeDialogs,
	createStory,
	openPassage,
	setPassageText,
	setStoryFormat,
	showScenePreview
} from './sliders-helpers';

/**
 * The beat panel beside the stage: a press on the bubble opens it, a double click focuses
 * its text box, the box writes the beat's words back into the YAML live as they are typed
 * (Ctrl+B for bold), each prop row shows its default and resets with its X, and the
 * defaults button writes the start passage's vars -- and nothing else.
 */

const START = 'Once upon a time.';

const SCENE = `[scene]
cast:
  mira: {at: -0.3}
beats:
  - mira: {say: "Hello there.", bubble: {as: comic, font: bangers}}
  - mira: "Second line."
`;

function cmText(page: Page) {
	return page
		.locator('.CodeMirror')
		.first()
		.evaluate((el: any) => el.CodeMirror.getValue());
}

/** A passage's text as it sits in `localStorage`, the store of record. */
function storedText(page: Page, name: string) {
	return page.evaluate(passageName => {
		const ids = (window.localStorage.getItem('twine-passages') ?? '')
			.split(',')
			.filter(Boolean);

		for (const id of ids) {
			const raw = window.localStorage.getItem(`twine-passages-${id}`);
			const passage = raw && JSON.parse(raw);

			if (passage?.name === passageName) {
				return passage.text as string;
			}
		}

		return undefined;
	}, name);
}

test('beat panel: pick the bubble, edit its words, hand its style to the story', async ({
	page
}) => {
	test.setTimeout(180000);
	await page.setViewportSize({width: 1400, height: 1000});
	await createStory(page, 'Beat Panel ' + Date.now());
	await setStoryFormat(page, 'Sliders');
	await closeDialogs(page);
	await openPassage(page, 'Untitled Passage');
	await setPassageText(page, START);
	await closeDialogs(page);
	await page.getByRole('tab', {name: 'Passage'}).click();
	await page.getByRole('button', {name: 'New', exact: true}).click();
	// New does not open the editor; the passage is opened like any other.
	await openPassage(page, 'Untitled Passage 1');
	await setPassageText(page, SCENE);
	await showScenePreview(page);
	await page.locator('.scene-stage').first().waitFor({timeout: 20000});

	// Onto the first beat: the line that carries the bubble style.
	await page.getByRole('button', {name: 'Next beat'}).click();
	await expect(page.getByTestId('scene-preview-beat')).toHaveText('1 / 2');

	const bubble = page.locator('.scene-bubble-editor-body');

	await bubble.waitFor({timeout: 10000});
	await expect(page.getByTestId('beat-panel')).toHaveCount(0);

	// A press on the bubble pulls the beat into the side panel.
	await bubble.click();

	const panel = page.getByTestId('beat-panel');
	const text = page.getByTestId('beat-panel-text');

	await expect(panel).toBeVisible();
	await expect(text).toHaveValue('Hello there.');
	await expect(panel.getByTestId('scene-preview-beat-props')).toBeVisible();
	await page.screenshot({path: '/root/tmp/beat-panel-open.png'});

	// A double click on the bubble focuses the words.
	await text.evaluate((el: HTMLElement) => el.blur());
	await bubble.dblclick();
	await expect(text).toBeFocused();

	// Live: the YAML follows the typing, no blur or Enter needed.
	await text.press('Control+a');
	await text.pressSequentially('Goodbye now.', {delay: 40});
	await expect(text).toBeFocused();
	await expect
		.poll(() => cmText(page))
		.toContain(
			'  - mira: {say: "Goodbye now.", bubble: {as: comic, font: bangers}}'
		);

	// Ctrl+B around the word under the caret.
	await text.press('Home');
	await text.press('Control+b');
	await expect(text).toHaveValue('**Goodbye** now.');
	await expect
		.poll(() => cmText(page))
		.toContain(
			'  - mira: {say: "**Goodbye** now.", bubble: {as: comic, font: bangers}}'
		);
	await text.press('Control+b');
	await expect(text).toHaveValue('Goodbye now.');
	await text.press('Enter');
	await expect
		.poll(() => cmText(page))
		.toContain(
			'  - mira: {say: "Goodbye now.", bubble: {as: comic, font: bangers}}'
		);

	// Rows: the stated style is highlighted, an unstated one shows its default.
	const asRow = panel.getByTestId('beat-prop-as');

	await expect(asRow).toHaveClass(/overridden/);
	await expect(panel.getByTestId('beat-prop-place')).toContainText(
		'Default: built-in'
	);
	await expect(panel.getByTestId('beat-props-timing-help')).toHaveAttribute(
		'title',
		/Hold: how long this beat stays/
	);
	await page.screenshot({path: '/root/tmp/beat-panel-rows.png'});
	expect(await cmText(page)).toContain('  - mira: "Second line."');

	const sceneBefore = await cmText(page);

	// Defaults: confirm first, then the start passage gets the vars.
	await panel
		.getByRole('button', {name: 'Make beat styles default for project'})
		.click();
	await expect(
		page.getByText("Write this beat's bubble style", {exact: false})
	).toBeVisible();
	expect(await storedText(page, 'Untitled Passage')).toBe(START);
	await page.getByRole('button', {name: 'OK', exact: true}).click();

	await expect
		.poll(() => storedText(page, 'Untitled Passage'))
		.toBe(
			`sliders.bubble.as: "comic"\nsliders.bubble.font: "bangers"\n--\n${START}`
		);
	// The scene, its beats included, is untouched.
	expect(await cmText(page)).toBe(sceneBefore);
	// The passage save is debounced, so the store catches up a moment later.
	await expect
		.poll(() => storedText(page, 'Untitled Passage 1'))
		.toBe(sceneBefore);
	await page.screenshot({path: '/root/tmp/beat-panel-defaults.png'});

	// Now the story says comic: the beat's own `as` is no longer an override, and its X
	// takes the key off the beat.
	await expect(asRow).not.toHaveClass(/overridden/);
	await expect(asRow).toContainText('Default: comic');
	await asRow.getByRole('button', {name: 'Reset Style to default'}).click();
	await expect
		.poll(() => cmText(page))
		.toContain('  - mira: {say: "Goodbye now.", bubble: {font: bangers}}');

	// The X gives the slot back.
	await panel.getByRole('button', {name: 'Close'}).click();
	await expect(panel).toHaveCount(0);
});
