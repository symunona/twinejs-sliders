import {passageRefAt, passageRefSpans} from '../passage-ref-spans';

const passage = [
	'mood: tense',
	'--',
	'[scene]',
	'bg: tavern/night',
	'cast:',
	'  mira: {at: -0.4, pose: arms-crossed}',
	'props:',
	'  candle: {at: 0.1}',
	'',
	'[note]',
	'bg: not-a-scene-key'
].join('\n');

describe('passageRefSpans', () => {
	it('returns nothing for a passage with no scene block', () => {
		expect(passageRefSpans('just prose\n\n[[a link]]')).toEqual([]);
	});

	it('reports offsets into the passage, not the block', () => {
		for (const span of passageRefSpans(passage)) {
			expect(passage.slice(span.start, span.end)).toBe(span.ref);
		}
	});

	it('finds the backdrop, the entities and the pose', () => {
		expect(
			passageRefSpans(passage).map(span => `${span.kind}:${span.ref}`)
		).toEqual([
			'bg:tavern/night',
			'entity:mira',
			'pose:arms-crossed',
			'entity:candle'
		]);
	});

	it('stops at the next modifier', () => {
		expect(
			passageRefSpans(passage).some(span => span.ref === 'not-a-scene-key')
		).toBe(false);
	});
});

describe('passageRefAt', () => {
	it('finds the reference the offset falls inside', () => {
		const at = passage.indexOf('arms-crossed') + 2;
		const span = passageRefAt(passage, at);

		expect(span).toMatchObject({
			kind: 'pose',
			owner: 'mira',
			ref: 'arms-crossed'
		});
	});

	it('includes the first character and excludes the one past the last', () => {
		const start = passage.indexOf('tavern/night');

		expect(passageRefAt(passage, start)?.ref).toBe('tavern/night');
		expect(passageRefAt(passage, start - 1)).toBeUndefined();
		expect(
			passageRefAt(passage, start + 'tavern/night'.length)
		).toBeUndefined();
	});

	it('answers nothing off a reference', () => {
		expect(passageRefAt(passage, passage.indexOf('mood'))).toBeUndefined();
	});
});
