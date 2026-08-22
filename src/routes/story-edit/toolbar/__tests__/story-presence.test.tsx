import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {
	testPresenceClient,
	testSyncContext
} from '../../../../store/persistence/server/test-fixtures';
import {ServerSyncContext} from '../../../../store/persistence/server/use-server-sync';
import type {PresenceClient} from '../../../../store/persistence/server/server.types';
import {FakeStateProvider} from '../../../../test-util';
import {StoryPresence} from '../story-presence';

function renderPresence(clients: PresenceClient[]) {
	return render(
		<FakeStateProvider>
			<ServerSyncContext.Provider
				value={testSyncContext({clientsIn: () => clients})}
			>
				<StoryPresence storyId="story-1" />
			</ServerSyncContext.Provider>
		</FakeStateProvider>
	);
}

describe('<StoryPresence>', () => {
	it('is present but empty when nobody else is here', () => {
		renderPresence([]);

		const badge = screen.getByTestId('story-presence');

		expect(badge).toHaveAttribute('data-names', '');
		expect(badge).toBeEmptyDOMElement();
	});

	it('lists names alphabetically and draws one initial each', () => {
		renderPresence([
			testPresenceClient({id: '1', name: 'bob', story: 'story-1'}),
			testPresenceClient({id: '2', name: 'alice', story: 'story-1'})
		]);

		expect(screen.getByTestId('story-presence')).toHaveAttribute(
			'data-names',
			'alice,bob'
		);
		expect(screen.getByTestId('story-presence')).toHaveTextContent('BA');
	});
});
