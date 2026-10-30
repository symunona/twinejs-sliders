import {act, renderHook} from '@testing-library/react-hooks';
import {extractSceneBlock} from '@sliders/scene-index';
import {resolveStage} from '@sliders/scene-core';
import type {Stage} from '@sliders/scene-types';
import {parseSceneText} from '../use-scene-parse';
import {buildWriteEdits, previewEdits} from '../use-scene-writer';
import {
	clipText,
	copyClip,
	heldClip,
	heldClipFor,
	holdClip,
	nextPasteOffset,
	PASTE_STEP,
	pasteWrites,
	readClip,
	resetHeldClip,
	SCENE_CLIP_MIME,
	SceneClip
} from '../scene-clipboard';
import {useSceneClipboard} from '../use-scene-clipboard';

const source = [
	'[scene]',
	'bg: tavern',
	'cast:',
	'  mira: {at: -0.4, pose: idle, flip: true, locked: true}',
	'props:',
	'  table: {at: 0.3}',
	'  cup: {of: table, at: [0, 0.2]}',
	'  fire: {at: 0.6, scale: 0.5, emit: {rate: 5}}',
	'beats:',
	'  - mira: {at: 0.1}',
	'  - mira: "Hello."'
].join('\n');

/** Only a backdrop: no `cast:`, no `props:` yet. */
const empty = ['[scene]', 'bg: cellar', 'beats:', '  - box: "Dark."'].join(
	'\n'
);

function parsed(text: string) {
	const parse = parseSceneText(text);

	if (!parse.result) {
		throw new Error('no parse result');
	}

	return parse;
}

function stageAt(text: string, beat: number): Stage {
	return parsed(text).states[beat];
}

function copy(ids: string[], beat = 0, passageId = 'p1') {
	const authored = stageAt(source, beat);

	return copyClip(
		authored,
		resolveStage(authored),
		ids,
		parsed(source).result!.scene,
		{passageId, storyId: 's1'}
	)!;
}

/** Applies a paste to `text`, returns the new passage text. */
function paste(text: string, clip: SceneClip, offset = 0) {
	const parse = parsed(text);
	const block = extractSceneBlock(text)!;
	const taken = Object.keys(parse.states[0].entities);
	const {ids, writes} = pasteWrites(clip, taken, offset);
	const context = {
		beat: 0,
		blockOffset: block.offset,
		blockText: block.text,
		scene: parse.result!.scene
	};
	const blockText = previewEdits(block.text, buildWriteEdits(context, writes));

	return {
		ids,
		text:
			text.slice(0, block.offset) +
			blockText +
			text.slice(block.offset + block.text.length)
	};
}

afterEach(() => resetHeldClip());

describe('copyClip', () => {
	it('copies the entity as seen at the beat, not its entry', () => {
		const clip = copy(['mira'], 1);

		expect(clip.entities).toHaveLength(1);
		expect(clip.entities[0].patch).toMatchObject({
			at: {x: 0.1},
			flip: true,
			kind: 'cast',
			pose: 'idle',
			ref: 'mira'
		});
	});

	it('leaves locked behind', () => {
		expect(copy(['mira']).entities[0].patch).not.toHaveProperty('locked');
	});

	it('pins a child whose parent stays behind, keeps the offset when it travels', () => {
		const alone = copy(['cup']).entities[0].patch;

		expect(alone).not.toHaveProperty('of');
		expect(alone.at).toEqual({x: 0.3, y: expect.any(Number)});

		const both = copy(['cup', 'table']);

		expect(both.entities.map(entry => entry.id)).toEqual(['table', 'cup']);
		expect(both.entities[1].patch).toMatchObject({
			at: {x: 0, y: 0.2},
			of: 'table'
		});
	});

	it('is undefined with nothing on stage selected', () => {
		expect(copy([])).toBeUndefined();
		expect(copy(['nobody'])).toBeUndefined();
	});
});

describe('pasteWrites', () => {
	it('mints fresh ids, offsets roots, remaps of', () => {
		const {ids, writes} = pasteWrites(
			copy(['table', 'cup']),
			['table', 'cup', 'mira'],
			PASTE_STEP
		);

		expect(ids).toEqual(['table-2', 'cup-2']);
		expect(writes[0].patch!.at).toEqual({x: 0.35, y: expect.any(Number)});
		expect(writes[1].patch).toMatchObject({at: {x: 0, y: 0.2}, of: 'table-2'});
	});

	it('round-trips: a paste back into its scene parses, copies on stage', () => {
		const result = paste(
			source,
			copy(['mira', 'fire', 'table', 'cup']),
			PASTE_STEP
		);
		const stage = resolveStage(stageAt(result.text, 0));

		expect(parsed(result.text).result!.errors).toEqual([]);
		expect(result.ids).toEqual(['mira-2', 'fire-2', 'table-2', 'cup-2']);
		expect(stage.entities['mira-2']).toMatchObject({flip: true, ref: 'mira'});
		expect(stage.entities['mira-2'].at.x).toBeCloseTo(-0.35);
		expect(stage.entities['fire-2']).toMatchObject({
			emit: {rate: 5},
			scale: 0.5
		});
		expect(stage.entities['cup-2'].at.x).toBeCloseTo(0.35);
		// The originals are untouched.
		expect(stage.entities.mira.at.x).toBeCloseTo(-0.4);
	});

	it('writes several props into a scene with no props map yet, one key', () => {
		const result = paste(empty, copy(['table', 'fire']));

		expect(result.text.match(/^props:/gm)).toHaveLength(1);
		expect(Object.keys(stageAt(result.text, 0).entities).sort()).toEqual([
			'fire',
			'table'
		]);
	});

	it('keeps a step list', () => {
		const stepped = [
			'[scene]',
			'cast:',
			'  mira: {at: 0, pose: [{name: a, dur: 0.2}, {name: b, at: [0.1, -0.5]}]}'
		].join('\n');
		const authored = stageAt(stepped, 0);
		const clip = copyClip(authored, resolveStage(authored), ['mira'])!;
		const result = paste(empty, clip);
		const mira = stageAt(result.text, 0).entities.mira;

		expect(parsed(result.text).result!.errors).toEqual([]);
		expect(mira.steps?.map(step => step.name)).toEqual(['a', 'b']);
		expect(mira.steps?.[1].at).toEqual({x: 0.1, y: -0.5});
	});
});

describe('clip text and clipboard payload', () => {
	it('is scene YAML', () => {
		const text = clipText(copy(['mira', 'table']));

		expect(text).toMatch(/^cast:\n {2}mira: \{at: -0\.4/);
		expect(text).toMatch(/\nprops:\n {2}table: \{at: 0\.3\}/);
	});

	it('reads back its own JSON and refuses anything else', () => {
		const clip = copy(['mira']);

		expect(readClip(JSON.stringify(clip))).toEqual(clip);
		expect(readClip('')).toBeUndefined();
		expect(readClip('not json')).toBeUndefined();
		expect(readClip('{"v":1,"entities":[]}')).toBeUndefined();
		expect(
			readClip('{"v":1,"entities":[{"id":"x","kind":"cast","patch":{}}]}')
		).toBeUndefined();
	});

	it('the held clip answers only its own text', () => {
		const clip = copy(['mira']);
		const text = holdClip(clip);

		expect(heldClip()).toBe(clip);
		expect(heldClipFor(text)).toBe(clip);
		expect(heldClipFor('something else')).toBeUndefined();
	});

	it('steps each paste into the source scene; another scene starts in place', () => {
		const clip = copy(['mira'], 0, 'p1');

		holdClip(clip);
		expect(nextPasteOffset(clip, 'p1')).toBeCloseTo(PASTE_STEP);
		expect(nextPasteOffset(clip, 'p1')).toBeCloseTo(2 * PASTE_STEP);
		expect(nextPasteOffset(clip, 'p2')).toBe(0);
		expect(nextPasteOffset(clip, 'p2')).toBeCloseTo(PASTE_STEP);
	});
});

describe('useSceneClipboard', () => {
	function clipboardEvent(
		type: 'copy' | 'paste',
		data: Record<string, string> = {}
	) {
		const store = {...data};
		const event = new Event(type, {
			bubbles: true,
			cancelable: true
		}) as ClipboardEvent;

		Object.defineProperty(event, 'clipboardData', {
			value: {
				getData: (key: string) => store[key] ?? '',
				setData: (key: string, value: string) => (store[key] = value)
			}
		});

		return {event, store};
	}

	function setup() {
		const stage = document.createElement('div');
		const input = document.createElement('input');

		stage.tabIndex = 0;
		stage.append(input);
		document.body.append(stage);

		const clip = copy(['mira']);
		const onPaste = jest.fn();
		const hook = renderHook(() =>
			useSceneClipboard({
				copy: () => clip,
				owns: target => stage.contains(target),
				paste: onPaste
			})
		);

		mounted.push(hook.unmount);

		return {clip, hook, input, onPaste, stage};
	}

	const mounted: (() => void)[] = [];

	afterEach(() => {
		mounted.splice(0).forEach(unmount => unmount());
		document.body.innerHTML = '';
	});

	it('copy on the stage writes the clip and its YAML', () => {
		const {clip, stage} = setup();
		const {event, store} = clipboardEvent('copy');

		act(() => {
			stage.dispatchEvent(event);
		});
		expect(event.defaultPrevented).toBe(true);
		expect(readClip(store[SCENE_CLIP_MIME])).toEqual(clip);
		expect(store['text/plain']).toBe(clipText(clip));
	});

	it('leaves copy and paste alone in a text field', () => {
		const {input, onPaste, clip} = setup();
		const copied = clipboardEvent('copy');
		const pasted = clipboardEvent('paste', {
			[SCENE_CLIP_MIME]: JSON.stringify(clip)
		});

		act(() => {
			input.dispatchEvent(copied.event);
		});
		input.dispatchEvent(pasted.event);
		expect(copied.event.defaultPrevented).toBe(false);
		expect(pasted.event.defaultPrevented).toBe(false);
		expect(onPaste).not.toHaveBeenCalled();
	});

	it('pastes a clip, or the held one when only its text survived', () => {
		const {clip, onPaste, stage} = setup();
		const custom = clipboardEvent('paste', {
			[SCENE_CLIP_MIME]: JSON.stringify(clip)
		});

		stage.dispatchEvent(custom.event);
		expect(onPaste).toHaveBeenLastCalledWith(clip);

		let text = '';

		act(() => {
			text = holdClip(clip);
		});
		const plain = clipboardEvent('paste', {'text/plain': text});

		stage.dispatchEvent(plain.event);
		expect(plain.event.defaultPrevented).toBe(true);
		expect(onPaste).toHaveBeenCalledTimes(2);
	});

	it('lets any other paste through (an image, foreign text)', () => {
		const {clip, onPaste, stage} = setup();

		act(() => {
			holdClip(clip);
		});

		const other = clipboardEvent('paste', {'text/plain': 'hello'});

		stage.dispatchEvent(other.event);
		expect(other.event.defaultPrevented).toBe(false);
		expect(onPaste).not.toHaveBeenCalled();
	});

	it('reports whether something is held', () => {
		const {clip, hook} = setup();

		expect(hook.result.current.held).toBe(false);
		act(() => {
			holdClip(clip);
		});
		expect(hook.result.current.held).toBe(true);
	});
});
