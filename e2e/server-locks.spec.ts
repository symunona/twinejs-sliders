/**
 * Presence and soft locks, stories 4–7 of spec 11.
 *
 * These are the advisory half of the feature: nothing here stops a write, it only makes
 * two people aware of each other. So every assertion is about what the *other* editor can
 * see, and the passage text is checked on the server afterwards to prove that "advisory"
 * really does mean the writes still land.
 */

import type {Page} from '@playwright/test';
import {
	addPassage,
	backToLibrary,
	editorIsReadOnly,
	editorText,
	enterStory,
	expect,
	expectSyncState,
	ghostCard,
	goToLibrary,
	newStory,
	openPassageEditor,
	passageCard,
	presenceNames,
	publishStory,
	refreshServer,
	serverPassageText,
	storyCard,
	test,
	typePassage,
	type Editor,
	type TestServer
} from './server-helpers';

const STORY = 'Lighthouse';
const PASSAGE = 'Harbour';

/**
 * Alice publishes a two-passage story and Bob checks it out, so both editors hold the
 * same document before anything interesting happens.
 */
async function shareStory(
	alice: Editor,
	bob: Editor,
	server: TestServer
): Promise<string> {
	await newStory(alice.page, STORY);
	await addPassage(alice.page, PASSAGE, 'The lamp turns.');
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

/** Close the passage editor dialog, which is what sends `blur`. */
async function closePassageEditor(page: Page): Promise<void> {
	await page.getByRole('button', {name: 'Close', exact: true}).last().click();
	await expect(page.locator('.CodeMirror')).toHaveCount(0, {timeout: 10000});
}

test.describe('Presence and soft locks', () => {
	test('Presence', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		// Bob stays on the library; Alice walks into the story map.
		await enterStory(alice.page, STORY);

		await expect
			.poll(() => presenceNames(bob.page, storyId, bob.clientId), {
				message: 'bob never saw alice in the story',
				timeout: 20000
			})
			.toEqual(['alice']);

		await expect(
			storyCard(bob.page, STORY).getByTestId('story-card-sync-presence')
		).toHaveText('A', {timeout: 20000});

		// And in the story itself, the toolbar names her.
		await enterStory(bob.page, STORY);
		await expect(bob.page.getByTestId('story-presence')).toHaveAttribute(
			'data-names',
			/alice/,
			{timeout: 20000}
		);

		// She leaves; it clears inside the heartbeat window rather than at some point.
		await backToLibrary(alice.page);

		await expect
			.poll(() => presenceNames(bob.page, storyId, bob.clientId), {
				message: "alice's presence never cleared",
				timeout: 30000
			})
			.toEqual([]);
		await expect(bob.page.getByTestId('story-presence')).toHaveAttribute(
			'data-names',
			'',
			{timeout: 30000}
		);
	});

	test('Soft lock', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);

		await enterStory(bob.page, STORY);

		// The map marks it before Bob even opens it.
		await expect(
			passageCard(bob.page, PASSAGE).getByTestId('passage-card-lock')
		).toHaveAttribute('data-locked-by', 'alice', {timeout: 20000});

		await openPassageEditor(bob.page, PASSAGE);

		const banner = bob.page.getByTestId('passage-lock-banner');

		await expect(banner).toBeVisible({timeout: 20000});
		await expect(banner).toHaveAttribute('data-locked-by', 'alice');
		expect(await editorIsReadOnly(bob.page)).toBe(true);

		// Read-only has to mean it: a banner over a live editor is worse than nothing.
		const before = await editorText(bob.page);

		await bob.page.locator('.CodeMirror textarea').first().click({force: true});
		await bob.page.keyboard.insertText('bob should not be able to type this');
		expect(await editorText(bob.page)).toBe(before);

		// Alice puts it down.
		await closePassageEditor(alice.page);

		await expect(banner).toBeHidden({timeout: 30000});
		await expect
			.poll(async () => editorIsReadOnly(bob.page), {timeout: 30000})
			.toBe(false);

		await typePassage(bob.page, 'Bob has the lamp now.');
		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {
				message: "bob's write never landed after the lock cleared",
				timeout: 20000
			})
			.toBe('Bob has the lamp now.');
	});

	test('Lock expiry', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);

		await enterStory(bob.page, STORY);
		await openPassageEditor(bob.page, PASSAGE);
		await expect(bob.page.getByTestId('passage-lock-banner')).toHaveAttribute(
			'data-locked-by',
			'alice',
			{timeout: 20000}
		);

		// The whole browser goes, so no `blur` and no `beforeunload` are delivered — the
		// server only learns about it because the socket dies with the process.
		//
		// NOTE: the *idle* expiry path (a laptop that closes its lid without closing the
		// socket) is not covered here. `hub.Options.PresenceTTL` is injectable and
		// `hub_test.go` drives it at 200ms, but `server/config.go` has no PRESENCE_TTL, so
		// from outside the binary the only value available is the hard-coded 60s — a
		// minute of wall clock per run for a rule the Go tests already assert. Wire
		// PRESENCE_TTL into Config and this test can cover both.
		await alice.close();

		await expect
			.poll(() => presenceNames(bob.page, storyId, bob.clientId), {
				message: "alice's presence outlived her browser",
				timeout: 30000
			})
			.toEqual([]);

		await expect(bob.page.getByTestId('passage-lock-banner')).toBeHidden({
			timeout: 30000
		});
		await expect
			.poll(async () => editorIsReadOnly(bob.page), {timeout: 30000})
			.toBe(false);
	});

	test('Take over', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);

		await enterStory(bob.page, STORY);
		await openPassageEditor(bob.page, PASSAGE);
		await expect(bob.page.getByTestId('passage-lock-banner')).toHaveAttribute(
			'data-locked-by',
			'alice',
			{timeout: 20000}
		);

		await bob.page.getByTestId('passage-lock-takeover').click();

		// Take over kicks nobody. Both editors are writable and both are told.
		await expect(bob.page.getByTestId('passage-shared-banner')).toBeVisible({
			timeout: 20000
		});
		await expect(bob.page.getByTestId('passage-shared-banner')).toHaveAttribute(
			'data-shared-with',
			/alice/
		);
		await expect(alice.page.getByTestId('passage-shared-banner')).toBeVisible({
			timeout: 20000
		});
		await expect(
			alice.page.getByTestId('passage-shared-banner')
		).toHaveAttribute('data-shared-with', /bob/);

		expect(await editorIsReadOnly(bob.page)).toBe(false);
		expect(await editorIsReadOnly(alice.page)).toBe(false);

		// Both saves land, and the last one wins. Written down as an assertion rather
		// than left to be discovered: the unit of merge is a whole passage, saved by
		// whoever saved last.
		await typePassage(bob.page, 'Bob wrote this first.');
		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {
				message: "bob's write never landed",
				timeout: 20000
			})
			.toBe('Bob wrote this first.');

		await expect
			.poll(() => editorText(alice.page), {
				message: "alice never received bob's text",
				timeout: 25000
			})
			.toBe('Bob wrote this first.');

		await typePassage(alice.page, 'Alice wrote this last.');
		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {
				message: "alice's write never landed",
				timeout: 20000
			})
			.toBe('Alice wrote this last.');

		// Last write wins, and it stays won.
		await expect
			.poll(() => editorText(bob.page), {
				message: "bob's editor never converged on the last write",
				timeout: 25000
			})
			.toBe('Alice wrote this last.');
	});
});
