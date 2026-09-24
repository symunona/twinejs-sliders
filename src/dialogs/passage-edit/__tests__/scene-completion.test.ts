import CodeMirror, {Editor, Position} from 'codemirror';
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

function character(id: string, poses: string[]): Character {
	return {
		poses: Object.fromEntries(
			poses.map(pose => [pose, {asset: `a_${id}-${pose}`}])
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
		// A character's own pose. Never offered as a standalone asset.
		asset('mira-angry', 'frame', 'mira')
	],
	characters: [
		character('mira', ['idle', 'angry', 'arms-crossed']),
		character('joren', ['idle'])
	]
};

const PASSAGES = ['Street', 'Tavern Fight', 'Cellar'];
/** What `from:` can name: a scene id where there is one, else the passage name. */
const TEMPLATES = ['tavern-night', 'Cellar', 'official-landing-template'];

/** Drives the completion with `|` marking the cursor, as the classifier tests do. */
function completeAt(
	passage: string,
	lib: Library = library,
	passages: string[] = PASSAGES,
	templates: string[] = TEMPLATES
) {
	const lines = passage.split('\n');
	const line = lines.findIndex(one => one.includes('|'));
	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	const editor = {
		getCursor: () => ({ch, line}),
		getValue: () => lines.join('\n')
	} as unknown as Editor;

	return sceneCompletion(editor, lib, passages, templates);
}

/** Just the names, in the order they'd appear in the dropdown. */
function names(passage: string, lib?: Library) {
	return completeAt(passage, lib)?.list.map(one => one.displayText);
}

/**
 * An editor that only remembers what was written to it.
 *
 * A `hint` callback is the half of a completion that `text` cannot show: multi-line writes
 * and where the cursor lands afterwards both happen here and nowhere else, and neither is
 * worth mounting a real CodeMirror for.
 */
function recordingEditor() {
	const replaced: {from: Position; text: string; to: Position}[] = [];
	const selected: {from: Position; to: Position}[] = [];

	return {
		cm: {
			replaceRange: (text: string, from: Position, to: Position) =>
				replaced.push({from, text, to}),
			setSelection: (from: Position, to: Position) =>
				selected.push({from, to})
		} as unknown as Editor,
		replaced,
		selected
	};
}

/**
 * The `pick` listener `sceneCompletion` put on a completion, ready to call.
 *
 * `CodeMirror.on` is a bare `jest.fn` in the mock, so a listener registered through it is
 * never fired -- but it is recorded, which is enough to drive it by hand.
 */
function pickHandlerOf(completion: object) {
	const calls = (CodeMirror.on as jest.Mock).mock.calls;
	const registered = calls.find(
		([target, event]) => target === completion && event === 'pick'
	);

	if (!registered) {
		throw new Error('sceneCompletion() registered no pick listener');
	}

	return registered[2] as (picked: {displayText: string}) => void;
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

	it('offers objects first under props:, behind the plane snippet', () => {
		expect(names('[scene]\nprops:\n  |')).toEqual([
			'plane {fit: cover}',
			'candle',
			'table',
			'street',
			'tavern-night'
		]);
	});

	it('never offers a character pose as a standalone asset', () => {
		expect(names('[scene]\nbg: |')).not.toContain('mira-angry');
	});

	it('filters by what has been typed, anywhere in the name', () => {
		expect(names('[scene]\nbg: ern|')).toEqual(['tavern-night']);
	});

	it('offers character ids under cast:', () => {
		expect(names('[scene]\ncast:\n  |')).toEqual(['joren', 'mira']);
	});

	it("offers an entity's own poses", () => {
		expect(names('[scene]\ncast:\n  mira: {pose: |}')).toEqual([
			'angry',
			'arms-crossed',
			'idle'
		]);
	});

	it('follows ref: when the entity id is not the character id', () => {
		expect(
			names('[scene]\ncast:\n  stranger: {ref: mira, pose: |}')
		).toEqual(['angry', 'arms-crossed', 'idle']);
	});

	it('offers nothing for an entity that names no known character', () => {
		expect(names('[scene]\ncast:\n  nobody: {pose: |}')).toBeUndefined();
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

		it('keeps each character its own pose history', () => {
			noteNameUsed('pose:mira', 'angry');

			expect(names('[scene]\ncast:\n  mira: {pose: |}')).toEqual([
				'angry',
				'arms-crossed',
				'idle'
			]);
			expect(names('[scene]\ncast:\n  joren: {pose: |}')).toEqual(['idle']);
		});
	});

	describe('prefilling a new entity', () => {
		it('writes at out for a character', () => {
			expect(completeAt('[scene]\ncast:\n  mir|')!.list[0]).toMatchObject({
				displayText: 'mira',
				text: 'mira: {at: 0}'
			});
		});

		it('writes at out for a prop', () => {
			expect(completeAt('[scene]\nprops:\n  cand|')!.list[0]).toMatchObject({
				displayText: 'candle',
				text: 'candle: {at: 0}'
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

		it('does not prefill a pose, layer or effect', () => {
			expect(completeAt('[scene]\nfx:\n  - ra|')!.list[0]).toMatchObject({
				text: 'rain'
			});
			expect(
				completeAt('[scene]\ncast:\n  mira: {pose: ang|}')!.list[0]
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
			expect(range('[scene]\ncast:\n  mira: {pose: an|gry, layer: mid}')).toEqual(
				[15, 20]
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

	describe('the plane snippet', () => {
		it('is pinned above the names, and only under props:', () => {
			expect(names('[scene]\nprops:\n  |')![0]).toBe('plane {fit: cover}');
			expect(names('[scene]\ncast:\n  |')).not.toContain('plane {fit: cover}');
			expect(names('[scene]\nbg: |')).not.toContain('plane {fit: cover}');
		});

		it('is offered when the library has nothing to put on stage', () => {
			// The one moment an author is most likely to be asking what goes here.
			expect(names('[scene]\nprops:\n  |', {all: [], characters: []})).toEqual([
				'plane {fit: cover}'
			]);
		});

		it('narrows to it on plane, fit or cover alike', () => {
			for (const typed of ['plane', 'fit', 'cover']) {
				expect(names(`[scene]\nprops:\n  ${typed}|`)).toContain(
					'plane {fit: cover}'
				);
			}
		});

		it('is gone once the name has a body after it', () => {
			// `pl` here is an id being renamed, and the line has no room for a second body.
			expect(names('[scene]\nprops:\n  pl|: {at: 0}')).not.toContain(
				'plane {fit: cover}'
			);
		});

		it('writes the entity line and selects the placeholder id', () => {
			const completion = completeAt('[scene]\nprops:\n  |')!;
			const editor = recordingEditor();

			completion.list[0].hint!(editor.cm, completion, completion);

			expect(editor.replaced).toEqual([
				{from: {ch: 2, line: 2}, text: 'name: {fit: cover}', to: {ch: 2, line: 2}}
			]);
			expect(editor.selected).toEqual([
				{from: {ch: 2, line: 2}, to: {ch: 6, line: 2}}
			]);
		});

		it('writes no z: -- the parser seeds one and the useful value is unguessable', () => {
			expect(completeAt('[scene]\nprops:\n  |')!.list[0].text).toBe(
				'name: {fit: cover}'
			);
		});

		it('is not remembered as a recently used name', () => {
			const completion = completeAt('[scene]\nprops:\n  |')!;

			// The mocked CodeMirror registers listeners and fires nothing, so the handler
			// is called the way show-hint would call it: off the registration itself.
			pickHandlerOf(completion)(completion.list[0]);

			expect(names('[scene]\nprops:\n  |')).toEqual([
				'plane {fit: cover}',
				'candle',
				'table',
				'street',
				'tavern-night'
			]);
		});
	});

	describe('picking props from the scene key list', () => {
		it('writes the block and its first member, two lines', () => {
			expect(
				completeAt('[scene]\npro|')!.list.find(
					one => one.displayText === 'props'
				)!.text
			).toBe('props:\n  name: {fit: cover}');
		});

		it('selects the placeholder id on the second line', () => {
			const completion = completeAt('[scene]\npro|')!;
			const picked = completion.list.find(one => one.displayText === 'props')!;
			const editor = recordingEditor();

			picked.hint!(editor.cm, completion, completion);

			expect(editor.replaced).toEqual([
				{
					from: {ch: 0, line: 1},
					text: 'props:\n  name: {fit: cover}',
					to: {ch: 3, line: 1}
				}
			]);
			expect(editor.selected).toEqual([
				{from: {ch: 2, line: 2}, to: {ch: 6, line: 2}}
			]);
		});

		it('indents the member from the key, not from column zero', () => {
			// A scene block written inside something else still puts its member one level
			// in from `props:` rather than two spaces from the margin.
			expect(
				completeAt('[scene]\n    pro|')!.list.find(
					one => one.displayText === 'props'
				)!.text
			).toBe('props:\n      name: {fit: cover}');
		});

		it('leaves every other key half a line', () => {
			const list = completeAt('[scene]\n|')!.list;

			expect(list.find(one => one.displayText === 'cast')!.text).toBe('cast: ');
			expect(list.find(one => one.displayText === 'bg')!.text).toBe('bg: ');
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

	describe('link names', () => {
		it('offers every passage on an empty line under links:', () => {
			expect(names('[scene]\nlinks:\n  |')).toEqual([
				'Cellar',
				'Street',
				'Tavern Fight'
			]);
		});

		it('writes the whole entry, label and target', () => {
			expect(
				completeAt('[scene]\nlinks:\n  |')!.list.find(
					one => one.displayText === 'Tavern Fight'
				)!.text
			).toBe('Tavern Fight: Tavern Fight');
		});

		it('writes an entry for a name being typed over', () => {
			expect(completeAt('[scene]\nlinks:\n  Cel|')!.list[0]).toMatchObject({
				displayText: 'Cellar',
				text: 'Cellar: Cellar'
			});
		});

		it('writes an entry in flow form, where the line is not empty', () => {
			expect(
				completeAt('[scene]\nlinks: {stay: Street, |}')!.list.find(
					one => one.displayText === 'Cellar'
				)!.text
			).toBe('Cellar: Cellar');
		});

		it('opens the map when links: is the key being given a value', () => {
			expect(
				completeAt('[scene]\nlinks: |')!.list.find(
					one => one.displayText === 'Street'
				)!.text
			).toBe('{Street: Street}');
		});

		it('brings its own space when the cursor is on the links: colon', () => {
			expect(
				completeAt('[scene]\nlinks:|')!.list.find(
					one => one.displayText === 'Street'
				)!.text
			).toBe(' {Street: Street}');
		});

		it('leaves the cursor after the entry, with nothing selected', () => {
			expect(
				completeAt('[scene]\nlinks:\n  |')!.list.find(
					one => one.displayText === 'Street'
				)!.hint
			).toBeUndefined();
		});
	});
});

/**
 * `from:` had no completion at all, which is half of why a story ended up with
 * `from: official-landing-template` pointing at a passage the index could not reach.
 */
describe('from:', () => {
	it('offers every template the story has', () => {
		expect(names('[scene]\nfrom: |\n')).toEqual([
			'Cellar',
			'official-landing-template',
			'tavern-night'
		]);
	});

	it('narrows as the author types', () => {
		expect(names('[scene]\nfrom: off|\n')).toEqual(['official-landing-template']);
	});

	it('leaves out the scene’s own id — that would be a cycle', () => {
		expect(names('[scene]\nid: tavern-night\nfrom: |\n')).toEqual([
			'Cellar',
			'official-landing-template'
		]);
	});

	it('is a top-level key only, so a map offers nothing at all', () => {
		expect(names('[scene]\nbg: {id: x, from: |}\n')).toBeUndefined();
	});
});
