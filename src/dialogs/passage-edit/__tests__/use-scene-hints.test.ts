import {extractSceneBlock} from '@sliders/scene-index';
import {
	BEAT_BODY_KEYS,
	BG_KEYS,
	BOX_KEYS,
	CAMERA_KEYS,
	ENTITY_KEYS,
	LINK_KEYS,
	SAY_KEYS
} from '@sliders/scene-schema';
import {EASE_KINDS} from '@sliders/scene-types';
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

	it('offers the bg map keys inside bg: {', () => {
		expect(contextAt('[scene]\nbg: {|')).toMatchObject({
			slot: {id: 'bg', kind: 'keys', names: BG_KEYS}
		});
	});

	it('offers motions for fx: inside a bg map, not screen effects', () => {
		// The same key means two different things one level apart: `fx:` at the top of a
		// scene is a screen effect, inside `bg:` it is how the backdrop moves.
		expect(contextAt('[scene]\nbg: {id: hall, fx: par|}')).toMatchObject({
			slot: {kind: 'bgFx'}
		});
		expect(contextAt('[scene]\nfx: [ra|')).toMatchObject({slot: {kind: 'fx'}});
	});

	it('offers motions for a bg map written in block form', () => {
		expect(contextAt('[scene]\nbg:\n  id: hall\n  fx: |')).toMatchObject({
			slot: {kind: 'bgFx'}
		});
	});

	it('offers backgrounds for id: inside a bg map', () => {
		expect(contextAt('[scene]\nbg: {id: ha|}')).toMatchObject({
			slot: {kind: 'bg'}
		});
	});

	it('offers the bg map keys on a beat that cuts the backdrop', () => {
		expect(
			contextAt('[scene]\nbeats:\n  - bg: {|')
		).toMatchObject({slot: {id: 'bg', kind: 'keys', names: BG_KEYS}});
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

	/**
	 * `ease:` is the one key in the subset whose MAP is keyed by transition kinds, and four
	 * of those kinds (`bg`, `fx`, `frame`, `music`) are keys that mean something else one
	 * level out. So both sides have to ask who owns the line, not just what the key says.
	 */
	describe('ease:', () => {
		it('offers the preset names after ease:', () => {
			expect(contextAt('[scene]\nease: ba|')).toMatchObject({
				slot: {kind: 'ease'},
				typed: 'ba'
			});
		});

		it('offers them on a beat too', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: {at: 0.4, ease: |}')
			).toMatchObject({slot: {kind: 'ease'}});
		});

		it('offers the transition kinds in an ease map key position', () => {
			expect(contextAt('[scene]\nease: {|}')).toMatchObject({
				slot: {id: 'ease', kind: 'keys', names: EASE_KINDS}
			});
		});

		it('offers the kinds in a beat ease map too', () => {
			expect(
				contextAt('[scene]\nbeats:\n  - mira: {at: 0, ease: {mo|}}')
			).toMatchObject({slot: {id: 'ease', kind: 'keys'}, typed: 'mo'});
		});

		it('offers a CURVE after a kind whose name is a key elsewhere', () => {
			// Without the owner check this reads `bg:` and offers backdrop art, which is
			// the one wrong answer this slot can give.
			expect(contextAt('[scene]\nease: {bg: li|}')).toMatchObject({
				slot: {kind: 'ease'},
				typed: 'li'
			});
			expect(contextAt('[scene]\nease: {fx: |}')).toMatchObject({
				slot: {kind: 'ease'}
			});
			expect(contextAt('[scene]\nease: {music: |}')).toMatchObject({
				slot: {kind: 'ease'}
			});
		});

		it('still offers backdrop art for a real bg: one level out', () => {
			expect(contextAt('[scene]\nbg: ha|')).toMatchObject({slot: {kind: 'bg'}});
		});

		it('offers a curve on a frame step', () => {
			expect(
				contextAt('[scene]\ncast:\n  mira: {frame: [{name: a, ease: |}]}')
			).toMatchObject({slot: {kind: 'ease'}});
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

describe('keys offered to a line with no map in it yet', () => {
	/** The line as it stands after picking `name` from the dropdown. */
	function pick(passage: string, name: string) {
		const context = contextAt(passage);

		if (!context?.promote) {
			throw new Error('That cursor position offered no promotion.');
		}

		const {after, before, from, to} = context.promote;
		const line = passage
			.split('\n')
			.find(one => one.includes('|'))!
			.replace('|', '');

		return line.slice(0, from) + before + name + ': ' + after + line.slice(to);
	}

	it('offers a bare beat the keys it could take', () => {
		expect(contextAt('[scene]\nbeats:\n  - mira: "Hello."|')).toMatchObject({
			slot: {
				id: 'beat',
				kind: 'keys',
				names: [...ENTITY_KEYS, ...SAY_KEYS, ...BEAT_BODY_KEYS]
			},
			typed: ''
		});
	});

	it('rewrites a spoken beat into a map, keeping the line as the speech', () => {
		expect(pick('[scene]\nbeats:\n  - mira: "Hello."|', 'dur')).toBe(
			'  - mira: {say: "Hello.", dur: }'
		);
	});

	it('writes a map onto a beat that has no value yet', () => {
		expect(pick('[scene]\nbeats:\n  - mira:|', 'at')).toBe('  - mira: {at: }');
	});

	it('adds to a map the beat already has', () => {
		expect(pick('[scene]\nbeats:\n  - mira: {at: 0.3}|', 'dur')).toBe(
			'  - mira: {at: 0.3, dur: }'
		);
	});

	it('leaves an empty map alone rather than writing a stray comma', () => {
		expect(pick('[scene]\nbeats:\n  - mira: {}|', 'dur')).toBe(
			'  - mira: {dur: }'
		);
	});

	it('knows a box beat says its line under text:', () => {
		expect(contextAt('[scene]\nbeats:\n  - box: "The candle."|')).toMatchObject({
			slot: {id: 'box', kind: 'keys', names: BOX_KEYS}
		});
		expect(pick('[scene]\nbeats:\n  - box: "The candle."|', 'as')).toBe(
			'  - box: {text: "The candle.", as: }'
		);
	});

	it('says nothing on a command beat, which has no body to key', () => {
		expect(contextAt('[scene]\nbeats:\n  - wait: 1|')).toBeUndefined();
		expect(contextAt('[scene]\nbeats:\n  - mark: here|')).toBeUndefined();
	});

	it('extends an entity a cast entry already declares', () => {
		expect(contextAt('[scene]\ncast:\n  mira: {at: 0}|')).toMatchObject({
			slot: {id: 'entity', kind: 'keys', names: ENTITY_KEYS}
		});
	});

	it('says nothing with the cursor inside the value', () => {
		expect(
			contextAt('[scene]\nbeats:\n  - mira: "He|llo."')?.promote
		).toBeUndefined();
	});

	it('declines a value carrying a comment, which braces would swallow', () => {
		expect(contextAt('[scene]\nbeats:\n  - mira: "Hi" # later|')).toBeUndefined();
	});

	it('still completes a value that has names to offer', () => {
		expect(contextAt('[scene]\nbg: tav|')).toMatchObject({slot: {kind: 'bg'}});
		expect(contextAt('[scene]\nbeats:\n  - fx: rai|')).toMatchObject({
			slot: {kind: 'fx'}
		});
	});
});
