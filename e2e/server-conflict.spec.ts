/**
 * Story 8 of spec 11: two people write the same story, one of them offline.
 *
 * The server never merges and never loses a version, so both halves of the resolve
 * dialog are tested: *Keep mine* pushes over the server (their version is still a
 * snapshot), *Take theirs* keeps the local text as a separate story first. Nothing here
 * asserts that a conflict is rare — only that when one happens, both versions survive.
 */

import type {Editor} from './server-helpers';
import {
	addPassage,
	backToLibrary,
	enterStory,
	expect,
	expectSyncState,
	ghostCard,
	goOffline,
	goOnline,
	goToLibrary,
	newStory,
	openPassageEditor,
	passageCard,
	publishStory,
	refreshServer,
	selectStory,
	serverPassageText,
	storyCard,
	syncSnapshot,
	test,
	typePassage,
	type TestServer
} from './server-helpers';

const STORY = 'Lighthouse';
const ALICE_PASSAGE = 'Harbour';
const BOB_PASSAGE = 'Untitled Passage';

async function shareStory(
	alice: Editor,
	bob: Editor,
	server: TestServer
): Promise<string> {
	await newStory(alice.page, STORY);
	await addPassage(alice.page, ALICE_PASSAGE, 'The lamp turns.');
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

	return (await server.storyNamed(STORY))!.id;
}

/**
 * Drive both editors into a genuine 412.
 *
 * Order matters and is the whole trick: Alice's write has to be on the server *before*
 * Bob's queue retries, or his stale `If-Match` would be accepted and there would be
 * nothing to resolve. So Alice writes while Bob is cut off, Bob writes and fails once,
 * and only then does his connection come back.
 */
async function makeConflict(
	alice: Editor,
	bob: Editor,
	server: TestServer,
	storyId: string
): Promise<void> {
	await goOffline(bob);

	await enterStory(alice.page, STORY);
	await openPassageEditor(alice.page, ALICE_PASSAGE);
	await typePassage(alice.page, 'Alice kept working.');
	await expect
		.poll(() => serverPassageText(server, storyId, ALICE_PASSAGE), {
			message: "alice's write never reached the server",
			timeout: 20000
		})
		.toBe('Alice kept working.');

	await enterStory(bob.page, STORY);
	await openPassageEditor(bob.page, BOB_PASSAGE);
	await typePassage(bob.page, 'Bob was offline.');

	// His first push has to have failed before the route is lifted, otherwise the
	// retry timer has nothing to retry.
	await expect
		.poll(
			async () =>
				!!(await syncSnapshot(bob.page))?.records?.[storyId]?.lastError,
			{message: "bob's push never failed while offline", timeout: 30000}
		)
		.toBe(true);

	await goOnline(bob);
}

test.describe('Conflict and resolve', () => {
	test('Conflict and resolve: keep mine', async ({alice, bob, server}) => {
		// The retry ladder is 5s → 15s → 60s and is not overridable from a test, so the
		// 412 can take a few of those before it arrives.
		test.setTimeout(240000);

		const storyId = await shareStory(alice, bob, server);

		await makeConflict(alice, bob, server, storyId);
		await backToLibrary(bob.page);
		await expectSyncState(bob.page, STORY, 'conflict', 90000);

		await selectStory(bob.page, STORY);
		await bob.page.getByTestId('story-resolve').click();

		const dialog = bob.page.getByTestId('conflict-keep-mine');

		await expect(dialog).toBeVisible({timeout: 20000});
		await bob.page.getByTestId('conflict-keep-mine').click();

		await expectSyncState(bob.page, STORY, 'idle', 30000);

		// Bob's version is the current one. Alice's is not lost — it is a snapshot.
		await expect
			.poll(() => serverPassageText(server, storyId, BOB_PASSAGE), {
				message: "keep mine did not push bob's text",
				timeout: 30000
			})
			.toBe('Bob was offline.');
		await expect
			.poll(() => serverPassageText(server, storyId, ALICE_PASSAGE), {
				timeout: 20000
			})
			.toBe('The lamp turns.');

		const revisions = await (
			await server.api(`/api/v1/stories/${storyId}/revisions`)
		).json();

		expect(revisions.revisions.length).toBeGreaterThan(1);

		// And Alice, who was clean, pulls his version.
		await expect(passageCard(alice.page, BOB_PASSAGE)).toContainText(
			'Bob was offline.',
			{timeout: 40000}
		);
	});

	test('Conflict and resolve: take theirs', async ({alice, bob, server}) => {
		test.setTimeout(240000);

		const storyId = await shareStory(alice, bob, server);

		await makeConflict(alice, bob, server, storyId);
		await backToLibrary(bob.page);
		await expectSyncState(bob.page, STORY, 'conflict', 90000);

		await selectStory(bob.page, STORY);
		await bob.page.getByTestId('story-resolve').click();
		await expect(bob.page.getByTestId('conflict-take-theirs')).toBeVisible({
			timeout: 20000
		});
		await bob.page.getByTestId('conflict-take-theirs').click();

		// His text is kept as a separate, local story before the server's replaces it.
		const copy = storyCard(bob.page, `${STORY} (my copy)`);

		await expect(copy).toBeVisible({timeout: 30000});
		await expect(copy.getByTestId('story-card-sync-badge')).toHaveCount(0);

		await enterStory(bob.page, `${STORY} (my copy)`);
		await expect(passageCard(bob.page, BOB_PASSAGE)).toContainText(
			'Bob was offline.'
		);
		await backToLibrary(bob.page);

		// The synced story is now the server's.
		await enterStory(bob.page, STORY);
		await expect(passageCard(bob.page, ALICE_PASSAGE)).toContainText(
			'Alice kept working.',
			{timeout: 30000}
		);

		// The copy is his alone: it never goes near the server.
		const names = (await server.stories()).map(story => story.name);

		expect(names).not.toContain(`${STORY} (my copy)`);
	});
});
