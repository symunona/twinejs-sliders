import {passageLinks} from '../passage-links';

const scene = (body: string) => `Prose above.\n\n[scene]\n${body}`;

describe('passageLinks()', () => {
	it('returns the [[links]] of a passage with no scene', () =>
		expect(passageLinks('[[a]] and [[b->c]]')).toEqual(['a', 'c']));

	it('returns the targets of a scene links: block', () =>
		expect(
			passageLinks(scene('links:\n  back: Street\n  on: Tavern'))
		).toEqual(['Street', 'Tavern']));

	it('reads a flow entry with an if: alongside its target', () =>
		expect(
			passageLinks(scene('links:\n  on: {to: Tavern Fight, if: has_weapon}'))
		).toEqual(['Tavern Fight']));

	it('unions scene links with [[links]] in the same passage', () =>
		expect(passageLinks(`[[Alley]]\n${scene('links:\n  back: Street')}`)).toEqual(
			['Alley', 'Street']
		));

	it('does not repeat a target both syntaxes name', () =>
		expect(
			passageLinks(`[[Street]]\n${scene('links:\n  back: Street')}`)
		).toEqual(['Street']));

	// The gate. Core is shared with formats where `links:` is just prose.
	it('ignores a links: block in a passage with no [scene] modifier', () =>
		expect(passageLinks('links:\n  back: Street\n\n[[Alley]]')).toEqual([
			'Alley'
		]));

	it('ignores a links: block outside the scene block', () =>
		expect(
			passageLinks('links:\n  back: Street\n--\n[scene]\nlinks:\n  on: Tavern')
		).toEqual(['Tavern']));

	it('drops external scene targets when asked for internal links only', () => {
		const text = scene('links:\n  out: http://twinery.org\n  on: Tavern');

		expect(passageLinks(text, true)).toEqual(['Tavern']);
		expect(passageLinks(text)).toEqual(['http://twinery.org', 'Tavern']);
	});

	// Without this the story map draws no arrow for a clickable door, the ghost card for a
	// missing target never appears, and twine-cli calls that passage unreachable.
	it('counts an entity link: as a link out of this passage', () => {
		const text = [
			'[scene]',
			'props:',
			'  door: {at: 0.3, link: Cellar}',
			'links:',
			'  back: Street'
		].join('\n');

		expect(passageLinks(text)).toEqual(
			expect.arrayContaining(['Street', 'Cellar'])
		);
	});

	it('does not scan a passage with no scene block for link:', () => {
		expect(passageLinks('Prose that mentions link: Cellar in passing.')).toEqual(
			[]
		);
	});
});