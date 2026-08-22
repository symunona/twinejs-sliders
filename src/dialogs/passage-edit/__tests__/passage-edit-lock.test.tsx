import {render, screen} from '@testing-library/react';
import * as React from 'react';
import {ServerSyncContext} from '../../../store/persistence/server/use-server-sync';
import type {PassageLock} from '../../../store/persistence/server/presence';
import {
	testPresenceClient,
	testSyncContext
} from '../../../store/persistence/server/test-fixtures';
import {useStoriesContext} from '../../../store/stories';
import {
	FakeStateProvider,
	fakeStory,
	fakeUnloadedStoryFormat
} from '../../../test-util';
import {PassageEditContents} from '../passage-edit-contents';

jest.mock('../passage-toolbar');
jest.mock('../passage-text');
jest.mock('../story-format-toolbar');

const jules = testPresenceClient({id: 'them', name: 'jules'});

interface Handlers {
	blurPassage: jest.Mock;
	focusPassage: jest.Mock;
	stealPassage: jest.Mock;
}

const Contents: React.FC<{disabled?: boolean}> = ({disabled}) => {
	const {stories} = useStoriesContext();

	return (
		<PassageEditContents
			disabled={disabled}
			passageId={stories[0].passages[0].id}
			storyId={stories[0].id}
		/>
	);
};

function renderEditor(lock?: PassageLock, props: {disabled?: boolean} = {}) {
	const handlers: Handlers = {
		blurPassage: jest.fn(),
		focusPassage: jest.fn(),
		stealPassage: jest.fn()
	};
	const story = fakeStory(1);
	const format = fakeUnloadedStoryFormat({
		name: story.storyFormat,
		version: story.storyFormatVersion
	});
	const value = testSyncContext({...handlers, lock: () => lock});
	const result = render(
		<FakeStateProvider stories={[story]} storyFormats={[format]}>
			<ServerSyncContext.Provider value={value}>
				<Contents {...props} />
			</ServerSyncContext.Provider>
		</FakeStateProvider>
	);

	return {
		...result,
		handlers,
		passageId: story.passages[0].id,
		storyId: story.id
	};
}

describe('<PassageEditContents> with soft locks', () => {
	it('claims the passage while it is the editor in front', () => {
		const {handlers, passageId, storyId, unmount} = renderEditor();

		expect(handlers.focusPassage).toHaveBeenCalledWith(storyId, passageId);
		expect(handlers.blurPassage).not.toHaveBeenCalled();

		unmount();
		expect(handlers.blurPassage).toHaveBeenCalledWith(storyId, passageId);
	});

	it('stays silent for a background card in the stack', () => {
		// Those cards are read-only for a reason that has nothing to do with presence,
		// and claiming a lock from one would shut someone else out of a passage this
		// author is only looking past.
		const {handlers} = renderEditor(undefined, {disabled: true});

		expect(handlers.focusPassage).not.toHaveBeenCalled();
		expect(screen.queryByTestId('passage-lock-banner')).toBeNull();
	});

	it('shows no banner and stays writable when nobody else is here', () => {
		const {passageId} = renderEditor(undefined);

		expect(screen.queryByTestId('passage-lock-banner')).toBeNull();
		expect(
			screen.getByTestId(`mock-passage-text-${passageId}`)
		).toHaveAttribute('data-disabled', 'false');
	});

	it('goes read-only behind a banner when someone else holds it', () => {
		const {passageId} = renderEditor({by: jules, shared: false});

		expect(screen.getByTestId('passage-lock-banner')).toHaveAttribute(
			'data-locked-by',
			'jules'
		);
		expect(
			screen.getByTestId(`mock-passage-text-${passageId}`)
		).toHaveAttribute('data-disabled', 'true');
	});

	it('becomes writable again after a takeover, with a quieter banner', () => {
		const {passageId} = renderEditor({by: jules, shared: true});

		expect(screen.getByTestId('passage-shared-banner')).toHaveAttribute(
			'data-shared-with',
			'jules'
		);
		expect(
			screen.getByTestId(`mock-passage-text-${passageId}`)
		).toHaveAttribute('data-disabled', 'false');
	});

	it('sends a steal when Take over is clicked', () => {
		const {handlers, passageId, storyId} = renderEditor({
			by: jules,
			shared: false
		});

		screen.getByTestId('passage-lock-takeover').click();
		expect(handlers.stealPassage).toHaveBeenCalledWith(storyId, passageId);
	});
});
