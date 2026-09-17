import {extractSceneBlock} from '@sliders/scene-index';
import {
	BEAT_BODY_KEYS,
	BOX_KEYS,
	CAMERA_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	SAY_KEYS
} from '@sliders/scene-schema';
import {sceneHintContext} from '../use-scene-hints';

/**
 * Classifies the cursor in a passage where `|` marks it. The marker is stripped
 * before anything looks at the text, so it never reaches the YAML.
 */
function contextAt(passage: string) {
	const lines = passage.split('\n');
	const line = lines.findIndex(one => one.includes('|'));

	if (line === -1) {
		throw new Error('The test passage needs a | to mark the cursor.');
	}

	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	const block = extractSceneBlock(lines.join('\n'));

	if (!block) {
		// Deliberate in the "outside a scene block" cases.
		return undefined;
	}

	return sceneHintContext(
		lines,
		block.lineOffset,
		block.lineOffset + block.text.split('\n').length,
		{ch, line}
	);
}

describe('sceneHintContext()', () => {
	it('offers backgrounds after bg:', () => {
		expect(contextAt('[scene]\nbg: tav|')).toMatchObject({
			needsSpace: false,
			slot: {kind: 'bg'},
			typed: 'tav'
		});
	});

	it('offers backgrounds with nothing typed yet', () => {
		expect(contextAt('[scene]\nbg: |')).toMatchObject({
			slot: {kind: 'bg'},
			typed: ''
		});
	});

	it('brings its own space when the cursor is on the colon', () => {
		expect(contextAt('[scene]\nbg:|')).toMatchObject({
			needsSpace: true,
			slot: {kind: 'bg'}
		});
	});

	it('keeps a name with a slash in one piece', () => {
		expect(contextAt('[scene]\nbg: tavern/ni|')).toMatchObject({
			slot: {kind: 'bg'},
			typed: 'tavern/ni'
		});
	});

	it('offers characters for a key under cast:', () => {
		expect(contextAt('[scene]\ncast:\n  mi|')).toMatchObject({
			slot: {kind: 'cast'},
			typed: 'mi'
		});
	});

	it('offers assets for a key under props:', () => {
		expect(contextAt('[scene]\nprops:\n  cand|')).toMatchObject({
			slot: {kind: 'props'},
			typed: 'cand'
		});
	});

	it('offers layers after layer:', () => {
		expect(
			contextAt('[scene]\nprops:\n  candle: {layer: fro|}')
		).toMatchObject({slot: {kind: 'layer'}, typed: 'fro'});
	});

	it('offers effects inside a flow sequence', () => {
		expect(contextAt('[scene]\nfx: [ra|]')).toMatchObject({
			needsSpace: false,
			slot: {kind: 'fx'},
			typed: 'ra'
		});
	});

	it('offers effects for a list item under fx:', () => {
		expect(contextAt('[scene]\nfx:\n  - ra|')).toMatchObject({
			slot: {kind: 'fx'},
			typed: 'ra'
		});
	});

	it('offers effects after a beat fx:', () => {
		expect(contextAt('[scene]\nbeats:\n  - fx: thun|')).toMatchObject({
			slot: {kind: 'fx'},
			typed: 'thun'
		});
	});

	describe('frames', () => {
		it('names the entity from a flow map on the same line', () => {
			expect(
				contextAt('[scene]\ncast:\n  mira: {at: -0.4, frame: ar|}')
			).toMatchObject({slot: {entity: 'mira', kind: 'frame'}, typed: 'ar'});
		});

		it('names the entity from the enclosing key in block form', () => {
			expect(
				contextAt('[scene]\ncast:\n  mira:\n    frame: ar|')
			).toMatchObject({slot: {entity: 'mira', kind: 'frame'}});
		});

		it('names the entity from a beat', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: {frame: ang|, say: "hi"}')
			).toMatchObject({slot: {entity: 'mira', kind: 'frame'}, typed: 'ang'});
		});
	});

	describe('ref:', () => {
		it('offers characters two levels below cast:', () => {
			expect(
				contextAt('[scene]\ncast:\n  villager:\n    ref: mi|')
			).toMatchObject({slot: {kind: 'cast'}, typed: 'mi'});
		});

		it('offers assets under props:', () => {
			expect(
				contextAt('[scene]\nprops:\n  lamp: {ref: cand|}')
			).toMatchObject({slot: {kind: 'props'}});
		});
	});

	describe('links:', () => {
		it('offers passages after a link name in block form', () => {
			expect(contextAt('[scene]\nlinks:\n  back: |')).toMatchObject({
				slot: {kind: 'passage'},
				typed: ''
			});
		});

		it('brings its own space when the cursor is on the link name colon', () => {
			expect(contextAt('[scene]\nlinks:\n  back:|')).toMatchObject({
				needsSpace: true,
				slot: {kind: 'passage'}
			});
		});

		it('offers passages after a link name in flow form', () => {
			expect(contextAt('[scene]\nlinks: {stay: Street, back: Tav|}')).toMatchObject({
				slot: {kind: 'passage'},
				typed: 'Tav'
			});
		});

		it('still offers passages after to:', () => {
			expect(contextAt('[scene]\nlinks:\n  back:\n    to: Tav|')).toMatchObject({
				slot: {kind: 'passage'},
				typed: 'Tav'
			});
		});
	});

	describe('staying quiet', () => {
		it('says nothing outside a scene block', () => {
			expect(contextAt('Just some prose |here.')).toBeUndefined();
		});

		it('says nothing after the scene block ends', () => {
			expect(
				contextAt('[scene]\nbg: tavern\n\n[note]\nDirector: |cornered.')
			).toBeUndefined();
		});

		it('says nothing for a key it has no names for', () => {
			expect(contextAt('[scene]\nid: tavern-nig|')).toBeUndefined();
		});

		it('says nothing in beat text', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: "she looked up, |slowly"')
			).toBeUndefined();
		});

		it('says nothing for a link name, which is the author\'s own', () => {
			expect(contextAt('[scene]\nlinks: {st|')).toBeUndefined();
		});
	});

	describe('keys', () => {
		it('offers the top-level keys for a key being typed', () => {
			expect(contextAt('[scene]\ncam|')).toMatchObject({
				slot: {id: 'top', kind: 'keys'},
				typed: 'cam'
			});
		});

		it('offers entity keys inside a flow entity', () => {
			expect(contextAt('[scene]\ncast:\n  mira: {|}')).toMatchObject({
				slot: {id: 'entity', kind: 'keys', names: ENTITY_KEYS}
			});
		});

		it('offers entity keys after a comma in a flow entity', () => {
			expect(contextAt('[scene]\ncast:\n  mira: {at: 0, fl|}')).toMatchObject({
				slot: {id: 'entity', kind: 'keys'},
				typed: 'fl'
			});
		});

		it('offers entity keys in block form too', () => {
			expect(contextAt('[scene]\ncast:\n  mira:\n    |')).toMatchObject({
				slot: {id: 'entity', kind: 'keys'}
			});
		});

		it('lets a beat say as well as move', () => {
			expect(contextAt('[scene]\nbeats:\n  - mira: {|}')).toMatchObject({
				slot: {
					id: 'beat',
					kind: 'keys',
					names: [...ENTITY_KEYS, ...SAY_KEYS, ...BEAT_BODY_KEYS]
				}
			});
		});

		it('offers bubble keys inside a nested bubble', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: {say: "hi", bubble: {pl|}}')
			).toMatchObject({slot: {id: 'bubble', kind: 'keys'}, typed: 'pl'});
		});

		it('offers camera keys', () => {
			expect(contextAt('[scene]\ncamera: {zo|}')).toMatchObject({
				slot: {id: 'camera', kind: 'keys', names: CAMERA_KEYS}
			});
		});

		it('offers box keys', () => {
			expect(contextAt('[scene]\nbeats:\n  - box: {t|}')).toMatchObject({
				slot: {id: 'box', kind: 'keys', names: BOX_KEYS}
			});
		});

		it('offers link keys under a link name', () => {
			expect(contextAt('[scene]\nlinks: {stay: {t|}}')).toMatchObject({
				slot: {id: 'link', kind: 'keys', names: LINK_KEYS}
			});
		});

		it('still reads a value after a key in the same flow map', () => {
			expect(contextAt('[scene]\ncast:\n  mira: {frame: an|}')).toMatchObject({
				slot: {entity: 'mira', kind: 'frame'}
			});
		});

		it('leaves a brace in beat text alone', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: "worth {|"')
			).toBeUndefined();
		});
	});
});

describe('beat completions', () => {
	const block = [
		'[scene]',
		'cast:',
		'  mira: {at: -0.4}',
		'  joren: {at: 0.3}',
		'beats:',
		'  - '
	];

	it('offers the scene cast for a beat key', () => {
		const context = sceneHintContext(block, 0, block.length, {
			ch: 4,
			line: 5
		});

		expect(context?.slot).toEqual({kind: 'speaker'});
		expect(context?.scaffold).toBe(true);
	});

	it('offers styles after as:', () => {
		const lines = [...block.slice(0, 5), '  - mira: {say: "Hi", as: '];

		expect(
			sceneHintContext(lines, 0, lines.length, {ch: 26, line: 5})?.slot
		).toEqual({kind: 'style'});
	});

	it('offers places after place:', () => {
		const lines = [...block.slice(0, 5), '  - mira: {say: "Hi", bubble: {place: '];

		expect(
			sceneHintContext(lines, 0, lines.length, {ch: 38, line: 5})?.slot
		).toEqual({kind: 'place'});
	});
});
