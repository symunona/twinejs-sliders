/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {extractSceneBlock} from '@sliders/scene-index';
import {parseScene} from '@sliders/scene-schema';
import type {SayBeat, SetBeat} from '@sliders/scene-types';
import {collectAssetRefs, collectPassageRefs} from '../collect-asset-refs';
import type {Passage, Story} from '../../../store/stories';

const TAVERN = `[scene]
id: tavern-night
bg: tavern/night
cast:
  mira: {at: -0.4, frame: arms-crossed}
props:
  candle: {at: 0.1, layer: front}
fx: [rain@0.6]
beats:
  - mira: {frame: angry, say: "Get out."}
  - fx: thunder
  - candle: {frame: guttering}
`;

const PROSE = `mood: tense
--
The door hangs open.

[scene]
bg: street/day
cast:
  joren: {at: 0.2}

[note]
Director: cold light. bg: not-an-asset

[continued]
More Chapbook markup, with a [[link->Elsewhere]].
`;

// Built by hand rather than with `fakeStory`, so this suite does not import the whole
// component tree behind src/test-util.
function passageOf(text: string, index: number): Passage {
	return {
		height: 100,
		highlighted: false,
		id: `p${index}`,
		left: 0,
		name: `Passage ${index}`,
		selected: false,
		story: 'story-1',
		tags: [],
		text,
		top: 0,
		width: 100
	};
}

function storyOf(texts: string[]): Story {
	return {
		id: 'story-1',
		ifid: 'CD3A7B4A-1BE4-4B87-B5F0-6C1C1C1C1C1C',
		lastUpdate: new Date(),
		name: 'Test Story',
		passages: texts.map(passageOf),
		script: '',
		selected: false,
		snapToGrid: false,
		startPassage: 'p0',
		storyFormat: 'Sliders',
		storyFormatVersion: '1.0.0',
		stylesheet: '',
		tagColors: {},
		tags: [],
		zoom: 1
	};
}

describe('collectPassageRefs', () => {
	// Guards against a vacuous suite: if a fixture stopped parsing, every expectation
	// below would be an empty-vs-empty comparison and still pass.
	describe('the fixtures parse as intended', () => {
		it('gives TAVERN its entities, fx and beats', () => {
			const block = extractSceneBlock(TAVERN);
			const {scene} = parseScene(block!.text);

			expect(scene.entities.mira).toMatchObject({
				frame: 'arms-crossed',
				kind: 'cast',
				ref: 'mira'
			});
			expect(scene.entities.candle).toMatchObject({
				kind: 'prop',
				ref: 'candle'
			});
			expect(scene.fx).toEqual([{amount: 0.6, id: 'rain'}]);
			expect(scene.beats.map(b => b.kind)).toEqual(['say', 'fx', 'set']);
			expect((scene.beats[0] as SayBeat).patch).toMatchObject({frame: 'angry'});
			expect((scene.beats[2] as SetBeat).who).toBe('candle');
		});

		it('gives PROSE only what is inside the block', () => {
			const block = extractSceneBlock(PROSE);
			const {scene} = parseScene(block!.text);

			expect(scene.bg).toBe('street/day');
			expect(Object.keys(scene.entities)).toEqual(['joren']);
		});
	});

	it('collects bg as an asset', () => {
		expect(collectPassageRefs('[scene]\nbg: tavern/night\n').assetRefs).toEqual(
			['tavern/night']
		);
	});

	it('collects a bare id: as an optional asset, not a required one', () => {
		const refs = collectPassageRefs('[scene]\nid: tavern/night\n');

		expect(refs.assetRefs).toEqual([]);
		expect(refs.optionalAssetRefs).toEqual(['tavern/night']);
	});

	it('keeps id: out of the refs once bg: names the backdrop', () => {
		const refs = collectPassageRefs('[scene]\nid: tavern-night\nbg: tavern/night\n');

		expect(refs.assetRefs).toEqual(['tavern/night']);
		expect(refs.optionalAssetRefs).toEqual([]);
	});

	it('collects a prop ref as an asset and a cast ref as a character', () => {
		const refs = collectPassageRefs(
			'[scene]\ncast:\n  mira: {at: 0}\nprops:\n  candle: {at: 0.1}\n'
		);

		expect(refs.assetRefs).toEqual(['candle']);
		expect(refs.characterRefs).toEqual(['mira']);
	});

	it('honours an explicit ref:, which need not match the entity id', () => {
		const refs = collectPassageRefs(
			'[scene]\ncast:\n  barkeep: {ref: joren, frame: idle}\n'
		);

		expect(refs.characterRefs).toEqual(['joren']);
		// The frame is keyed by the entity id, not by the character it points at.
		expect(refs.frameRefs).toEqual({barkeep: ['idle']});
	});

	it('collects a frame declared on an entity', () => {
		const refs = collectPassageRefs('[scene]\ncast:\n  mira: {frame: angry}\n');

		expect(refs.frameRefs).toEqual({mira: ['angry']});
	});

	it('collects fx from fx: and from an fx beat', () => {
		const refs = collectPassageRefs(
			'[scene]\nfx: [rain@0.6, {id: dust, amount: 0.2}]\nbeats:\n  - fx: thunder\n'
		);

		expect(refs.fxRefs).toEqual(['dust', 'rain', 'thunder']);
	});

	it('collects frame: from a say beat patch and from a set beat', () => {
		const refs = collectPassageRefs(
			'[scene]\nbeats:\n  - mira: {frame: angry, say: "Out."}\n  - joren: {frame: idle}\n'
		);

		expect(refs.frameRefs).toEqual({joren: ['idle'], mira: ['angry']});
	});

	it('sorts every bucket', () => {
		const refs = collectPassageRefs(TAVERN);

		expect(refs.assetRefs).toEqual(['candle', 'tavern/night']);
		expect(refs.characterRefs).toEqual(['mira']);
		expect(refs.fxRefs).toEqual(['rain', 'thunder']);
		expect(refs.frameRefs).toEqual({
			candle: ['guttering'],
			mira: ['angry', 'arms-crossed']
		});
	});

	it('returns nothing for a passage with no [scene] block', () => {
		const refs = collectPassageRefs('Just prose, and a [[link->Elsewhere]].\n');

		expect(refs).toEqual({
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: [],
			optionalAssetRefs: []
		});
	});

	it('ignores prose and other modifiers around the block', () => {
		const refs = collectPassageRefs(PROSE);

		expect(refs.assetRefs).toEqual(['street/day']);
		expect(refs.characterRefs).toEqual(['joren']);
	});

	it('skips bg: null, which means removed', () => {
		const {scene} = parseScene('from: other\nbg: ~\n');

		expect(scene.bg).toBeNull();
		expect(
			collectPassageRefs('[scene]\nfrom: other\nbg: ~\n').assetRefs
		).toEqual([]);
		expect(
			collectPassageRefs('[scene]\nid: x\nfrom: other\nbg: ~\n').optionalAssetRefs
		).toEqual([]);
	});

	it('skips a null entity, which means removed', () => {
		const refs = collectPassageRefs(
			'[scene]\nfrom: other\ncast:\n  mira: ~\n  joren: {at: 0}\n'
		);

		expect(refs.characterRefs).toEqual(['joren']);
	});

	it('skips a blank ref', () => {
		const refs = collectPassageRefs(
			'[scene]\nbg: "   "\ncast:\n  mira: {ref: ""}\n'
		);

		expect(refs.assetRefs).toEqual([]);
		expect(refs.characterRefs).toEqual([]);
	});

	it('keeps the refs of a passage whose YAML is malformed', () => {
		const text =
			'[scene]\nbg: tavern/night\ncast:\n  mira: {at: 0\nfx: [rain]\n';
		const {errors} = parseScene(extractSceneBlock(text)!.text);

		expect(errors.length).toBeGreaterThan(0);

		const refs = collectPassageRefs(text);

		expect(refs.assetRefs).toEqual(['tavern/night']);
		expect(refs.characterRefs).toEqual(['mira']);
		expect(refs.fxRefs).toEqual(['rain']);
	});
});

describe('collectAssetRefs', () => {
	it('unions and dedupes across passages, ignoring ones with no scene', () => {
		const story = storyOf([
			TAVERN,
			PROSE,
			'Only prose here.\n',
			'[scene]\nbg: tavern/night\ncast:\n  mira: {frame: smiling}\nfx: [rain]\n'
		]);
		const refs = collectAssetRefs(story);

		expect(refs.assetRefs).toEqual(['candle', 'street/day', 'tavern/night']);
		expect(refs.characterRefs).toEqual(['joren', 'mira']);
		expect(refs.fxRefs).toEqual(['rain', 'thunder']);
		expect(refs.frameRefs).toEqual({
			candle: ['guttering'],
			mira: ['angry', 'arms-crossed', 'smiling']
		});
	});

	it('files an entities: ref under autoRefs, not under one of the two guesses', () => {
		// The parser has no library, so it cannot say whether `mira` is a character or an
		// asset name. Filing it as either would report the other as missing.
		const refs = collectPassageRefs(
			'[scene]\nentities:\n  mira: {at: 0, frame: angry}\n  lamp: {at: 0.4}\n'
		);

		expect(refs.autoRefs).toEqual(['lamp', 'mira']);
		expect(refs.assetRefs).toEqual([]);
		expect(refs.characterRefs).toEqual([]);
		// A frame named on an auto entity is still a frame its character has to have.
		expect(refs.frameRefs).toEqual({mira: ['angry']});
	});

	it('keeps cast: and props: in their own buckets alongside it', () => {
		const refs = collectPassageRefs(
			'[scene]\ncast:\n  mira: {at: 0}\nprops:\n  candle: {at: 0.4}\nentities:\n  lamp: {at: 0.6}\n'
		);

		expect(refs.characterRefs).toEqual(['mira']);
		expect(refs.assetRefs).toEqual(['candle']);
		expect(refs.autoRefs).toEqual(['lamp']);
	});

	it('returns empty buckets for a story with no scenes', () => {
		expect(collectAssetRefs(storyOf(['one', 'two']))).toEqual({
			assetRefs: [],
			autoRefs: [],
			characterRefs: [],
			frameRefs: {},
			fxRefs: [],
			optionalAssetRefs: []
		});
	});
});
