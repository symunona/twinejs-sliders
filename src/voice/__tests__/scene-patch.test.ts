import {patchBeatText, patchSceneText} from '../scene-patch';

const PASSAGE = `Some prose above the block.

[scene]
id: tavern
bg: tavern/night        # the good one
cast:
  mara: {at: [0.3, 0.8], pose: idle}
  joren: {at: 0.7}
props:
  candle: {at: [0.1, -0.2]}
beats:
  - mara: "Sit down."
  - joren: "I would rather not."
`;

describe('patchSceneText', () => {
	it('rewrites one top-level key and leaves the author’s comment alone', () => {
		const result = patchSceneText(PASSAGE, 'bg: tavern/dawn');

		expect(result.error).toBeUndefined();
		expect(result.text).toContain('bg: tavern/dawn');
		expect(result.text).toContain('# the good one');
		expect(result.changed).toEqual(['bg']);
	});

	it('leaves every line it was not asked about byte-for-byte', () => {
		const before = PASSAGE.split('\n');
		const after = patchSceneText(PASSAGE, 'bg: tavern/dawn').text.split('\n');

		expect(after).toHaveLength(before.length);
		// Exactly one line moved. Reserialising the block would have touched all of them.
		expect(after.filter((line, i) => line !== before[i])).toHaveLength(1);
	});

	it('keeps the prose above the block', () => {
		expect(patchSceneText(PASSAGE, 'bg: x').text).toContain(
			'Some prose above the block.'
		);
	});

	it('writes one key of one cast entry without touching its siblings', () => {
		const result = patchSceneText(PASSAGE, 'cast:\n  mara: {at: [0.4, 0.9]}');

		expect(result.error).toBeUndefined();
		expect(result.text).toContain('pose: idle');
		expect(result.text).toContain('joren: {at: 0.7}');
		expect(result.changed).toEqual(['cast/mara at']);
	});

	it('writes a prop through the props map', () => {
		const result = patchSceneText(PASSAGE, 'props:\n  candle: {at: [0.2, -0.1]}');

		expect(result.error).toBeUndefined();
		expect(result.changed).toEqual(['props/candle at']);
	});

	it('applies several keys in one call', () => {
		const result = patchSceneText(
			PASSAGE,
			'bg: tavern/dawn\ncast:\n  mara: {pose: angry}'
		);

		expect(result.changed).toEqual(['bg', 'cast/mara pose']);
		expect(result.text).toContain('tavern/dawn');
		expect(result.text).toContain('angry');
	});

	it('refuses beats — the whole list would have to be reserialised', () => {
		const result = patchSceneText(PASSAGE, 'beats:\n  - mara: "no"');

		expect(result.error).toMatch(/set_beat/);
		expect(result.text).toBe(PASSAGE);
	});

	it('refuses a key that is not a scene key', () => {
		expect(patchSceneText(PASSAGE, 'colour: blue').error).toMatch(/unknown scene key/);
	});

	it('refuses an entity that is not in the scene', () => {
		expect(patchSceneText(PASSAGE, 'cast:\n  nobody: {at: 0.5}').error).toMatch(
			/no such entity/
		);
	});

	it('refuses a patch that is not a YAML map', () => {
		expect(patchSceneText(PASSAGE, '- a\n- b').error).toMatch(/must be a YAML map/);
		expect(patchSceneText(PASSAGE, '{oh no').error).toMatch(/not YAML/);
	});

	it('refuses a passage with no scene block', () => {
		expect(patchSceneText('just prose', 'bg: x').error).toMatch(/no \[scene\] block/);
	});

	it('never returns a changed text alongside an error', () => {
		const result = patchSceneText(PASSAGE, 'bg: dawn\ncolour: blue');

		expect(result.error).toBeDefined();
		expect(result.text).toBe(PASSAGE);
	});

	it('removes a key written as ~', () => {
		const result = patchSceneText(PASSAGE, 'bg: ~');

		expect(result.error).toBeUndefined();
		expect(result.text).not.toContain('bg: tavern/night');
	});
});

describe('patchBeatText', () => {
	it('sets a key on a beat by index', () => {
		const result = patchBeatText(PASSAGE, 1, 'say: "Fine."');

		expect(result.error).toBeUndefined();
		expect(result.text).toContain('Fine.');
		expect(result.changed).toEqual(['say']);
	});

	it('leaves the other beat alone', () => {
		expect(patchBeatText(PASSAGE, 1, 'say: "Fine."').text).toContain('Sit down.');
	});

	it('refuses a beat index the scene does not have', () => {
		expect(patchBeatText(PASSAGE, 9, 'say: "hi"').error).toMatch(/no beat 9/);
	});

	it('refuses a patch that is not a map', () => {
		expect(patchBeatText(PASSAGE, 0, '[1, 2]').error).toMatch(/must be a YAML map/);
	});
});

describe('patchBeatText on a one-line dialogue beat', () => {
	const SCALAR = `[scene]
id: tavern
cast:
  mara: {at: 0.3}
beats:
  - mara: "Sit down."
  - box: "The candle gutters."
`;

	it('REPLACES the line when the patch sets say, rather than duplicating the key', () => {
		const result = patchBeatText(SCALAR, 0, 'say: "Please sit."');

		expect(result.error).toBeUndefined();
		// The bug this covers wrote `{say: "Sit down.", say: "Please sit."}` — a duplicate
		// key, which is a YAML error and reads back as whichever one the parser kept.
		expect(result.text).not.toContain('Sit down.');
		expect(result.text).toContain('Please sit.');
		expect(result.text.match(/say:/g) ?? []).toHaveLength(1);
	});

	it('does the same for a narration beat, whose scalar key is text', () => {
		const result = patchBeatText(SCALAR, 1, 'text: "The candle dies."');

		expect(result.error).toBeUndefined();
		expect(result.text).not.toContain('The candle gutters.');
		expect(result.text.match(/text:/g) ?? []).toHaveLength(1);
	});

	it('still promotes the line when the patch sets a DIFFERENT key', () => {
		const result = patchBeatText(SCALAR, 0, 'dur: 1.5');

		expect(result.error).toBeUndefined();
		expect(result.text).toContain('Sit down.');
		expect(result.text).toContain('dur: 1.5');
	});

	it('keeps the sentence when a promotion carries other keys alongside it', () => {
		const result = patchBeatText(SCALAR, 0, 'say: "Please sit."\ndur: 2');

		expect(result.text).toContain('Please sit.');
		expect(result.text).toContain('dur: 2');
		expect(result.text.match(/say:/g) ?? []).toHaveLength(1);
	});
});
