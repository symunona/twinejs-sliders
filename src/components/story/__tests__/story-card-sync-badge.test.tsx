import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import type {SyncRecord} from '../../../store/persistence/server/server.types';
import {
	StoryCardSyncBadge,
	StoryCardSyncBadgeProps
} from '../story-card-sync-badge';

function fakeRecord(props?: Partial<SyncRecord>): SyncRecord {
	return {
		pushedHash: 'mock-hash',
		rev: 3,
		state: 'idle',
		storyId: 'mock-story-id',
		...props
	};
}

describe('<StoryCardSyncBadge>', () => {
	function renderComponent(props?: Partial<StoryCardSyncBadgeProps>) {
		return render(<StoryCardSyncBadge {...props} />);
	}

	it('renders nothing when the story has no record and no sync flag', () => {
		renderComponent();
		expect(
			screen.queryByTestId('story-card-sync-badge')
		).not.toBeInTheDocument();
	});

	it('renders a pending badge when the story syncs but has no record yet', () => {
		renderComponent({sync: true});

		const badge = screen.getByTestId('story-card-sync-badge');

		expect(badge.dataset.syncState).toBe('idle');
		expect(
			screen.getByText('components.storyCard.sync.pending')
		).toBeInTheDocument();
	});

	it('renders the time of the last sync when idle', () => {
		renderComponent({
			record: fakeRecord({lastPushedAt: Date.parse('2026-08-21T10:12:00Z')})
		});
		expect(screen.getByTestId('story-card-sync-badge').dataset.syncState).toBe(
			'idle'
		);
		expect(
			screen.getByText('components.storyCard.sync.synced')
		).toBeInTheDocument();
	});

	it.each([
		['pushing', 'components.storyCard.sync.pushing'],
		['pulling', 'components.storyCard.sync.pulling'],
		['conflict', 'components.storyCard.sync.conflict'],
		['gone', 'components.storyCard.sync.gone'],
		['dirty', 'components.storyCard.sync.dirty']
	])('renders the %s state', (state, label) => {
		renderComponent({
			record: fakeRecord({state: state as SyncRecord['state']})
		});
		expect(screen.getByTestId('story-card-sync-badge').dataset.syncState).toBe(
			state
		);
		expect(screen.getByText(label)).toBeInTheDocument();
	});

	it('puts the last error in the title of an errored badge', () => {
		renderComponent({
			record: fakeRecord({lastError: 'mock-error', state: 'error'})
		});

		const badge = screen.getByTestId('story-card-sync-badge');

		expect(badge.dataset.syncState).toBe('error');
		expect(badge.title).toBe('mock-error');
	});

	it('reserves space for presence even when nobody else is there', () => {
		renderComponent({record: fakeRecord()});
		expect(
			screen.getByTestId('story-card-sync-presence')
		).toBeEmptyDOMElement();
	});

	it("renders other editors' initials", () => {
		renderComponent({
			presence: [
				{id: 'mock-id-1', name: 'mira'},
				{id: 'mock-id-2', name: 'bob'}
			],
			record: fakeRecord()
		});

		const presence = screen.getByTestId('story-card-sync-presence');

		expect(presence.textContent).toBe('MB');
	});

	it('is accessible', async () => {
		const {container} = renderComponent({record: fakeRecord()});

		expect(await axe(container)).toHaveNoViolations();
	});
});
