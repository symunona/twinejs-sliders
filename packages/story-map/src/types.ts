/**
 * @sliders/story-map — the story as the map, the linter and the asset walk need to see it.
 *
 * These are STRUCTURAL types, deliberately. The same three readers run over three different
 * objects: the CLI's `StoryBody` parsed off disk, the editor's `Story` out of the stories
 * store, and a fixture in a test. Naming only the fields that are actually read lets all
 * three pass without a converter in the middle — and a converter is exactly where the CLI
 * and the panel would start printing different maps.
 */

/**
 * One passage, as anything that reads a story needs it.
 *
 * No index signature, deliberately. `{[key: string]: unknown}` would read as "and whatever
 * else", but TypeScript treats it as a REQUIREMENT: an ordinary interface without one is
 * not assignable to it, so the editor's `Passage` — the main thing this was written for —
 * would have been the one type that did not fit. Extra fields flow in anyway.
 */
export interface PassageLike {
	id: string;
	name: string;
	tags: string[];
	text: string;
}

/** A story body: the passages, and the one other field the linter reads. */
export interface StoryLike {
	id: string;
	name: string;
	passages: PassageLike[];
	/** Where the reader starts, by passage id. Unreachability is measured from it. */
	startPassage?: string;
}

export interface AssetMetaRow {
	id: string;
	name: string;
	kind: string;
	tags: string[];
	w: number;
	h: number;
	bytes: number;
	hash: string;
	mime: string;
	ownerCharacter?: string;
}

export interface Manifest {
	version: number;
	assets: AssetMetaRow[];
	characters: unknown[];
	rev: number;
	/** Manifest entries whose bytes the store does not have. Computed, never stored. */
	missing: string[];
}
