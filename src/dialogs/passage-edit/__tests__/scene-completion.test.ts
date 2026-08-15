import {Editor} from 'codemirror';
import {AssetMeta, Character} from '@sliders/scene-types';
import {AssetLibrary} from '../../sliders-assets/asset-store-context';
import {sceneCompletion} from '../use-scene-hints';
import {
	noteNameUsed,
	resetRecentNamesCache
} from '../../../util/sliders-recent-names';

function asset(
	name: string,
	kind: AssetMeta['kind'],
	ownerCharacter?: string
): AssetMeta {
	return {
		animated: false,
		bytes: 1,
		h: 10,
		hash: name,
		id: `a_${name}`,
		kind,
		mime: 'image/webp',
		name,
		ownerCharacter,
		tags: [],
		w: 10
	};
}

function character(id: string, frames: string[]): Character {
	return {
		anchors: {},
		frames: Object.fromEntries(
			frames.map(frame => [frame, {asset: `a_${id}-${frame}`}])
		),
		id,
		name: id,
		origin: {x: 0.5, y: 1},
		size: {h: 10, w: 10},
		tags: []
	};
}

type Library = Pick<AssetLibrary, 'all' | 'characters'>;

const library: Library = {
	all: [
		asset('tavern-night', 'bg'),
		asset('street', 'bg'),
		asset('candle', 'object'),
		asset('table', 'object'),
		// A character's own frame. Never offered as a standalone asset.
		asset('mira-angry', 'frame', 'mira')
	],
	characters: [
		character('mira', ['idle', 'angry', 'arms-crossed']),
		character('joren', ['idle'])
	]
};

/** Drives the completion with `|` marking the cursor, as the classifier tests do. */
function completeAt(passage: string, lib: Library = library) {
	const lines = passage.split('\n');
	const line = lines.findIndex(one => one.includes('|'));
	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	const editor = {
		getCursor: () => ({ch, line}),
		getValue: () => lines.join('\n')
	} as unknown as Editor;

	return sceneCompletion(editor, lib);
}

/** Just the names, in the order they'd appear in the dropdown. */
function names(passage: string, lib?: Library) {
	return completeAt(passage, lib)?.list.map(one => one.displayText);
}

describe('sceneCompletion()', () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetRecentNamesCache();
	});

	it('offers backgrounds first after bg:', () => {
		expect(names('[scene]\nbg: |')).toEqual([
			'street',
			'tavern-night',
			'candle',
			'table'
		]);
	});

	it('offers objects first under props:', () => {
		expect(names('[scene]\nprops:\n  |')).toEqual([
			'candle',
			'table',
			'street',
			'tavern-night'
		]);
	});

	it('never offers a character frame as a standalone asset', () => {
		expect(names('[scene]\nbg: |')).not.toContain('mira-angry');
	});

	it('filters by what has been typed, anywhere in the name', () => {
		expect(names('[scene]\nbg: ern|')).toEqual(['tavern-night']);
	});

	it('offers character ids under cast:', () => {
		expect(names('[scene]\ncast:\n  |')).toEqual(['joren', 'mira']);
	});

	it("offers an entity's own frames", () => {
		expect(names('[scene]\ncast:\n  mira: {frame: |}')).toEqual([
			'angry',
			'arms-crossed',
			'idle'
		]);
	});

	it('follows ref: when the entity id is not the character id', () => {
		expect(
			names('[scene]\ncast:\n  stranger: {ref: mira, frame: |}')
		).toEqual(['angry', 'arms-crossed', 'idle']);
	});

	it('offers nothing for an entity that names no known character', () => {
		expect(names('[scene]\ncast:\n  nobody: {frame: |}')).toBeUndefined();
	});

	it('offers the fixed layers and effects', () => {
		expect(names('[scene]\ncast:\n  mira: {layer: |}')).toEqual([
			'back',
			'mid',
			'front'
		]);
		expect(names('[scene]\nfx: [|]')).toEqual([
			'cold',
			'dark',
			'flash',
			'rain',
			'warm'
		]);
	});

	it('offers nothing when the library is empty', () => {
		expect(
			names('[scene]\nbg: |', {all: [], characters: []})
		).toBeUndefined();
	});

	describe('recently used names', () => {
		it('lifts them to the top and marks them', () => {
			noteNameUsed('bg', 'candle');
			noteNameUsed('bg', 'tavern-night');

			const list = completeAt('[scene]\nbg: |')!.list;

			expect(list.map(one => one.displayText)).toEqual([
				'tavern-night',
				'candle',
				'street',
				'table'
			]);
			expect(list.map(one => one.className)).toEqual([
				'sliders-hint-recent',
				'sliders-hint-recent',
				undefined,
				undefined
			]);
		});

		it('keeps each character its own frame history', () => {
			noteNameUsed('frame:mira', 'angry');

			expect(names('[scene]\ncast:\n  mira: {frame: |}')).toEqual([
				'angry',
				'arms-crossed',
				'idle'
			]);
			expect(names('[scene]\ncast:\n  joren: {frame: |}')).toEqual(['idle']);
		});
	});

	describe('what lands in the document', () => {
		it('inserts the name as typed when there is already a space', () => {
			expect(completeAt('[scene]\nbg: str|')!.list[0]).toMatchObject({
				displayText: 'street',
				text: 'street'
			});
		});

		it('adds the space YAML needs when the cursor is on the colon', () => {
			expect(completeAt('[scene]\nbg:|')!.list[0]).toMatchObject({
				displayText: 'street',
				text: ' street'
			});
		});

		it('replaces only the token, not the whole line', () => {
			const completion = completeAt('[scene]\nbg: str|')!;

			expect(completion.from).toEqual({ch: 4, line: 1});
			expect(completion.to).toEqual({ch: 7, line: 1});
		});
	});
});
