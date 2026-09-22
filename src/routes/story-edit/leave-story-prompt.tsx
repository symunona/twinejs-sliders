import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Prompt} from 'react-router-dom';
import {useUndoableStoriesContext} from '../../store/undoable-stories';

/**
 * Asks before navigating out of the story editor once the author has changed
 * something. This catches the browser's own Back button as well as the one in
 * the toolbar--both are a history POP, and both are easy to hit by accident
 * with a trackpad swipe.
 *
 * Nothing is lost by leaving: edits are saved as they're made. The undo stack
 * is, which is why the guard keys off the same change count that feeds it.
 */
export const LeaveStoryPrompt: React.FC = () => {
	const {changeCount} = useUndoableStoriesContext();
	const {t} = useTranslation();

	return (
		<Prompt
			message={t('routes.storyEdit.leaveConfirm')}
			when={changeCount > 0}
		/>
	);
};
