/**
 * Server sync, stories 1–3 of spec 11: publish, check out, and the change bus.
 *
 * Alice and Bob are two browser contexts against one real Go server. Nothing in here
 * reloads a page to make an assertion pass — the whole point of story 3 is that Bob's
 * copy catches up while he is looking at it.
 */

import {
	addPassage,
	assetFixture,
	editorText,
	enterStory,
	expect,
	expectSyncState,
	ghostCard,
	goToLibrary,
	newStory,
	openAssetManager,
	openPassageEditor,
	passageCard,
	previewImageWidth,
	publishStory,
	refreshServer,
	serverPassageText,
	storyCard,
	syncBadge,
	test,
	typePassage,
	uploadAssets
} from './server-helpers';

const STORY = 'Lighthouse';

/** The scene the checkout test carries art for. `bg:` resolves by name, not by id. */
const SCENE_TEXT = `[scene]
id: tavern
bg: tavern-night
`;

test.describe('Server sync: publish, check out, live edits', () => {
	test('Publish makes a ghost', async ({alice, bob, server}) => {
		await newStory(alice.page, STORY);
		await addPassage(alice.page, 'Harbour', 'The lamp turns.');
		await goToLibrary(alice.page);
		await publishStory(alice.page, STORY);
		await expectSyncState(alice.page, STORY, 'idle');

		// The server's own view first: if this is wrong, nothing the UI says matters.
		await expect
			.poll(async () => (await server.storyNamed(STORY))?.passageCount ?? 0, {
				message: 'server never listed the published story',
				timeout: 20000
			})
			.toBe(2);

		// Bob had connected before Alice published, so he has to ask again.
		await refreshServer(bob.page);

		const ghost = ghostCard(bob.page, STORY);

		await expect(ghost).toBeVisible({timeout: 20000});
		await expect(ghost).toContainText('2 passages');
		await expect(ghost).toContainText('On server');
		await expect(bob.page.getByTestId('story-group-ghosts')).toContainText(
			STORY
		);

		// A ghost is an index entry, not a local story: Bob has no card of his own.
		await expect(storyCard(bob.page, STORY)).toHaveCount(0);
	});

	test('Check out pins it', async ({alice, bob, server}) => {
		await newStory(alice.page, STORY);
		await uploadAssets(alice.page, [assetFixture('tavern-night.png')]);
		await expect(
			alice.page.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toBeVisible({timeout: 30000});
		await alice.page.keyboard.press('Escape');

		await openPassageEditor(alice.page, 'Untitled Passage');
		await typePassage(alice.page, SCENE_TEXT);

		// Sanity: the art resolves for Alice, so anything missing for Bob was lost by
		// the sync rather than never present.
		expect(await previewImageWidth(alice.page)).toBe(1280);

		await goToLibrary(alice.page);
		await publishStory(alice.page, STORY);
		await expectSyncState(alice.page, STORY, 'idle');

		// The manifest is written after the blobs it names, so waiting for one asset in
		// the index means the bytes are already there.
		await expect
			.poll(async () => (await server.storyNamed(STORY))?.assetCount ?? 0, {
				message: 'the asset never reached the server',
				timeout: 30000
			})
			.toBe(1);

		await refreshServer(bob.page);
		await expect(ghostCard(bob.page, STORY)).toBeVisible({timeout: 20000});
		await bob.page.getByTestId('ghost-checkout').click();

		// The card moves out of the dimmed group and into the pinned one.
		const synced = bob.page.getByTestId('story-group-synced');

		await expect(synced).toContainText(STORY, {timeout: 60000});
		await expect(ghostCard(bob.page, STORY)).toHaveCount(0);
		await expect(syncBadge(bob.page, STORY)).toBeVisible();

		await enterStory(bob.page, STORY);
		await openPassageEditor(bob.page, 'Untitled Passage');
		expect(await editorText(bob.page)).toBe(SCENE_TEXT);

		// Real bytes, not a manifest row: the preview decoded a 1280px picture.
		expect(await previewImageWidth(bob.page)).toBe(1280);

		await bob.page.keyboard.press('Escape');

		const assets = await openAssetManager(bob.page);

		await expect(
			assets.locator('.sliders-tile', {hasText: 'tavern-night'})
		).toBeVisible({timeout: 30000});
	});

	test('Edit flows across', async ({alice, bob, server}) => {
		await newStory(alice.page, STORY);
		await addPassage(alice.page, 'Harbour', 'The lamp turns.');
		await goToLibrary(alice.page);
		await publishStory(alice.page, STORY);
		await expectSyncState(alice.page, STORY, 'idle');

		await refreshServer(bob.page);
		await expect(ghostCard(bob.page, STORY)).toBeVisible({timeout: 20000});
		await bob.page.getByTestId('ghost-checkout').click();
		await expect(bob.page.getByTestId('story-group-synced')).toContainText(
			STORY,
			{timeout: 60000}
		);

		// Bob parks on the story map and never touches the page again.
		await enterStory(bob.page, STORY);
		await expect(passageCard(bob.page, 'Harbour')).toContainText(
			'The lamp turns.'
		);

		const storyId = (await server.storyNamed(STORY))!.id;

		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, 'Harbour');
		await typePassage(alice.page, 'The lamp has gone out.');

		await expect
			.poll(() => serverPassageText(server, storyId, 'Harbour'), {
				message: "alice's edit never reached the server",
				timeout: 20000
			})
			.toBe('The lamp has gone out.');

		// The assertion that needs the change bus: no reload, no refresh click.
		await expect(passageCard(bob.page, 'Harbour')).toContainText(
			'The lamp has gone out.',
			{timeout: 20000}
		);
	});
});
