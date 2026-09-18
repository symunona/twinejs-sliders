import * as React from 'react';
import {IndexedPassage} from '@sliders/scene-index';
import {SceneStage} from '../../dialogs/passage-edit/scene-preview/scene-stage';
import {useSceneParse} from '../../dialogs/passage-edit/scene-preview/use-scene-parse';
import {usePreviewResolver} from '../../dialogs/passage-edit/scene-preview/use-preview-resolver';

export interface PassageCardSceneProps {
	/**
	 * Every passage in the story, so that a patch scene (`from:`) can find the scene it
	 * inherits--the same array the passage editor's own preview is given.
	 */
	passages: IndexedPassage[];
	text: string;
}

/**
 * The scene a passage stages, drawn small at the bottom of its card on the story map.
 *
 * It is the ARRIVAL state (`states[0]`), never a beat: a card is glanced at, and the
 * opening of the scene is what the author recognises it by. No beat is handed to the
 * stage either, so no speech bubble is drawn over a 150px strip.
 *
 * Inert on purpose--`pointer-events: none` in the CSS--so the card underneath still
 * drags, selects and opens the way every other card does.
 *
 * Only mounted for a passage sized `largeWithPreview`, because each one of these is a
 * DomRenderer of its own, with its own image loads.
 */
export const PassageCardScene: React.FC<PassageCardSceneProps> = ({
	passages,
	text
}) => {
	// Slower than the editor's 200ms: this is peripheral vision, not the thing being typed
	// into, and the parse is running beside the map's own error scan.
	const parse = useSceneParse(text, passages, 400);
	const assets = usePreviewResolver();

	if (!parse.hasScene) {
		return null;
	}

	return (
		<div aria-hidden className="passage-card-scene">
			<SceneStage animate={false} assets={assets} muted stage={parse.states[0]} />
		</div>
	);
};
