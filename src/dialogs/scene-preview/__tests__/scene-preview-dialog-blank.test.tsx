import {act, fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import type {PassageLock} from '../../../store/persistence/server/presence';
import {
	testPresenceClient,
	testSyncContext
} from '../../../store/persistence/server/test-fixtures';
import {ServerSyncContext} from '../../../store/persistence/server/use-server-sync';
import {PassageDocsProvider} from '../../../store/passage-docs';
import type {Story} from '../../../store/stories';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {blankPassageScene} from '../../passage-edit/scene-preview/empty-scene';
import {ScenePreviewDialog} from '../scene-preview-dialog';
import {
	clearBlankSceneTemplateRequest,
	requestBlankSceneTemplate
} from '../use-blank-scene-template';

// The stage is not under test: only what the dialog writes into the passage's Doc.
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
// No library: the template's backdrop comes from the story's own scenes or nowhere.
jest.mock('../../../store/asset-library/engine-registry', () => ({
	...jest.requireActual('../../../store/asset-library/engine-registry'),
	currentLibraryEngine: function currentLibraryEngine() {
		return undefined;
	}
}));

// Which passage the map has picked. Set before a render.
let mapPick: string | undefined;

jest.mock('../../../routes/story-edit/scene-preview-source-context', () => ({
	useScenePreviewMapPick: function useScenePreviewMapPick() {
		return mapPick;
	},
	useScenePreviewSource: function useScenePreviewSource() {
		return undefined;
	}
}));

const jules = testPresenceClient({id: 'them', name: 'jules'});

function setup(texts: string[], lock?: PassageLock) {
	const story: Story = fakeStory(texts.length);

	texts.forEach((text, index) => {
		story.passages[index].text = text;
		story.passages[index].selected = false;
	});

	const dialog = () => (
		<FakeStateProvider stories={[story]}>
			<ServerSyncContext.Provider value={testSyncContext({lock: () => lock})}>
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

	return {dialog, ids: story.passages.map(passage => passage.id)};
}

function lastDoc() {
	return previewProps.mock.calls[previewProps.mock.calls.length - 1][0].doc;
}

describe('<ScenePreviewDialog> on a blank passage', () => {
	beforeEach(() => {
		previewProps.mockClear();
		clearBlankSceneTemplateRequest();
		mapPick = undefined;
	});

	it('opened on it: starts it as an empty scene', () => {
		const {dialog, ids} = setup(['']);

		mapPick = ids[0];
		render(dialog());
		expect(lastDoc().getValue()).toBe(blankPassageScene());
	});

	it('counts whitespace-only as blank, and one undo takes it all back', () => {
		const {dialog, ids} = setup([' \n\t\n']);

		mapPick = ids[0];
		render(dialog());

		const doc = lastDoc();

		expect(doc.getValue()).toBe(blankPassageScene());
		doc.undo();
		expect(doc.getValue()).toBe(' \n\t\n');
	});

	it('takes its backdrop from the story’s other scenes', () => {
		const {dialog, ids} = setup(['', '[scene]\nbg: dusk\n\n[continued]\n']);

		mapPick = ids[0];
		render(dialog());
		expect(lastDoc().getValue()).toBe(blankPassageScene('dusk'));
	});

	it('never touches a passage with anything in it', () => {
		const {dialog, ids} = setup(['Just prose.']);

		mapPick = ids[0];
		render(dialog());
		expect(lastDoc().getValue()).toBe('Just prose.');
		expect(screen.queryByTestId('scene-preview-blank')).toBeNull();
	});

	it('does not write while someone else holds the passage', () => {
		const {dialog, ids} = setup([''], {by: jules, shared: false});

		mapPick = ids[0];
		render(dialog());
		expect(lastDoc().getValue()).toBe('');
		expect(screen.queryByTestId('scene-preview-blank')).toBeNull();
	});

	it('closed untouched: leaves the passage as it was', () => {
		const {dialog, ids} = setup(['']);

		mapPick = ids[0];

		const {unmount} = render(dialog());
		const doc = lastDoc();

		expect(doc.getValue()).toBe(blankPassageScene());
		unmount();
		expect(doc.getValue()).toBe('');
	});

	it('closed after an edit: keeps the scene', () => {
		const {dialog, ids} = setup(['']);

		mapPick = ids[0];

		const {unmount} = render(dialog());
		const doc = lastDoc();

		doc.replaceRange('bg: yard\n', {ch: 0, line: 1});
		unmount();
		expect(doc.getValue()).toBe('[scene]\nbg: yard\n\n\n[continued]\n');
	});

	it('moved off untouched: reverts, and the passage it moved to is only looked at', () => {
		const {dialog, ids} = setup(['', '']);

		mapPick = ids[0];

		const {rerender} = render(dialog());
		const first = lastDoc();

		mapPick = ids[1];
		rerender(dialog());
		expect(first.getValue()).toBe('');
		expect(lastDoc().getValue()).toBe('');
	});

	it('a blank passage picked while open fills on a click into the editor', () => {
		const {dialog, ids} = setup(['Prose.', '']);

		mapPick = ids[0];

		const {rerender} = render(dialog());

		mapPick = ids[1];
		rerender(dialog());
		expect(lastDoc().getValue()).toBe('');
		fireEvent.pointerDown(screen.getByTestId('scene-preview-blank'));
		expect(lastDoc().getValue()).toBe(blankPassageScene());
	});

	it('undone, then clicked into again: fills again', async () => {
		const {dialog, ids} = setup(['']);

		mapPick = ids[0];
		render(dialog());

		const doc = lastDoc();

		doc.undo();
		fireEvent.pointerDown(await screen.findByTestId('scene-preview-blank'));
		expect(doc.getValue()).toBe(blankPassageScene());
	});

	it('a passage opened for editing while the dialog is up fills', () => {
		const {dialog, ids} = setup(['Prose.', '']);

		mapPick = ids[0];

		const {rerender} = render(dialog());

		act(() => requestBlankSceneTemplate(ids[1]));
		mapPick = ids[1];
		rerender(dialog());
		expect(lastDoc().getValue()).toBe(blankPassageScene());
	});
});
