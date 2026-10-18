import {fireEvent, render} from '@testing-library/react';
import * as React from 'react';
import type {SceneParse} from '../../../dialogs/passage-edit/scene-preview/use-scene-parse';
import {Story} from '../../../store/stories';
import {useStoryLaunch} from '../../../store/use-story-launch';
import {FakeStateProvider, fakeStory} from '../../../test-util';
import {
	ScenePreviewSourceProvider,
	usePublishScenePreview
} from '../scene-preview-source-context';
import {TestCurrentPassageCommand} from '../test-current-passage-command';

jest.mock('../../../store/use-story-launch');

const FakeEditor: React.FC<{passageId: string; storyId: string}> = props => {
	usePublishScenePreview({...props, parse: {} as SceneParse});
	return null;
};

describe('<TestCurrentPassageCommand>', () => {
	const testStory = jest.fn();

	beforeEach(() => {
		testStory.mockReset();
		(useStoryLaunch as jest.Mock).mockReturnValue({testStory});
	});

	function renderComponent(story: Story, editorPassageId?: string) {
		return render(
			<FakeStateProvider stories={[story]}>
				<ScenePreviewSourceProvider>
					{editorPassageId && (
						<FakeEditor passageId={editorPassageId} storyId={story.id} />
					)}
					<TestCurrentPassageCommand storyId={story.id} />
					<textarea data-testid="field" />
				</ScenePreviewSourceProvider>
			</FakeStateProvider>
		);
	}

	function pressCtrlEnter(target: Element = document.body) {
		fireEvent.keyDown(target, {code: 'Enter', ctrlKey: true, key: 'Enter'});
	}

	it('tests from the front passage editor, even with focus in a text field', () => {
		const story = fakeStory(3);

		story.passages[1].selected = true;

		const {getByTestId} = renderComponent(story, story.passages[2].id);

		pressCtrlEnter(getByTestId('field'));
		expect(testStory).toHaveBeenCalledWith(story.id, story.passages[2].id);
	});

	it('tests from the solo selected passage when no editor is open', () => {
		const story = fakeStory(3);

		story.passages.forEach(passage => (passage.selected = false));
		story.passages[1].selected = true;
		renderComponent(story);
		pressCtrlEnter();
		expect(testStory).toHaveBeenCalledWith(story.id, story.passages[1].id);
	});

	it('tests from the start passage with no editor and no single selection', () => {
		const story = fakeStory(3);

		story.passages.forEach(passage => (passage.selected = true));
		renderComponent(story);
		pressCtrlEnter();
		expect(testStory).toHaveBeenCalledWith(story.id, undefined);
	});
});
