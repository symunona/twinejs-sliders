/**
 * The opacity slider's live preview.
 *
 * Same two speeds as the grade sliders: a move paints a DRAFT over the selection (no text,
 * no reparse), a release writes once. The draft is held after the write until the parse
 * agrees with it, so the sprite does not flash back to its old opacity while the debounced
 * parse catches up — and dropped after `PATCH_TIMEOUT_MS` if it never does.
 */

import * as React from 'react';
import type {EntityId, Stage} from '@sliders/scene-types';
import {PATCH_TIMEOUT_MS} from './use-scene-writer';

export interface OpacityDraft {
	ids: EntityId[];
	value: number;
	/** Handed to the writer; now only waiting for the parse to catch up. */
	written?: boolean;
}

/** The stage with the draft opacity painted over its entities. Untouched when none. */
export function applyOpacityDraft(
	stage: Stage,
	draft: OpacityDraft | undefined
): Stage {
	if (!draft || !stage.entities) {
		return stage;
	}

	const entities = {...stage.entities};

	for (const id of draft.ids) {
		if (entities[id]) {
			entities[id] = {...entities[id], opacity: draft.value};
		}
	}

	return {...stage, entities};
}

/** Every drafted entity the parse still has reads the drafted opacity. */
export function opacityAgrees(stage: Stage, draft: OpacityDraft): boolean {
	return draft.ids.every(id => {
		const entity = stage.entities?.[id];

		return !entity || Math.abs(entity.opacity - draft.value) < 0.005;
	});
}

export interface OpacityDraftEdit {
	draft: OpacityDraft | undefined;
	/** The slider moved: paint these entities at this opacity. */
	change(ids: EntityId[], value: number): void;
	/** The draft went to the writer. Hold it until the parse agrees. */
	written(): void;
}

export function useOpacityDraft(parsedStage: Stage): OpacityDraftEdit {
	const [draft, setDraft] = React.useState<OpacityDraft>();
	const timer = React.useRef<number>();

	React.useEffect(() => () => window.clearTimeout(timer.current), []);

	React.useEffect(() => {
		if (draft?.written && opacityAgrees(parsedStage, draft)) {
			window.clearTimeout(timer.current);
			setDraft(undefined);
		}
	}, [draft, parsedStage]);

	const change = React.useCallback((ids: EntityId[], value: number) => {
		window.clearTimeout(timer.current);
		setDraft({ids, value});
	}, []);

	const written = React.useCallback(() => {
		setDraft(current => current && {...current, written: true});
		window.clearTimeout(timer.current);
		timer.current = window.setTimeout(
			() => setDraft(current => (current?.written ? undefined : current)),
			PATCH_TIMEOUT_MS
		);
	}, []);

	return {change, draft, written};
}
