import {extractSceneBlock} from '@sliders/scene-index';
import * as React from 'react';
import {useDialogsContext} from '../../dialogs/context';
import {
	scenePreviewDismissed,
	ScenePreviewDialog
} from '../../dialogs/scene-preview';
import {storyWithId} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {useScenePreviewSource} from './scene-preview-source-context';

export interface ScenePreviewAutoOpenProps {
	storyId: string;
}

/**
 * Opens the scene preview by itself the first time there is a scene to show.
 *
 * The preview used to be part of the passage editor and so was always there; as a dialog
 * it would have to be found before it could be used. This lets it in once--when a passage
 * editor comes up on a scene, or a scene passage is selected on the map--and never again
 * once the author has closed it (see `preview-dismissal`).
 *
 * Renders nothing, and that is the point. It subscribes to the source registry, which
 * publishes on every keystroke, so it must not be a hook inside the route: the story map
 * would re-render with every character typed into a scene.
 */
export const ScenePreviewAutoOpen: React.FC<
	ScenePreviewAutoOpenProps
> = props => {
	const {storyId} = props;
	const {dispatch} = useDialogsContext();
	const {stories} = useUndoableStoriesContext();
	const published = useScenePreviewSource();
	const story = storyWithId(stories, storyId);
	const selected = story.passages.filter(passage => passage.selected);
	const source = published?.storyId === storyId ? published : undefined;
	/**
	 * The same two sources the dialog itself resolves, asked only whether there is a scene
	 * at all. The map fallback reads the block straight out of the text rather than through
	 * `useSceneParse`, because this component wants a yes or no, not a parse.
	 */
	const showing = source
		? source.parse.hasScene
		: selected.length === 1 && !!extractSceneBlock(selected[0].text);
	const wasShowing = React.useRef(false);

	React.useEffect(() => {
		if (!showing) {
			// Armed again, so that closing every editor and opening a new scene offers the
			// preview once more--to an author who has not turned it off.
			wasShowing.current = false;
			return;
		}

		if (wasShowing.current || scenePreviewDismissed()) {
			return;
		}

		wasShowing.current = true;
		// Adding a dialog that is already open is a no-op with a highlight (see the
		// dialogs reducer), so this cannot stack up a second preview.
		dispatch({
			type: 'addDialog',
			component: ScenePreviewDialog,
			props: {storyId}
		});
	}, [dispatch, showing, storyId]);

	return null;
};
