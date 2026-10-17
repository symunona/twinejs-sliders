import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {PassageLock} from '../../../store/persistence/server/presence';
import {
	testPresenceClient,
	testSyncContext
} from '../../../store/persistence/server/test-fixtures';
import {ServerSyncContext} from '../../../store/persistence/server/use-server-sync';
import {PassageDocsProvider} from '../../../store/passage-docs';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {ScenePreviewDialog} from '../scene-preview-dialog';

// The stage itself is not under test: only what the dialog tells it about the lock.
const previewProps = jest.fn();

jest.mock('../../passage-edit/scene-preview/scene-preview', () => ({
	ScenePreview: function ScenePreview(props: {
		doc?: unknown;
		readOnly?: boolean;
		text: string;
	}) {
		previewProps(props);
		return null;
	}
}));
jest.mock('../../passage-edit/scene-preview/use-preview-resolver', () => ({
	usePreviewResolver: function usePreviewResolver() {
		return undefined;
	}
}));

const jules = testPresenceClient({id: 'them', name: 'jules'});

function renderDialog(lock?: PassageLock) {
	const stealPassage = jest.fn();
	const focusPassage = jest.fn();
	const story = fakeStory(1);

	// The map's solo selection is what the dialog shows with no editor open.
	story.passages[0].selected = true;

	render(
		<FakeStateProvider stories={[story]}>
			<ServerSyncContext.Provider
				value={testSyncContext({focusPassage, lock: () => lock, stealPassage})}
			>
				{/* Inner registry: it claims through THIS sync context. */}
				<PassageDocsProvider>
					<ScenePreviewDialog
						collapsed={false}
						highlighted={false}
						maximized={false}
						onChangeCollapsed={jest.fn()}
						onChangeHighlighted={jest.fn()}
						onChangeMaximized={jest.fn()}
						onChangeProps={jest.fn()}
						onClose={jest.fn()}
						storyId={story.id}
					/>
				</PassageDocsProvider>
			</ServerSyncContext.Provider>
		</FakeStateProvider>
	);

	return {
		focusPassage,
		passageId: story.passages[0].id,
		stealPassage,
		storyId: story.id
	};
}

function lastProps() {
	return previewProps.mock.calls[previewProps.mock.calls.length - 1][0];
}

function lastReadOnly() {
	return previewProps.mock.calls[previewProps.mock.calls.length - 1][0]
		.readOnly;
}

describe('<ScenePreviewDialog> soft lock', () => {
	beforeEach(() => previewProps.mockClear());

	it('leaves the stage writable when nobody else is in the passage', () => {
		renderDialog();

		expect(lastReadOnly()).toBe(false);
		expect(screen.queryByTestId('passage-lock-banner')).toBeNull();
	});

	it('makes the stage read-only while someone else holds the passage', () => {
		renderDialog({by: jules, shared: false});

		expect(lastReadOnly()).toBe(true);
		expect(screen.getByTestId('passage-lock-banner')).toBeInTheDocument();
	});

	it('takes the edit over from the banner', () => {
		const {passageId, stealPassage, storyId} = renderDialog({
			by: jules,
			shared: false
		});

		fireEvent.click(screen.getByTestId('passage-lock-takeover'));
		expect(stealPassage).toHaveBeenCalledWith(storyId, passageId);
	});

	it('announces itself when taking over, or the holder never hears', () => {
		const {focusPassage, passageId, storyId} = renderDialog({
			by: jules,
			shared: false
		});

		expect(focusPassage).not.toHaveBeenCalled();
		fireEvent.click(screen.getByTestId('passage-lock-takeover'));
		expect(focusPassage).toHaveBeenCalledWith(storyId, passageId);
	});

	it('holds the passage Doc itself, so the stage writes with no editor open', () => {
		renderDialog();

		const {doc} =
			previewProps.mock.calls[previewProps.mock.calls.length - 1][0];

		expect(doc.getValue()).toBe(lastProps().text);
	});

	it('writes again once the edit is shared', () => {
		renderDialog({by: jules, shared: true});

		expect(lastReadOnly()).toBe(false);
		expect(screen.getByTestId('passage-shared-banner')).toBeInTheDocument();
	});
});
