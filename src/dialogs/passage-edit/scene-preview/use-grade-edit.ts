/**
 * The Grade popover's live preview and its writes.
 *
 * Two speeds, like a drag: every slider move paints a DRAFT onto the stage (no text, no
 * reparse), and a release writes ONE edit (`GRADE_ORIGIN`, so a burst of them is one undo
 * step). The draft stays until the parse agrees with it, so the sprite does not flash back
 * to the old grade while the debounced parse catches up.
 *
 * One write in flight at a time. A write can splice in a new beat and move the scrubber
 * onto it, and the next write must be planned against a parse that has that beat — so a
 * release that lands while one is still being parsed waits for it.
 */

import * as React from 'react';
import {sameGrade} from '@sliders/scene-types';
import type {
	EntityGrade,
	EntityId,
	Scene,
	Stage
} from '@sliders/scene-types';
import {GRADE_ORIGIN, gradeWrite} from './grade-write';
import {PATCH_TIMEOUT_MS, type SceneWrite} from './use-scene-writer';

export interface GradeDraft {
	id: EntityId;
	grade?: EntityGrade;
}

/** The stage with a draft grade painted over one entity. Untouched when there is none. */
export function applyGradeDraft(stage: Stage, draft: GradeDraft | undefined): Stage {
	const entity = draft && stage.entities?.[draft.id];

	if (!draft || !entity) {
		return stage;
	}

	return {
		...stage,
		entities: {...stage.entities, [draft.id]: {...entity, grade: draft.grade}}
	};
}

export interface GradeEditInput {
	beat: number;
	commit: (writes: SceneWrite[], origin: string) => void;
	scene: Scene | undefined;
	states: Stage[];
	/** The parsed stage at the scrubber, with no draft on it. */
	parsedStage: Stage;
}

export interface GradeEdit {
	draft: GradeDraft | undefined;
	/** A slider moved. Paints, writes nothing. */
	change(id: EntityId, grade: EntityGrade | undefined): void;
	/** A slider was let go of, or a reset clicked: write what is on screen. */
	commit(): void;
	/** The popover opened or closed. Closing writes anything left, then lets go. */
	openChange(open: boolean): void;
}

export function useGradeEdit(input: GradeEditInput): GradeEdit {
	const [draft, setDraftState] = React.useState<GradeDraft>();
	const draftRef = React.useRef<GradeDraft>();
	const inputRef = React.useRef(input);
	/** A write went out and its parse has not come back yet. */
	const awaiting = React.useRef(false);
	/** A release arrived while `awaiting`. */
	const queued = React.useRef(false);
	const open = React.useRef(false);
	const timer = React.useRef<number>();

	inputRef.current = input;

	const setDraft = React.useCallback((next: GradeDraft | undefined) => {
		draftRef.current = next;
		setDraftState(next);
	}, []);

	const write = React.useCallback(() => {
		const current = draftRef.current;
		const {beat, commit, parsedStage, scene, states} = inputRef.current;
		const entity = parsedStage.entities?.[current?.id ?? ''];

		queued.current = false;

		if (!current || !entity || sameGrade(entity.grade, current.grade)) {
			return;
		}

		awaiting.current = true;
		window.clearTimeout(timer.current);
		// The escape hatch `holdPatch` has too: a write that changed nothing, or landed where
		// the scrubber cannot see, never brings a parse that agrees.
		timer.current = window.setTimeout(() => {
			awaiting.current = false;

			if (!open.current) {
				setDraft(undefined);
			}
		}, PATCH_TIMEOUT_MS);
		commit(
			[gradeWrite({beat, entity, next: current.grade, scene, states})],
			GRADE_ORIGIN
		);
	}, [setDraft]);

	// A parse came back: the write in flight has landed.
	React.useEffect(() => {
		if (!awaiting.current) {
			return;
		}

		awaiting.current = false;

		if (queued.current) {
			write();
		}
	}, [input.scene, input.states, write]);

	// Settle: once the parse draws what the draft draws, the draft has nothing left to do —
	// and dropping it is what lets an undo show through while the popover is still open.
	React.useEffect(() => {
		if (!draft || awaiting.current || queued.current) {
			return;
		}

		const entity = input.parsedStage.entities?.[draft.id];

		if (!entity || sameGrade(entity.grade, draft.grade)) {
			setDraft(undefined);
		}
	}, [draft, input.parsedStage, setDraft]);

	React.useEffect(() => () => window.clearTimeout(timer.current), []);

	return React.useMemo(
		() => ({
			draft,
			change(id, grade) {
				setDraft({grade, id});
			},
			commit() {
				if (awaiting.current) {
					queued.current = true;
				} else {
					write();
				}
			},
			openChange(next) {
				open.current = next;

				if (!next) {
					if (awaiting.current) {
						queued.current = true;
					} else {
						write();
					}
				}
			}
		}),
		[draft, setDraft, write]
	);
}
