import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useCommand} from '../../hotkeys';
import {storyWithId} from '../../store/stories';
import {useStoryLaunch} from '../../store/use-story-launch';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {ScenePreviewSourceContext} from './scene-preview-source-context';

export interface TestCurrentPassageCommandProps {
	storyId: string;
}

/**
 * Ctrl+Enter: test the story from the passage being worked on, in a new tab, from the
 * map, the passage text, the scene preview or any dialog.
 *
 * "The passage being worked on" is the one the scene preview shows: the front passage
 * editor, else the single passage selected on the map. Neither gives the story's own
 * start passage.
 *
 * Renders nothing. It reads the source registry when the key is pressed rather than
 * subscribing to it, because the registry publishes on every keystroke.
 */
export const TestCurrentPassageCommand: React.FC<
	TestCurrentPassageCommandProps
> = props => {
	const {storyId} = props;
	const {active} = React.useContext(ScenePreviewSourceContext);
	const {stories} = useUndoableStoriesContext();
	const {testStory} = useStoryLaunch();
	const {t} = useTranslation();
	const story = storyWithId(stories, storyId);

	useCommand({
		allowInInput: true,
		id: 'passage.testCurrent',
		label: t('hotkeys.commands.passage.testCurrent'),
		run: () => {
			const editor = active();
			const selected = story.passages.filter(passage => passage.selected);
			const passageId =
				editor?.storyId === story.id
					? editor.passageId
					: selected.length === 1
					? selected[0].id
					: undefined;

			testStory(story.id, passageId);
		},
		scope: 'global'
	});

	return null;
};
