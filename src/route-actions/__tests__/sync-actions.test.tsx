import {render, screen} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {FakeStateProvider} from '../../test-util';
import {fakeStory} from '../../test-util/fakes';
import {ServerSyncContext} from '../../store/persistence/server/use-server-sync';
import {emptyPresence} from '../../store/persistence/server/presence';
import {Story} from '../../store/stories';
import {SyncActions} from '../sync-actions';

describe('<SyncActions>', () => {
	function renderComponent(story?: Story) {
		return render(
			<FakeStateProvider stories={story ? [story] : []}>
				<ServerSyncContext.Provider
					value={{
						actions: {} as never,
						blurPassage: () => undefined,
						client: {} as never,
						clientsIn: () => [],
						connected: true,
						focusPassage: () => undefined,
						ghosts: [],
						index: [],
						lock: () => undefined,
						presence: emptyPresence(),
						progress: {},
						records: {},
						socketConnected: true,
						stealPassage: () => undefined
					}}
				>
					<SyncActions story={story} />
				</ServerSyncContext.Provider>
			</FakeStateProvider>
		);
	}

	it('offers to publish a story that is not synced', () => {
		renderComponent(fakeStory());
		expect(
			screen.getByRole('button', {name: 'routeActions.app.syncPublish'})
		).toBeInTheDocument();
	});

	it('offers to unpublish a synced story', () => {
		const story = fakeStory();

		story.sync = true;
		renderComponent(story);
		expect(
			screen.getByRole('button', {name: 'routeActions.app.syncUnpublish'})
		).toBeInTheDocument();
	});

	it('shows only settings when no story is selected', () => {
		renderComponent();
		expect(
			screen.getByRole('button', {name: 'routeActions.app.syncSettings'})
		).toBeInTheDocument();
		expect(
			screen.queryByRole('button', {name: 'routeActions.app.syncPublish'})
		).not.toBeInTheDocument();
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});
