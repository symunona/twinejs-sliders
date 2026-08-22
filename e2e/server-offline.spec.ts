/**
 * Story 12 of spec 11: the server goes away mid-edit and comes back.
 *
 * Its own spec file because it kills the process the worker fixture owns, and a test that
 * does that has no business sharing a server with anything else.
 *
 * The claim being tested is the one that matters most when this feature misbehaves in
 * real life: **the local save path never depends on the network.** Alice keeps typing,
 * `localStorage` keeps taking it, and the only thing that changes is a badge.
 */

import {
	addPassage,
	backToLibrary,
	editorText,
	enterStory,
	expect,
	expectSyncState,
	goToLibrary,
	localPassageText,
	newStory,
	openPassageEditor,
	publishStory,
	serverPassageText,
	syncSnapshot,
	test,
	typePassage
} from './server-helpers';

const STORY = 'Lighthouse';
const PASSAGE = 'Harbour';

test.describe('Offline and back', () => {
	test('Offline and back', async ({alice, server}) => {
		// The push queue's ladder is 5s → 15s → 60s before it gives up, and this test
		// waits out the whole thing rather than pretending the timings are different.
		test.setTimeout(300000);

		await newStory(alice.page, STORY);
		await addPassage(alice.page, PASSAGE, 'Version one.');
		await goToLibrary(alice.page);
		await publishStory(alice.page, STORY);
		await expectSyncState(alice.page, STORY, 'idle');

		const storyId = (await server.storyNamed(STORY))!.id;

		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);

		// Pull the plug. SIGKILL, not SIGTERM: a crash is the case that hurts.
		await server.stop({force: true});

		await typePassage(alice.page, 'Written while the server was dead.');

		// Local saves keep working. Asked of storage, not of the screen.
		await expect
			.poll(() => localPassageText(alice.page, PASSAGE), {
				message: 'the local save path broke when the network did',
				timeout: 20000
			})
			.toBe('Written while the server was dead.');

		// Three failed pushes and the badge says so.
		await expect
			.poll(async () => (await syncSnapshot(alice.page))?.records?.[storyId]?.state, {
				message: 'the sync record never reached error',
				timeout: 120000
			})
			.toBe('error');

		await backToLibrary(alice.page);
		await expectSyncState(alice.page, STORY, 'error', 20000);

		// Same port, same data directory: as far as the browser is concerned the server
		// was only ever unreachable.
		await server.start();

		await expect
			.poll(() => serverPassageText(server, storyId, PASSAGE), {
				message: 'the parked push never flushed after the server came back',
				timeout: 90000
			})
			.toBe('Written while the server was dead.');

		await expectSyncState(alice.page, STORY, 'idle', 30000);

		// Nothing was lost on the way through.
		await enterStory(alice.page, STORY);
		await openPassageEditor(alice.page, PASSAGE);
		expect(await editorText(alice.page)).toBe(
			'Written while the server was dead.'
		);
	});
});
