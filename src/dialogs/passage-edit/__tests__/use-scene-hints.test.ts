import {extractSceneBlock} from '@sliders/scene-index';
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

		it('says nothing for a top-level key being typed', () => {
			expect(contextAt('[scene]\ncam|')).toBeUndefined();
		});

		it('says nothing inside an entity that has no known key yet', () => {
			expect(contextAt('[scene]\ncast:\n  mira: {|}')).toBeUndefined();
		});
	});
});
