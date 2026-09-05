import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {FakeStateProvider} from '../../test-util';
import {fakeStory} from '../../test-util/fakes';
import {ServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {emptyPresence} from '../../store/persistence/server/presence';
import type {SyncRecords} from '../../store/persistence/server/sync-record';
import {Story} from '../../store/stories';
import {SyncStatusBadge} from '../sync-status-badge';

function renderComponent(stories: Story[], records: SyncRecords) {
	return render(
		<FakeStateProvider stories={stories}>
			<ServerSyncContext.Provider
				value={{
					actions: {} as never,
					blurPassage: () => undefined,
					clientsIn: () => [],
					connected: true,
					focusPassage: () => undefined,
					ghosts: [],
					index: [],
					lock: () => undefined,
					presence: emptyPresence(),
					progress: {},
					records,
					socketConnected: true,
					stealPassage: () => undefined
				}}
			>
				<SyncStatusBadge />
			</ServerSyncContext.Provider>
		</FakeStateProvider>
	);
}

describe('<SyncStatusBadge>', () => {
	it('renders nothing when no story is marked for sync', () => {
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
			document.querySelector('.sync-status-badge-tick')
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

		expect(document.querySelector('.sync-status-badge-tick')).toBeInTheDocument();
	});
});
