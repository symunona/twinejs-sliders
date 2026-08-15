import type {EntityId, EntityKind} from '@sliders/scene-types';

/**
 * A splice. Offsets are relative to the SCENE BLOCK text, not to the passage — the caller
 * adds `extractSceneBlock().offset` before handing it to CodeMirror.
 *
 * One edit per gesture, never a stream: a drag that produces 60 undo steps is unusable.
 */
export interface TextEdit {
	from: number;
	to: number;
	insert: string;
}

/** Where a write should land. */
export interface EntityTarget {
	/** `cast` -> the `cast:` map, `prop` -> the `props:` map. */
	kind: EntityKind;
	id: EntityId;
	/**
	 * When set, write into `beats[beat]` instead of the `cast:`/`props:` entry — so a drag
	 * while the scrubber sits on a beat that already patches this entity moves what the eye
	 * actually sees, not the entry it was inherited from.
	 */
	beat?: number;
}

/** 1-indexed, inclusive line span of an entity entry inside the block. */
export interface LineSpan {
	start: number;
	end: number;
}
