import {
	countSceneCharacterRefs,
	renameSceneCharacter
} from '../rename-scene-character';

describe('renameSceneCharacter', () => {
	function scene(...lines: string[]) {
		return ['[scene]', ...lines].join('\n');
	}

	it('follows a rename into cast keys, ref:, of: and a beat speaker', () => {
		const text = scene(
			'cast:',
			'  mira: {at: -0.4}',
			'props:',
			'  lamp: {of: mira}',
			'entities:',
			'  shadow: {ref: mira}',
			'beats:',
			'  - mira: "Hello."'
		);

		expect(renameSceneCharacter(text, 'mira', 'tav')).toBe(
			scene(
				'cast:',
				'  tav: {at: -0.4}',
				'props:',
				'  lamp: {of: tav}',
				'entities:',
				'  shadow: {ref: tav}',
				'beats:',
				'  - tav: "Hello."'
			)
		);
	});

	it('renames a beat body`s ref: and of: too', () => {
		const text = scene(
			'beats:',
			'  - mira:',
			'      say: "Over here."',
			'      of: mira',
			'  - ghost:',
			'      ref: mira',
			'      opacity: 0.5'
		);

		expect(renameSceneCharacter(text, 'mira', 'tav')).toBe(
			scene(
				'beats:',
				'  - tav:',
				'      say: "Over here."',
				'      of: tav',
				'  - ghost:',
				'      ref: tav',
				'      opacity: 0.5'
			)
		);
	});

	it('leaves the rest of the block exactly as the author wrote it', () => {
		const text = scene(
			'# who is on stage',
			'cast:',
			'',
			'  mira:   {at: -0.4, pose: idle}   # by the door',
			'  tav:    {at: 0.4}'
		);

		expect(renameSceneCharacter(text, 'mira', 'mira-2')).toBe(
			scene(
				'# who is on stage',
				'cast:',
				'',
				'  mira-2:   {at: -0.4, pose: idle}   # by the door',
				'  tav:    {at: 0.4}'
			)
		);
	});

	it('renames only whole ids, never a name inside another one', () => {
		const text = scene('cast:', '  mira-ghost: {at: 0}', '  mira: {at: 0.2}');

		expect(renameSceneCharacter(text, 'mira', 'tav')).toBe(
			scene('cast:', '  mira-ghost: {at: 0}', '  tav: {at: 0.2}')
		);
	});

	it('leaves passage names, backdrops, poses and marks alone', () => {
		const text = scene(
			'from: mira',
			'bg: mira',
			'cast:',
			'  tav: {pose: mira}',
			'beats:',
			'  - mark: mira',
			'  - tav: "Where is mira?"',
			'links:',
			'  back: mira'
		);

		expect(renameSceneCharacter(text, 'mira', 'tav-2')).toBe(text);
		expect(countSceneCharacterRefs(text, 'mira')).toBe(0);
	});

	it('does not move a key the block has repointed at something else', () => {
		// `mira:` is an entity whose art is `tav` — `of: mira` means THAT entity, not the
		// character being renamed.
		const text = scene(
			'cast:',
			'  mira: {ref: tav}',
			'props:',
			'  lamp: {of: mira}'
		);

		expect(renameSceneCharacter(text, 'mira', 'mira-2')).toBe(text);
	});

	it('still follows an explicit ref: when the key is something else', () => {
		const text = scene('cast:', '  hero: {ref: mira, at: 0}');

		expect(renameSceneCharacter(text, 'mira', 'tav')).toBe(
			scene('cast:', '  hero: {ref: tav, at: 0}')
		);
	});

	it('quotes an id that would stop being text', () => {
		const text = scene('cast:', '  mira: {at: 0}');

		expect(renameSceneCharacter(text, 'mira', '04')).toBe(
			scene('cast:', '  "04": {at: 0}')
		);
	});

	it('reads a numeric-looking id from source', () => {
		const text = scene('cast:', '  04: {at: 0}', 'beats:', '  - 04: "Hi."');

		expect(renameSceneCharacter(text, '04', 'mira')).toBe(
			scene('cast:', '  mira: {at: 0}', 'beats:', '  - mira: "Hi."')
		);
	});

	it('bails on a block that does not parse', () => {
		const text = scene('cast:', '  mira: {at: 0', 'beats:', '  - mira: "Hi."');

		expect(renameSceneCharacter(text, 'mira', 'tav')).toBe(text);
		expect(countSceneCharacterRefs(text, 'mira')).toBe(0);
	});

	it('leaves text with no scene block alone', () => {
		expect(renameSceneCharacter('mira says hello', 'mira', 'tav')).toBe(
			'mira says hello'
		);
	});

	it('does nothing when the id does not change', () => {
		const text = scene('cast:', '  mira: {at: 0}');

		expect(renameSceneCharacter(text, 'mira', 'mira')).toBe(text);
	});
});

describe('countSceneCharacterRefs', () => {
	function scene(...lines: string[]) {
		return ['[scene]', ...lines].join('\n');
	}

	it('counts every slot in a passage', () => {
		const text = scene(
			'cast:',
			'  mira: {at: 0}',
			'props:',
			'  lamp: {of: mira}',
			'beats:',
			'  - mira: "Hi."'
		);

		expect(countSceneCharacterRefs(text, 'mira')).toBe(3);
	});

	it('counts the passages of a story that mention the character', () => {
		const passages = [
			{text: scene('cast:', '  mira: {at: 0}')},
			{text: scene('beats:', '  - mira: "Still here."')},
			{text: scene('cast:', '  tav: {at: 0}')},
			{text: 'No scene block at all.'}
		];

		expect(
			passages.filter(passage => countSceneCharacterRefs(passage.text, 'mira') > 0)
				.length
		).toBe(2);
	});
});

/**
 * Several of the same art. A second drop of `candle` lands as `candle-2: {ref: candle}`
 * (`uniqueEntityId`); a rename keeps that pairing readable instead of leaving `candle-2`
 * pointing at `lantern`.
 */
describe('renameSceneCharacter, numbered copies', () => {
	function scene(...lines: string[]) {
		return ['[scene]', ...lines].join('\n');
	}

	it('renames the id, and the ref: only where a ref: was written', () => {
		const text = scene(
			'props:',
			'  candle: {at: -0.2}',
			'  lamp: {ref: candle, at: 0.4}'
		);

		expect(renameSceneCharacter(text, 'candle', 'lantern')).toBe(
			scene('props:', '  lantern: {at: -0.2}', '  lamp: {ref: lantern, at: 0.4}')
		);
	});

	it('moves a numbered copy along with its art, speakers and of: included', () => {
		const text = scene(
			'props:',
			'  candle: {at: -0.2}',
			'  candle-2: {ref: candle, at: 0.2}',
			'  flame: {of: candle-2}',
			'beats:',
			'  - candle-2: {at: 0.3}'
		);

		expect(renameSceneCharacter(text, 'candle', 'lantern')).toBe(
			scene(
				'props:',
				'  lantern: {at: -0.2}',
				'  lantern-2: {ref: lantern, at: 0.2}',
				'  flame: {of: lantern-2}',
				'beats:',
				'  - lantern-2: {at: 0.3}'
			)
		);
	});

	/** No `ref:` means the key IS the art: `candle-2` is a different picture. */
	it('leaves a key that only looks numbered alone', () => {
		const text = scene('props:', '  candle: {at: 0}', '  candle-2: {at: 0.4}');

		expect(renameSceneCharacter(text, 'candle', 'lantern')).toBe(
			scene('props:', '  lantern: {at: 0}', '  candle-2: {at: 0.4}')
		);
	});

	/** Under `from:` a bare `candle-2:` patches the copy the base scene placed. */
	it('follows a copy into a patch scene', () => {
		const text = scene('from: Hall', 'props:', '  candle-2: {at: 0.5}');

		expect(renameSceneCharacter(text, 'candle', 'lantern')).toBe(
			scene('from: Hall', 'props:', '  lantern-2: {at: 0.5}')
		);
	});

	it('keeps the old handle when the new one is already taken', () => {
		const text = scene(
			'props:',
			'  candle: {at: 0}',
			'  candle-2: {ref: candle}',
			'  lantern-2: {at: 0.6}'
		);

		expect(renameSceneCharacter(text, 'candle', 'lantern')).toBe(
			scene(
				'props:',
				'  lantern: {at: 0}',
				'  candle-2: {ref: lantern}',
				'  lantern-2: {at: 0.6}'
			)
		);
	});
});
