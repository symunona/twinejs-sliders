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

const PASSAGES = ['Street', 'Tavern Fight', 'Cellar'];

/** Drives the completion with `|` marking the cursor, as the classifier tests do. */
function completeAt(
	passage: string,
	lib: Library = library,
	passages: string[] = PASSAGES
) {
	const lines = passage.split('\n');
	const line = lines.findIndex(one => one.includes('|'));
	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	const editor = {
		getCursor: () => ({ch, line}),
		getValue: () => lines.join('\n')
	} as unknown as Editor;

	return sceneCompletion(editor, lib, passages);
}

/** Just the names, in the order they'd appear in the dropdown. */
function names(passage: string, lib?: Library) {
	return completeAt(passage, lib)?.list.map(one => one.displayText);
}

/** The range a pick would overwrite, on the line the cursor is on. */
function range(passage: string) {
	const completion = completeAt(passage)!;

	return [completion.from.ch, completion.to.ch];
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

	describe('prefilling a new entity', () => {
		it('writes at and layer out for a character', () => {
			expect(completeAt('[scene]\ncast:\n  mir|')!.list[0]).toMatchObject({
				displayText: 'mira',
				text: 'mira: {at: 0, layer: mid}'
			});
		});

		it('writes at and layer out for a prop', () => {
			expect(completeAt('[scene]\nprops:\n  cand|')!.list[0]).toMatchObject({
				displayText: 'candle',
				text: 'candle: {at: 0, layer: mid}'
			});
		});

		it('leaves ref: alone -- that wants the bare name', () => {
			expect(
				completeAt('[scene]\ncast:\n  stranger: {ref: mir|}')!.list[0]
			).toMatchObject({text: 'mira'});
		});

		it('leaves an entity that already has a body alone', () => {
			// Renaming the id in `mira: {at: -0.4}` must not append a second body.
			expect(
				completeAt('[scene]\ncast:\n  mir|: {at: -0.4}')!.list[0]
			).toMatchObject({text: 'mira'});
		});

		it('does not prefill a frame, layer or effect', () => {
			expect(completeAt('[scene]\nfx:\n  - ra|')!.list[0]).toMatchObject({
				text: 'rain'
			});
			expect(
				completeAt('[scene]\ncast:\n  mira: {frame: ang|}')!.list[0]
			).toMatchObject({text: 'angry'});
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
	describe('overwriting a name already written', () => {
		it('replaces the whole name from inside it', () => {
			// `bg: tavern-night`, cursor after `tav`.
			expect(range('[scene]\nbg: tav|ern-night')).toEqual([4, 16]);
		});

		it('replaces a name that has spaces in it', () => {
			expect(range('[scene]\nbg: oak ta|ble here')).toEqual([4, 18]);
		});

		it('stops at the YAML around it', () => {
			expect(range('[scene]\ncast:\n  mira: {frame: an|gry, layer: mid}')).toEqual(
				[16, 21]
			);
		});

		it('offers the whole list when the name is already complete', () => {
			// Asking for the list on a finished name means wanting a different one.
			expect(names('[scene]\nbg: street|')).toEqual([
				'street',
				'tavern-night',
				'candle',
				'table'
			]);
		});

		it('offers the whole list when the name matches nothing', () => {
			// A typo'd id is exactly when the author needs to see the options.
			expect(names('[scene]\nbg: zzz|')).toEqual([
				'street',
				'tavern-night',
				'candle',
				'table'
			]);
		});
	});

	describe('passages', () => {
		it('offers them after a link to:', () => {
			expect(names('[scene]\nlinks:\n  stay: {to: |}')).toEqual([
				'Cellar',
				'Street',
				'Tavern Fight'
			]);
		});

		it('offers them inside a link in beat text', () => {
			expect(
				names('[scene]\nbeats:\n  - mira: "Go [[out -> Cel|]]"')
			).toEqual(['Cellar']);
		});

		it('offers them inside a link in prose with no scene at all', () => {
			expect(names('Walk to [[Str|]].')).toEqual(['Street']);
		});

		it('overwrites a whole target, spaces and all', () => {
			expect(range('[scene]\nbeats:\n  - mira: "[[out -> Tavern Fi|ght]]"')).toEqual(
				[20, 32]
			);
		});

		it('closes a link the author left open', () => {
			expect(completeAt('Walk to [[Str|')!.list[0]).toMatchObject({
				displayText: 'Street',
				text: 'Street]]'
			});
		});

		it('says nothing for the label half of a link', () => {
			expect(names('[scene]\nbeats:\n  - mira: "[[ou|t -> Cellar]]"')).toBeUndefined();
		});

		it('says nothing past the end of a link', () => {
			expect(names('Walk to [[Street]] |now')).toBeUndefined();
		});
	});
});
