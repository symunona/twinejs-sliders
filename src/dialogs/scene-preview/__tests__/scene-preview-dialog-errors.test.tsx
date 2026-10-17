import {act, render} from '@testing-library/react';
import * as React from 'react';
import {useUndoableStoriesContext} from '../../../store/undoable-stories';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {ScenePreviewDialog} from '../scene-preview-dialog';
// After the dialog: `dialogs/context` first would enter the dialogs import cycle from
// the wrong end and leave a component undefined.
import {useDialogsContext} from '../../context';

// The stage is not under test: only what the dialog hands its error sidebar.
const previewProps = jest.fn();

jest.mock('../../passage-edit/scene-preview/scene-preview', () => ({
	ScenePreview: function ScenePreview(props: unknown) {
		previewProps(props);
		return null;
	}
}));
jest.mock('../../passage-edit/scene-preview/use-preview-resolver', () => ({
	usePreviewResolver: function usePreviewResolver() {
		return undefined;
	}
}));

interface Seen {
	dialogs: ReturnType<typeof useDialogsContext>['dialogs'];
	passageNames: string[];
}

const seen: Seen = {dialogs: [], passageNames: []};

const Probe: React.FC = () => {
	const {dialogs} = useDialogsContext();
	const {stories} = useUndoableStoriesContext();

	seen.dialogs = dialogs;
	seen.passageNames = stories[0].passages.map(passage => passage.name);
	return null;
};

function lastProps() {
	return previewProps.mock.calls[previewProps.mock.calls.length - 1][0];
}

function renderDialog() {
	const story = fakeStory(1);

	story.passages[0].selected = true;
	story.passages[0].text = 'one\ntwo\nthree\nfour';
	render(
		<FakeStateProvider stories={[story]}>
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
			<Probe />
		</FakeStateProvider>
	);

	return {passageId: story.passages[0].id};
}

describe('<ScenePreviewDialog> error sidebar', () => {
	beforeEach(() => previewProps.mockClear());

	it('goes to a line: caret on the Doc, passage editor opened', () => {
		const {passageId} = renderDialog();

		act(() => lastProps().onGoToLine(3));

		expect(lastProps().doc.getCursor()).toEqual(
			expect.objectContaining({ch: 0, line: 2})
		);

		// The passage edit stack: the one dialog holding passage ids.
		expect(seen.dialogs.map(dialog => dialog.props?.passageIds)).toContainEqual(
			[passageId]
		);
	});

	it('creates a passage an error names', () => {
		renderDialog();

		act(() => lastProps().onCreatePassage('Tavern'));

		expect(seen.passageNames).toContain('Tavern');
	});
});
