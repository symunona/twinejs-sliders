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
	test('Version history', async ({alice, bob, server}) => {
		const storyId = await shareStory(alice, bob, server);

		// Three distinct versions: the publish, then two edits, each waited for so one
		// push cannot swallow the next. Appending rather than retyping keeps each edit a
		// single document change and therefore a single revision.
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

		const rows = alice.page.getByTestId('story-history-row');
		{
			const revs = await (await server.api(`/api/v1/stories/${storyId}/revisions`)).json();
			const list = revs.revisions.map((r: any) => r.rev).sort((a: number, b: number) => a - b);
			const bodies: Record<number, any> = {};
			for (const rev of list) {
				bodies[rev] = await (await server.api(`/api/v1/stories/${storyId}/revisions/${rev}`)).json();
			}
			for (let i = 1; i < list.length; i++) {
				const a = bodies[list[i - 1]];
				const b = bodies[list[i]];
				const sa = JSON.stringify(a.story ?? a);
				const sb = JSON.stringify(b.story ?? b);
				console.log('DIFF', list[i - 1], '->', list[i], sa === sb ? 'IDENTICAL' : 'different');
				if (sa !== sb) {
					const oa = (a.story ?? a) as any;
					const ob = (b.story ?? b) as any;
					for (const key of new Set([...Object.keys(oa), ...Object.keys(ob)])) {
						if (JSON.stringify(oa[key]) !== JSON.stringify(ob[key])) {
							console.log('  key', key, JSON.stringify(oa[key])?.slice(0, 300), '=>', JSON.stringify(ob[key])?.slice(0, 300));
						}
					}
				}
			}
		}

		await expect(rows).toHaveCount(3, {timeout: 20000});
		await expect(rows.first()).toContainText('by alice');

		// Newest first, so the oldest — the version Bob checked out — is last.
		const oldest = rows.last();
		const oldestRev = await oldest.getAttribute('data-rev');

		expect(Number(oldestRev)).toBeGreaterThan(0);
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
		await enterStory(bob.page, STORY);
		await expect(passageCard(bob.page, PASSAGE)).toContainText('Version one.', {
			timeout: 30000
		});
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
		await expect(alsoRemove).toHaveAttribute('aria-pressed', 'false');
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
