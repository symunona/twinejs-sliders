import {fireEvent, render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider} from '../../test-util';
import {fakeStory} from '../../test-util/fakes';
import {
	ServerSyncContext,
	type SyncProgress
} from '../../store/persistence/server/use-server-sync';
import {emptyPresence} from '../../store/persistence/server/presence';
import type {SyncRecord} from '../../store/persistence/server/server.types';
import type {SyncRecords} from '../../store/persistence/server/sync-record';
import {Story} from '../../store/stories';
import {SyncStatus} from '../sync-status';

// The dialog itself talks to the server; the status control's whole job is opening it.

jest.mock('../../dialogs/server-conflict/server-conflict', () => {
	const react = jest.requireActual('react');

	return {
		ServerConflictDialog: (props: {storyId: string}) =>
			react.createElement('div', {
				'data-testid': `mock-server-conflict-dialog-${props.storyId}`
			})
	};
});

describe('<SyncStatus>', () => {
	function renderComponent(
		stories: Story[],
		records: SyncRecords,
		connected = true,
		story?: Story,
		progress: Record<string, SyncProgress | undefined> = {}
	) {
		return render(
			<FakeStateProvider stories={stories}>
				<ServerSyncContext.Provider
					value={{
						actions: {} as never,
						blurPassage: () => undefined,
						client: {} as never,
						clientsIn: () => [],
						connected,
						focusPassage: () => undefined,
						ghosts: [],
						index: [],
						lock: () => undefined,
						presence: emptyPresence(),
						progress,
						records,
						socketConnected: connected,
						stealPassage: () => undefined
					}}
				>
					<SyncStatus story={story} />
				</ServerSyncContext.Provider>
			</FakeStateProvider>
		);
	}

	it('shows no timestamp badge when no story is marked for sync', () => {
		renderComponent([fakeStory()], {});
		expect(screen.queryByTestId('sync-status-badge')).not.toBeInTheDocument();
	});

	it('shows a pending label when a synced story has no record yet', () => {
		const story = fakeStory();

		story.sync = true;
		renderComponent([story], {});
		expect(
			screen.getByText('routeActions.app.syncStatusPending')
		).toBeInTheDocument();
	});

	it('shows the last sync time with no checkmark when a story is dirty', () => {
		const story = fakeStory();

		story.sync = true;
		renderComponent([story], {
			[story.id]: {
				lastPushedAt: Date.parse('2026-08-21T10:12:00Z'),
				pushedHash: 'mock-hash',
				rev: 1,
				state: 'dirty',
				storyId: story.id
			}
		});

		expect(
			screen.getByText('routeActions.app.syncStatus')
		).toBeInTheDocument();
		expect(
			document.querySelector('.sync-actions-status-tick')
		).not.toBeInTheDocument();
	});

	it('shows a checkmark when every synced story is idle', () => {
		const story = fakeStory();

		story.sync = true;
		renderComponent([story], {
			[story.id]: {
				lastPushedAt: Date.parse('2026-08-21T10:12:00Z'),
				pushedHash: 'mock-hash',
				rev: 1,
				state: 'idle',
				storyId: story.id
			}
		});

		expect(
			document.querySelector('.sync-actions-status-tick')
		).toBeInTheDocument();
	});

	describe('when given a story', () => {
		function syncedStory() {
			const story = fakeStory();

			story.sync = true;
			return story;
		}

		function recordFor(
			story: Story,
			changes: Partial<SyncRecord>
		): SyncRecords {
			return {
				[story.id]: {
					lastPushedAt: Date.parse('2026-08-21T10:12:00Z'),
					pushedHash: 'mock-hash',
					rev: 1,
					state: 'idle',
					storyId: story.id,
					...changes
				}
			};
		}

		it('says the story is in conflict instead of when it last synced', () => {
			const story = syncedStory();

			renderComponent(
				[story],
				recordFor(story, {conflictRev: 2, state: 'conflict'}),
				true,
				story
			);
			expect(screen.getByTestId('sync-status-trouble')).toBeInTheDocument();
			expect(
				screen.getByText('routeActions.app.syncConflict')
			).toBeInTheDocument();
			expect(
				screen.queryByText('routeActions.app.syncStatus')
			).not.toBeInTheDocument();
			expect(screen.queryByTestId('sync-status-badge')).not.toBeInTheDocument();
		});

		it('opens the conflict dialog when a conflict is clicked', async () => {
			const story = syncedStory();

			renderComponent(
				[story],
				recordFor(story, {conflictRev: 2, state: 'conflict'}),
				true,
				story
			);
			fireEvent.click(screen.getByText('routeActions.app.syncConflict'));
			expect(
				await screen.findByTestId(`mock-server-conflict-dialog-${story.id}`)
			).toBeInTheDocument();
		});

		it('offers the same dialog when pushes are failing', () => {
			const story = syncedStory();

			renderComponent(
				[story],
				recordFor(story, {lastError: 'kaboom', state: 'error'}),
				true,
				story
			);
			expect(
				screen.getByText('routeActions.app.syncFailed')
			).toBeInTheDocument();
			expect(
				screen.getByText('routeActions.app.syncFailed').closest('button')
			).toBeEnabled();
		});

		it('reports a story removed from the server, with nothing to click', () => {
			const story = syncedStory();

			renderComponent([story], recordFor(story, {state: 'gone'}), true, story);
			expect(screen.getByText('routeActions.app.syncGone')).toBeInTheDocument();
			expect(
				screen.getByText('routeActions.app.syncGone').closest('button')
			).toBeDisabled();
		});

		it("shows that story's own sync time when it is idle", () => {
			const story = syncedStory();
			const other = syncedStory();

			renderComponent(
				[story, other],
				{
					...recordFor(story, {}),
					...recordFor(other, {state: 'conflict'})
				},
				true,
				story
			);
			expect(screen.getByTestId('sync-status-badge')).toBeInTheDocument();
			expect(
				document.querySelector('.sync-actions-status-tick')
			).toBeInTheDocument();
			expect(
				screen.queryByTestId('sync-status-trouble')
			).not.toBeInTheDocument();
		});

		it('shows no timestamp badge for a story that is not synced', () => {
			const story = fakeStory();

			renderComponent([story], {}, true, story);
			expect(screen.queryByTestId('sync-status-badge')).not.toBeInTheDocument();
		});
	});

	describe('while artwork is downloading', () => {
		function syncedStory() {
			const story = fakeStory();

			story.sync = true;
			return story;
		}

		function idleRecord(story: Story): SyncRecords {
			return {
				[story.id]: {
					lastPushedAt: Date.parse('2026-08-21T10:12:00Z'),
					pushedHash: 'mock-hash',
					rev: 1,
					state: 'idle',
					storyId: story.id
				}
			};
		}

		it('replaces the last-sync badge with a count of a top-up pull', () => {
			const story = syncedStory();

			renderComponent([story], idleRecord(story), true, undefined, {
				[story.id]: {done: 3, phase: 'download', total: 9}
			});
			expect(
				screen.getByTestId('sync-status-downloading')
			).toBeInTheDocument();
			expect(
				screen.getByText('routeActions.app.syncDownloadingCount')
			).toBeInTheDocument();
			expect(screen.queryByTestId('sync-status-badge')).not.toBeInTheDocument();
		});

		it('counts a checkout too', () => {
			const story = syncedStory();

			renderComponent([story], {}, true, undefined, {
				[story.id]: {done: 1, phase: 'assets', total: 4}
			});
			expect(
				screen.getByTestId('sync-status-downloading')
			).toBeInTheDocument();
		});

		it('says nothing while a checkout is still fetching story text', () => {
			const story = syncedStory();

			renderComponent([story], idleRecord(story), true, undefined, {
				[story.id]: {done: 0, phase: 'story', total: 1}
			});
			expect(
				screen.queryByTestId('sync-status-downloading')
			).not.toBeInTheDocument();
			expect(screen.getByTestId('sync-status-badge')).toBeInTheDocument();
		});

		it('ignores a push, which sends art rather than receiving it', () => {
			const story = syncedStory();

			renderComponent([story], idleRecord(story), true, undefined, {
				[story.id]: {done: 2, phase: 'upload', total: 5}
			});
			expect(
				screen.queryByTestId('sync-status-downloading')
			).not.toBeInTheDocument();
			expect(screen.getByTestId('sync-status-badge')).toBeInTheDocument();
		});

		it('adds up every story in the map, not just the one it was given', () => {
			const story = syncedStory();
			const other = syncedStory();

			renderComponent([story, other], idleRecord(story), true, story, {
				[story.id]: {done: 1, phase: 'download', total: 2},
				[other.id]: {done: 2, phase: 'assets', total: 7}
			});
			expect(
				screen.getByTestId('sync-status-downloading')
			).toBeInTheDocument();
		});

		it('says a download is happening before it knows how big it is', () => {
			const story = syncedStory();

			renderComponent([story], idleRecord(story), true, undefined, {
				[story.id]: {done: 0, phase: 'download', total: 0}
			});
			expect(
				screen.getByText('routeActions.app.syncDownloading')
			).toBeInTheDocument();
		});

		it('still reports trouble first--a stuck story outranks a busy one', () => {
			const story = syncedStory();

			renderComponent(
				[story],
				{
					[story.id]: {
						conflictRev: 2,
						pushedHash: 'mock-hash',
						rev: 1,
						state: 'conflict',
						storyId: story.id
					}
				},
				true,
				story,
				{[story.id]: {done: 1, phase: 'download', total: 2}}
			);
			expect(screen.getByTestId('sync-status-trouble')).toBeInTheDocument();
			expect(
				screen.queryByTestId('sync-status-downloading')
			).not.toBeInTheDocument();
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent([], {});

		expect(await axe(container)).toHaveNoViolations();
	});

	it('is accessible while downloading', async () => {
		const story = fakeStory();

		story.sync = true;

		const {container} = renderComponent([story], {}, true, undefined, {
			[story.id]: {done: 3, phase: 'download', total: 9}
		});

		expect(await axe(container)).toHaveNoViolations();
	});
});
