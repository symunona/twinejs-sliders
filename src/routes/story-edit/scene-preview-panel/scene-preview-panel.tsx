import classNames from 'classnames';
import * as React from 'react';
import {useParams} from 'react-router-dom';
import {addPassageEditors, useDialogsContext} from '../../../dialogs/context';
import {
	ScenePreview,
	ScenePreviewMode
} from '../../../dialogs/passage-edit/scene-preview/scene-preview';
import {usePreviewResolver} from '../../../dialogs/passage-edit/scene-preview/use-preview-resolver';
import {useSceneParse} from '../../../dialogs/passage-edit/scene-preview/use-scene-parse';
import {storyWithId} from '../../../store/stories';
import {useUndoableStoriesContext} from '../../../store/undoable-stories';
import {useScenePreviewSource} from './scene-preview-source-context';
import './scene-preview-panel.css';

const MODE_KEY = 'sliders.preview.mode';
const OPEN_KEY = 'sliders.preview.open';
const SEEN_KEY = 'sliders.preview.seen';

/**
 * How much of the route the panel is holding. Read by the map scroller and the dialog
 * column, which are `position: fixed` and would otherwise sit underneath it.
 */
const DOCK_HEIGHT_VAR = '--sliders-preview-dock-height';
const LEFT_WIDTH_VAR = '--sliders-preview-left-width';

/**
 * The scene preview, once per story edit route rather than once per passage editor.
 *
 * It shows whichever passage the author is working in: the passage editor at the front of
 * the dialog stack if one is open, and otherwise the single passage selected on the map.
 * The fallback has no CodeMirror to write through, so it is a picture — every gesture is a
 * text edit (spec 07), and there is no text to edit without an editor.
 */
export const ScenePreviewPanel: React.FC = () => {
	const {storyId} = useParams<{storyId: string}>();
	const {dispatch: dialogsDispatch} = useDialogsContext();
	const {stories} = useUndoableStoriesContext();
	const story = storyWithId(stories, storyId);
	const assets = usePreviewResolver();
	const published = useScenePreviewSource();
	const [mode, setMode] = React.useState<ScenePreviewMode>(() =>
		window.localStorage.getItem(MODE_KEY) === 'left' ? 'left' : 'dock'
	);
	const [open, setOpen] = React.useState(
		() => window.localStorage.getItem(OPEN_KEY) !== 'false'
	);
	const [fullScreen, setFullScreen] = React.useState(false);
	const root = React.useRef<HTMLDivElement>(null);
	// An editor for another story would be a leftover; the panel belongs to this route.
	const source = published?.storyId === story.id ? published : undefined;
	const selected = story.passages.filter(passage => passage.selected);
	/**
	 * The map's answer to "which passage", used only when no editor is open. Solo selection
	 * only: with two selected there is no one scene to show, the same rule the passage
	 * toolbar's actions follow.
	 */
	const fallback =
		!source && selected.length === 1 ? selected[0] : undefined;
	// Unconditional, because hooks are. Parsing nothing is cheap and returns the empty parse.
	const fallbackParse = useSceneParse(fallback?.text ?? '', story.passages);
	const parse = source?.parse ?? fallbackParse;
	const showing = (!!source || !!fallback) && parse.hasScene;

	/**
	 * Ctrl/cmd-click on a link inside a scene bubble, when the preview is showing a passage
	 * nobody has open. Opens the target the same way a double click on the map does.
	 */
	const handleOpenPassage = React.useCallback(
		(name: string) => {
			const target = story.passages.find(passage => passage.name === name);

			if (target) {
				dialogsDispatch(addPassageEditors(story.id, [target.id]));
			}
		},
		[dialogsDispatch, story]
	);

	const handleModeChange = React.useCallback((next: ScenePreviewMode) => {
		window.localStorage.setItem(MODE_KEY, next);
		setMode(next);
	}, []);

	// The first time the author opens the preview it comes up full screen (D12). Tied to
	// the click rather than to "a scene appeared", which would hijack the screen while
	// they are still typing the block out.
	const handleOpenChange = React.useCallback((next: boolean) => {
		window.localStorage.setItem(OPEN_KEY, String(next));
		setOpen(next);

		if (next && !window.localStorage.getItem(SEEN_KEY)) {
			window.localStorage.setItem(SEEN_KEY, '1');
			setFullScreen(true);
		}
	}, []);

	/**
	 * Hands the panel's own size to the rest of the route.
	 *
	 * Measured rather than declared: the dock is as tall as the bar plus whatever the stage
	 * clamped itself to, and a constant here would drift the first time either changed. A
	 * collapsed panel is still one bar tall and still reserves that, so the map and the
	 * dialog column stop above it instead of running underneath. Full screen reserves
	 * nothing — the preview is not on the route then, it is portaled to the body.
	 */
	React.useEffect(() => {
		const {style} = document.documentElement;
		const element = root.current;
		const reserve = showing && !fullScreen;
		// Collapsed the panel lies along the bottom whatever the mode is, so that is the
		// edge it takes room from.
		const edge = open ? mode : 'dock';

		const apply = () => {
			const rect = reserve ? element?.getBoundingClientRect() : undefined;

			style.setProperty(
				DOCK_HEIGHT_VAR,
				rect && edge === 'dock' ? `${rect.height}px` : '0px'
			);
			style.setProperty(
				LEFT_WIDTH_VAR,
				rect && edge === 'left' ? `${rect.width}px` : '0px'
			);
		};

		apply();

		const observer =
			reserve && element && typeof ResizeObserver !== 'undefined'
				? new ResizeObserver(apply)
				: undefined;

		observer?.observe(element!);

		return () => {
			observer?.disconnect();
			style.removeProperty(DOCK_HEIGHT_VAR);
			style.removeProperty(LEFT_WIDTH_VAR);
		};
	}, [fullScreen, mode, open, showing]);

	if (!showing) {
		return null;
	}

	return (
		// Collapsed, the panel is only its bar, and a bar belongs along the bottom whichever
		// layout the author picked.
		<div
			className={classNames('scene-preview-panel', open ? mode : 'dock', {
				'full-screen': fullScreen,
				open
			})}
			ref={root}
		>
			<ScenePreview
				assets={assets}
				editor={source?.editor}
				fullScreen={fullScreen}
				mode={mode}
				onFullScreenChange={setFullScreen}
				onModeChange={handleModeChange}
				onOpenChange={handleOpenChange}
				onOpenPassage={source?.onOpenPassage ?? handleOpenPassage}
				open={open}
				parse={parse}
				passages={story.passages}
				text={source?.text ?? fallback?.text ?? ''}
			/>
		</div>
	);
};
