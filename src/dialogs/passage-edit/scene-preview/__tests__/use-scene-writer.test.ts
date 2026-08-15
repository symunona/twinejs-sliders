import {act, renderHook} from '@testing-library/react-hooks';
import {extractSceneBlock} from '@sliders/scene-index';
import {applyEdit} from '@sliders/scene-edit';
import type {Scene} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {
	applyStagePatch,
	beatPatchesEntity,
	buildEntityEdit,
	buildWriteEdit,
	buildWriteEdits,
	DRAG_ORIGIN,
	isOwnOrigin,
	mergeEdits,
	NUDGE_ORIGIN,
	PATCH_TIMEOUT_MS,
	planEntityWrite,
	settlePatch,
	useScenePatch,
	writeSceneEdits,
	type SceneWrite,
	type WritableEditor
} from '../use-scene-writer';

const passage = [
	'mood: tense', // 0
	'--', // 1
	'[scene]', // 2
	'id: tavern', // 3
	'cast:', // 4
	'  mira: {at: -0.4, frame: idle}', // 5
	'props:', // 6
	'  candle: {at: 0.1, scale: 0.6}', // 7
	'beats:', // 8
	'  - mira: {at: 0.2}', // 9
	'  - mira: "Hello."' // 10
].join('\n');

const patchPassage = [
	'[scene]',
	'from: tavern',
	'beats:',
	'  - mira: "Back again."'
].join('\n');

function blockOf(text: string) {
	const block = extractSceneBlock(text);

	if (!block) {
		throw new Error('no scene block');
	}

	return block;
}

function sceneOf(text: string): Scene {
	const parse = parseSceneText(text);

	if (!parse.result) {
		throw new Error('no parse result');
	}

	return parse.result.scene;
}

/** A stand-in for CodeMirror: enough to convert offsets and record the write. */
function fakeEditor(text: string) {
	const replaceRange = jest.fn();

	return {
		replaceRange,
		posFromIndex(index: number) {
			const before = text.slice(0, index).split('\n');

			return {ch: before[before.length - 1].length, line: before.length - 1};
		}
	} as WritableEditor & {replaceRange: jest.Mock};
}

describe('planEntityWrite()', () => {
	const scene = sceneOf(passage);

	it('writes the cast entry when the scrubber is on the opening state', () => {
		const plan = planEntityWrite(scene, 0, 'cast', 'mira');

		expect(plan.targets).toEqual([{id: 'mira', kind: 'cast'}]);
		expect(plan.addEntity).toBe(false);
	});

	it('writes the beat when the beat on screen already patches the entity', () => {
		// State 1 is produced by beats[0], which is `- mira: {at: 0.2}`.
		const plan = planEntityWrite(scene, 1, 'cast', 'mira');

		expect(plan.targets[0]).toEqual({beat: 0, id: 'mira', kind: 'cast'});
		// The entry stays as the fallback for when the beat entry cannot be located.
		expect(plan.targets[1]).toEqual({id: 'mira', kind: 'cast'});
	});

	it('writes the entry when the beat on screen only speaks', () => {
		// beats[1] is `- mira: "Hello."` — dialogue, no stage change.
		const plan = planEntityWrite(scene, 2, 'cast', 'mira');

		expect(plan.targets).toEqual([{id: 'mira', kind: 'cast'}]);
	});

	it('adds an entry for an entity a patch scene only inherits', () => {
		const plan = planEntityWrite(sceneOf(patchPassage), 0, 'cast', 'mira');

		expect(plan.addEntity).toBe(true);
	});
});

describe('beatPatchesEntity()', () => {
	const scene = sceneOf(passage);

	it('is false for a beat that only says something', () => {
		expect(beatPatchesEntity(scene.beats[1], 'mira')).toBe(false);
	});

	it('is false for another entity', () => {
		expect(beatPatchesEntity(scene.beats[0], 'candle')).toBe(false);
	});

	it('is true for a stage change', () => {
		expect(beatPatchesEntity(scene.beats[0], 'mira')).toBe(true);
	});
});

describe('writeSceneEdits()', () => {
	function context(text: string, beat = 0) {
		const block = blockOf(text);

		return {
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: sceneOf(text)
		};
	}

	it('makes exactly one replaceRange for a drag, with the drag origin', () => {
		const editor = fakeEditor(passage);
		const wrote = writeSceneEdits(
			editor,
			context(passage),
			[
				{
					id: 'mira',
					key: 'at',
					kind: 'cast',
					ref: 'mira',
					value: {x: -0.2, y: -0.85}
				}
			],
			DRAG_ORIGIN
		);

		expect(wrote).toBe(true);
		expect(editor.replaceRange).toHaveBeenCalledTimes(1);

		const [insert, from, to, origin] = editor.replaceRange.mock.calls[0];

		expect(origin).toBe(DRAG_ORIGIN);
		// `at` was a bare number and stays one: y is the layer baseline.
		expect(insert).toBe('-0.2');
		expect(from).toEqual({ch: 13, line: 5});
		expect(to).toEqual({ch: 17, line: 5});
	});

	it('still makes one replaceRange when two entities move together', () => {
		const editor = fakeEditor(passage);

		writeSceneEdits(
			editor,
			context(passage),
			[
				{
					id: 'mira',
					key: 'at',
					kind: 'cast',
					ref: 'mira',
					value: {x: -0.2, y: -0.85}
				},
				{
					id: 'candle',
					key: 'at',
					kind: 'prop',
					ref: 'candle',
					value: {x: 0.3, y: -0.85}
				}
			],
			DRAG_ORIGIN
		);

		expect(editor.replaceRange).toHaveBeenCalledTimes(1);

		const [insert] = editor.replaceRange.mock.calls[0];

		// The span between the two edits is re-inserted verbatim, so undo restores both.
		expect(insert).toContain('-0.2');
		expect(insert).toContain('0.3');
		expect(insert).toContain('props:');
	});

	it('writes into the beat when the scrubber is on it', () => {
		const editor = fakeEditor(passage);

		writeSceneEdits(
			editor,
			context(passage, 1),
			[
				{
					id: 'mira',
					key: 'at',
					kind: 'cast',
					ref: 'mira',
					value: {x: 0.5, y: -0.85}
				}
			],
			NUDGE_ORIGIN
		);

		const [insert, from, , origin] = editor.replaceRange.mock.calls[0];

		expect(origin).toBe(NUDGE_ORIGIN);
		expect(insert).toBe('0.5');
		expect(from.line).toBe(9);
	});

	it('does nothing when the value is already what the text says', () => {
		const editor = fakeEditor(passage);

		expect(
			writeSceneEdits(editor, context(passage), [
				{
					id: 'mira',
					key: 'at',
					kind: 'cast',
					ref: 'mira',
					value: {x: -0.4, y: -0.85}
				}
			])
		).toBe(false);
		expect(editor.replaceRange).not.toHaveBeenCalled();
	});

	it('creates an entry for an entity a patch scene only inherits', () => {
		const editor = fakeEditor(patchPassage);

		writeSceneEdits(editor, context(patchPassage), [
			{
				id: 'mira',
				key: 'at',
				kind: 'cast',
				ref: 'mira',
				value: {x: 0.4, y: -0.85}
			}
		]);

		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		expect(editor.replaceRange.mock.calls[0][0]).toContain('mira: {at: 0.4}');
	});

	it('does nothing without an editor', () => {
		expect(
			writeSceneEdits(undefined, context(passage), [
				{id: 'mira', key: 'at', kind: 'cast', ref: 'mira', value: {x: 0, y: 0}}
			])
		).toBe(false);
	});
});

describe('scale write-back', () => {
	function edit(value: unknown) {
		const block = blockOf(passage);

		return buildEntityEdit(
			{
				beat: 0,
				blockOffset: block.offset,
				blockText: block.text,
				scene: sceneOf(passage)
			},
			{id: 'candle', key: 'scale', kind: 'prop', ref: 'candle', value}
		);
	}

	it('changes an existing scale in place', () => {
		const block = blockOf(passage);
		const result = edit(1.4);

		expect(result).toBeDefined();
		expect(applyEdit(block.text, result!)).toContain(
			'candle: {at: 0.1, scale: 1.4}'
		);
	});

	it('removes the key rather than writing scale: 1', () => {
		const block = blockOf(passage);
		const result = edit(undefined);

		expect(result).toBeDefined();

		const after = applyEdit(block.text, result!);

		expect(after).toContain('candle: {at: 0.1}');
		expect(after).not.toContain('scale');
	});

	it('does not invent an entry just to remove a key that is not there', () => {
		const block = blockOf(patchPassage);

		expect(
			buildEntityEdit(
				{
					beat: 0,
					blockOffset: block.offset,
					blockText: block.text,
					scene: sceneOf(patchPassage)
				},
				{id: 'mira', key: 'scale', kind: 'cast', ref: 'mira', value: undefined}
			)
		).toBeUndefined();
	});
});

describe('buildWriteEdit()', () => {
	function context(text: string, beat = 0) {
		const block = blockOf(text);

		return {
			beat,
			blockOffset: block.offset,
			blockText: block.text,
			scene: sceneOf(text)
		};
	}

	function apply(text: string, write: SceneWrite, beat = 0) {
		const ctx = context(text, beat);
		const edit = buildWriteEdit(ctx, write);

		expect(edit).toBeDefined();

		return applyEdit(ctx.blockText, edit!);
	}

	it('deletes the entry outright when the scene has no from:', () => {
		const after = apply(passage, {id: 'candle', kind: 'prop', struct: 'remove'});

		expect(after).not.toContain('candle');
		// Last one out takes the empty `props:` map with it.
		expect(after).not.toContain('props:');
	});

	it('rewrites the entry as `id: ~` when the scene is a patch scene', () => {
		const patchWithEntry = [
			'[scene]',
			'from: tavern',
			'cast:',
			'  mira: {at: 0.2}'
		].join('\n');

		// With `from:`, an absent key means INHERITED — deleting the line would put mira
		// straight back on stage, which is the whole reason `~` exists (spec 02).
		expect(
			apply(patchWithEntry, {id: 'mira', kind: 'cast', struct: 'remove'})
		).toContain('mira: ~');
	});

	it('adds a whole entry for a dropped asset', () => {
		const after = apply(passage, {
			id: 'lantern',
			kind: 'prop',
			patch: {at: {x: 0.5, y: -0.85}, kind: 'prop', ref: 'props/lantern'},
			struct: 'add'
		});

		// `ref` survives because it differs from the id; `at` stays bare on the baseline.
		expect(after).toContain('lantern: {ref: props/lantern, at: 0.5}');
	});

	it('writes a top-level scene key', () => {
		expect(
			apply(passage, {formatted: 'tavern-night', sceneKey: 'bg'})
		).toContain('bg: tavern-night');
	});

	it('removes a top-level scene key when the value goes away', () => {
		const withCamera = ['[scene]', 'camera: {zoom: 2}', 'cast:', '  mira: {at: 0}'].join(
			'\n'
		);

		expect(apply(withCamera, {sceneKey: 'camera'})).not.toContain('camera');
	});

	it('is undefined when there is no such key to remove', () => {
		expect(
			buildWriteEdit(context(passage), {sceneKey: 'camera'})
		).toBeUndefined();
	});
});

/**
 * Deleting a multi-select used to be N removals each computed against the same original
 * text, so each one saw a map that still had other members and left it standing. The merge
 * of those edits produced a bare `cast:` with nothing under it.
 */
describe('deleting several entities at once', () => {
	function contextOf(text: string) {
		const block = blockOf(text);

		return {
			beat: 0,
			blockOffset: block.offset,
			blockText: block.text,
			scene: sceneOf(text)
		};
	}

	function applyAll(text: string, writes: SceneWrite[]) {
		const ctx = contextOf(text);
		const merged = mergeEdits(ctx.blockText, buildWriteEdits(ctx, writes));

		expect(merged).toBeDefined();

		return applyEdit(ctx.blockText, merged!);
	}

	const twoPassage = [
		'[scene]',
		'id: tavern',
		'cast:',
		'  mira: {at: -0.4}',
		'  joren: {at: 0.35}',
		'props:',
		'  candle: {at: 0.1}',
		'beats:',
		'  - mira: "Hello."'
	].join('\n');

	it('leaves no dangling map when a whole map goes in one gesture', () => {
		const after = applyAll(twoPassage, [
			{id: 'mira', kind: 'cast', struct: 'remove'},
			{id: 'joren', kind: 'cast', struct: 'remove'}
		]);

		expect(after).not.toContain('cast:');
		expect(after).toContain('id: tavern\nprops:');
	});

	it('keeps the map when the selection does not cover it', () => {
		const after = applyAll(twoPassage, [
			{id: 'mira', kind: 'cast', struct: 'remove'},
			{id: 'candle', kind: 'prop', struct: 'remove'}
		]);

		// cast: still has joren, so it stays; props: lost its only entry, so it goes.
		expect(after).toContain('cast:\n  joren: {at: 0.35}');
		expect(after).not.toContain('props:');
	});

	it('empties both maps across kinds in a single replaceRange', () => {
		const editor = fakeEditor(twoPassage);
		const writes: SceneWrite[] = [
			{id: 'mira', kind: 'cast', struct: 'remove'},
			{id: 'joren', kind: 'cast', struct: 'remove'},
			{id: 'candle', kind: 'prop', struct: 'remove'}
		];

		writeSceneEdits(editor, contextOf(twoPassage), writes);

		expect(editor.replaceRange).toHaveBeenCalledTimes(1);
		// Both maps sit next to each other, so the merged edit is one contiguous deletion.
		expect(editor.replaceRange.mock.calls[0][0]).toBe('');
		expect(applyAll(twoPassage, writes)).toBe(
			'id: tavern\nbeats:\n  - mira: "Hello."'
		);
	});

	it('tombstones instead of deleting when the scene has from:', () => {
		const patchWithEntries = [
			'[scene]',
			'from: tavern',
			'cast:',
			'  mira: {at: 0.2}',
			'  joren: {at: 0.5}'
		].join('\n');
		const after = applyAll(patchWithEntries, [
			{id: 'mira', kind: 'cast', struct: 'remove'},
			{id: 'joren', kind: 'cast', struct: 'remove'}
		]);

		// Absent means INHERITED, so the map has to stay and say `~` twice.
		expect(after).toBe('from: tavern\ncast:\n  mira: ~\n  joren: ~');
	});
});

describe('mergeEdits()', () => {
	it('refuses to merge overlapping edits', () => {
		expect(
			mergeEdits('0123456789', [
				{from: 0, insert: 'a', to: 5},
				{from: 3, insert: 'b', to: 8}
			])
		).toBeUndefined();
	});

	it('carries the text between two edits across unchanged', () => {
		expect(
			mergeEdits('0123456789', [
				{from: 1, insert: 'a', to: 2},
				{from: 5, insert: 'b', to: 6}
			])
		).toEqual({from: 1, insert: 'a234b', to: 6});
	});
});

describe('isOwnOrigin()', () => {
	it.each([DRAG_ORIGIN, NUDGE_ORIGIN, '*sliders-drag'])(
		'accepts %s',
		origin => {
			expect(isOwnOrigin(origin)).toBe(true);
		}
	);

	it.each(['+input', 'undo', 'paste', undefined])('rejects %s', origin => {
		expect(isOwnOrigin(origin)).toBe(false);
	});
});

describe('applyStagePatch() / settlePatch()', () => {
	const stage = parseSceneText(passage).states[0];

	it('paints the gesture value over the parsed stage', () => {
		const patched = applyStagePatch(stage, {mira: {at: {x: 0.5, y: -0.85}}});

		expect(patched.entities.mira.at.x).toBe(0.5);
		// The parsed stage is never mutated: it is what the patch is compared against.
		expect(stage.entities.mira.at.x).toBeCloseTo(-0.4);
	});

	it('returns the same stage when nothing is patched', () => {
		expect(applyStagePatch(stage, {})).toBe(stage);
	});

	it('drops a patch entry once the parse agrees with it', () => {
		const patch = {mira: {at: {x: -0.4, y: -0.85}}};

		expect(settlePatch(patch, stage.entities)).toEqual({});
	});

	it('keeps a patch entry the parse has not caught up with', () => {
		const patch = {mira: {at: {x: 0.5, y: -0.85}}};

		expect(settlePatch(patch, stage.entities)).toBe(patch);
	});
});

describe('useScenePatch()', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('holds the patch after a write, then lets it go', () => {
		const {result} = renderHook(() => useScenePatch());

		act(() => result.current.setPatch({mira: {at: {x: 0.5, y: -0.85}}}));
		act(() => result.current.holdPatch());

		// The parse has not caught up yet, so the sprite must stay where it was dropped.
		act(() => {
			jest.advanceTimersByTime(PATCH_TIMEOUT_MS - 1);
		});
		expect(result.current.patch.mira).toBeDefined();

		act(() => {
			jest.advanceTimersByTime(2);
		});
		expect(result.current.patch).toEqual({});
	});

	it('does not let a previous write time out the gesture in flight', () => {
		const {result} = renderHook(() => useScenePatch());

		act(() => result.current.setPatch({mira: {at: {x: 0.5, y: -0.85}}}));
		act(() => result.current.holdPatch());

		// A second drag starts before the hold expires.
		act(() => {
			jest.advanceTimersByTime(PATCH_TIMEOUT_MS / 2);
			result.current.setPatch({mira: {at: {x: -0.5, y: -0.85}}});
		});
		act(() => {
			jest.advanceTimersByTime(PATCH_TIMEOUT_MS);
		});

		expect(result.current.patch.mira?.at?.x).toBe(-0.5);
	});
});
