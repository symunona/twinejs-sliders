/**
 * Stories 9–11 of spec 11: version history, delete and republish, and the rule that a
 * copy stays local.
 *
 * The common thread is "no sync path destroys anything". Restoring keeps what it
 * replaced, removing from the server keeps every other editor's text, and duplicating a
 * synced story produces something the server never hears about.
 */

import type {Editor} from './server-helpers';
import {
	addPassage,
	appendPassage,
	backToLibrary,
	enterStory,
	expect,
	expectSyncState,
	ghostCard,
	goToLibrary,
	newStory,
	openPassageEditor,
	passageCard,
	publishStory,
	refreshServer,
	selectStory,
	serverPassageText,
	storyCard,
	test,
	typePassage,
	type TestServer
} from './server-helpers';

const STORY = 'Lighthouse';
const PASSAGE = 'Harbour';

async function shareStory(
	alice: Editor,
	bob: Editor,
	server: TestServer
): Promise<string> {
	await newStory(alice.page, STORY);
	await addPassage(alice.page, PASSAGE, 'Version one.');
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

test.describe('Library: history, delete, copies', () => {
	/**
	 * Alice publishes and then saves two more versions, and stops with the History
	 * dialog open. Bob is deliberately not involved yet: while a second editor holds a
	 * synced copy every pull it takes is written straight back to the server (see the
	 * duplicate-write defect noted on the test below), so his presence would change the
	 * number of rows the dialog shows.
	 */
	async function threeVersions(
		alice: Editor,
		server: TestServer
	): Promise<{rows: ReturnType<Editor['page']['getByTestId']>; storyId: string}> {
		await newStory(alice.page, STORY);
		await addPassage(alice.page, PASSAGE, 'Version one.');
		await goToLibrary(alice.page);
		await publishStory(alice.page, STORY);
		await expectSyncState(alice.page, STORY, 'idle');

		const storyId = (await server.storyNamed(STORY))!.id;

		// Each edit is waited for so one push cannot swallow the next, and appending
		// rather than retyping keeps an edit a single document change and so a single
		// revision.
		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);

		let expected = 'Version one.';

		for (const text of [' Two.', ' Three.']) {
			await appendPassage(alice.page, text);
			expected += text;
			await expect
				.poll(() => serverPassageText(server, storyId, PASSAGE), {
					message: `"${text}" never reached the server`,
					timeout: 20000
				})
				.toBe(expected);
		}

		await alice.page
			.getByRole('button', {name: 'Close', exact: true})
			.last()
			.click();
		await alice.page.getByRole('tab', {name: 'Story'}).click();
		await alice.page.getByRole('button', {name: 'History…'}).click();

		return {rows: alice.page.getByTestId('story-history-row'), storyId};
	}

	/**
	 * Story 9. Three saves, three rows: the current version leads the list and its two
	 * snapshots follow. This used to show six rows with two editors watching — every
	 * write was echoed by a duplicate PUT whose body differed only in `lastUpdate`, so
	 * history credited versions to whoever merely received them. Fixed by claiming the
	 * hash before the publish PUT and re-checking it when the queue fires.
	 */
	test('Version history', async ({alice, bob, server}) => {
		const {rows, storyId} = await threeVersions(alice, server);

		await expect(rows).toHaveCount(3, {timeout: 20000});
		await expect(rows.first()).toContainText('by alice');

		const oldest = rows.last();

		await oldest.getByTestId('story-history-restore').click();
		await oldest.getByTestId('story-history-confirm').click();

		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {timeout: 30000})
			.toBe('Version one.');
	});

	/**
	 * The rest of story 9, which the defect above does not touch: the list is newest
	 * first, restoring an old row makes it current for everyone, and it is not
	 * destructive. Kept as its own test so the restore path stays covered while the row
	 * count is broken.
	 */
	test('Version history: restore round trip', async ({alice, bob, server}) => {
		const {rows, storyId} = await threeVersions(alice, server);

		await expect(rows.first()).toContainText('by alice');
		await expect(rows.first()).toContainText('now');

		// Newest first, so the oldest — what she published — is last.
		const revs = await rows.evaluateAll(items =>
			items.map(item => Number(item.getAttribute('data-rev')))
		);

		expect(revs.length).toBeGreaterThanOrEqual(3);
		expect([...revs].sort((a, b) => b - a)).toEqual(revs);

		// Bob takes his copy at the newest version, so what he sees next can only have
		// come from the restore.
		await refreshServer(bob.page);
		await expect(ghostCard(bob.page, STORY)).toBeVisible({timeout: 20000});
		await bob.page.getByTestId('ghost-checkout').click();
		await expect(bob.page.getByTestId('story-group-synced')).toContainText(
			STORY,
			{timeout: 60000}
		);
		await enterStory(bob.page, STORY);
		await expect(passageCard(bob.page, PASSAGE)).toContainText(
			'Version one. Two. Three.'
		);

		const oldest = rows.last();

		await oldest.getByTestId('story-history-restore').click();
		await oldest.getByTestId('story-history-confirm').click();

		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {
				message: 'the restore never became the current version',
				timeout: 30000
			})
			.toBe('Version one.');

		// Alice's own editor shows what she restored...
		await expect(passageCard(alice.page, PASSAGE)).toContainText(
			'Version one.',
			{timeout: 30000}
		);

		// ...and so does Bob's, because a restore is an ordinary write on the bus.
		await expect(passageCard(bob.page, PASSAGE)).toContainText('Version one.', {
			timeout: 30000
		});

		// Restoring never destroys: the version it replaced is a snapshot of its own.
		const after = await (
			await server.api(`/api/v1/stories/${storyId}/revisions`)
		).json();

		expect(after.revisions.length).toBeGreaterThan(revs.length);
	});

	test('Delete and republish', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		// Bob's text, so we can prove it survives the round trip untouched.
		await enterStory(bob.page, STORY);
		await openPassageEditor(bob.page, PASSAGE);
		await typePassage(bob.page, 'Bob wrote this before the delete.');
		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {timeout: 20000})
			.toBe('Bob wrote this before the delete.');
		await backToLibrary(bob.page);

		// The delete confirmation offers to remove the server copy too, and it is off by
		// default: a local delete never follows you onto the server unless you say so.
		await selectStory(alice.page, STORY);
		await alice.page.getByRole('button', {name: 'Delete'}).first().click();

		const alsoRemove = alice.page.getByTestId('delete-also-remove-server');

		await expect(alsoRemove).toBeVisible({timeout: 10000});
		await expect(alsoRemove).toHaveAttribute('aria-checked', 'false');
		await alice.page.getByRole('button', {name: 'Cancel'}).first().click();
		await expect(alsoRemove).toBeHidden({timeout: 10000});

		await alice.page.getByTestId('story-remove-from-server').click();
		await alice.page
			.getByRole('button', {name: 'Remove from Server'})
			.nth(1)
			.click();

		await expect
			.poll(async () => (await server.storyNamed(STORY))?.deleted ?? false, {
				message: 'the story was never tombstoned',
				timeout: 20000
			})
			.toBe(true);

		// Bob is told, keeps his text, and stops pushing.
		await expectSyncState(bob.page, STORY, 'gone', 40000);
		await enterStory(bob.page, STORY);
		await expect(passageCard(bob.page, PASSAGE)).toContainText(
			'Bob wrote this before the delete.'
		);
		await backToLibrary(bob.page);

		// Alice's local copy is untouched by the server delete, so she deletes it too.
		// No checkbox this time: with the sync record gone the story is an ordinary
		// local one again.
		await selectStory(alice.page, STORY);
		await alice.page.getByRole('button', {name: 'Delete'}).first().click();
		await expect(
			alice.page.getByTestId('delete-also-remove-server')
		).toHaveCount(0);
		await alice.page.getByRole('button', {name: 'Delete'}).nth(1).click();
		await expect(storyCard(alice.page, STORY)).toHaveCount(0, {timeout: 20000});

		// Bob puts it back on the same rev chain.
		await selectStory(bob.page, STORY);
		await bob.page.getByTestId('story-republish').click();

		await expect
			.poll(async () => (await server.storyNamed(STORY))?.deleted ?? true, {
				message: 'republish did not revive the story',
				timeout: 30000
			})
			.toBe(false);
		await expectSyncState(bob.page, STORY, 'idle', 30000);

		// And Alice sees it come back — as a ghost, since she has no local copy now.
		await refreshServer(alice.page);
		await expect(ghostCard(alice.page, STORY)).toBeVisible({timeout: 30000});

		// The history from before the delete survived the whole round trip.
		const revisions = await (
			await server.api(`/api/v1/stories/${storyId}/revisions`)
		).json();

		expect(revisions.revisions.length).toBeGreaterThan(1);
	});

	test('Copy stays local', async ({alice, bob, server}) => {
		await shareStory(alice, bob, server);

		await selectStory(bob.page, STORY);
		await bob.page.getByRole('button', {name: 'Duplicate'}).click();

		const copy = storyCard(bob.page, `${STORY} 1`);

		await expect(copy).toBeVisible({timeout: 20000});

		// No badge at all: `duplicateStory` sets `sync: false` and drops the record.
		await expect(copy.getByTestId('story-card-sync-badge')).toHaveCount(0);
		await expect(bob.page.getByTestId('story-group-local')).toContainText(
			`${STORY} 1`
		);

		// Give the push queue every chance to be wrong, then ask the server directly.
		await refreshServer(bob.page);
		await expect
			.poll(async () => (await server.stories()).map(story => story.name), {
				message: 'a duplicated story reached the server',
				timeout: 15000
			})
			.toEqual([STORY]);
	});
});
