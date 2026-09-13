/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {
	parsePassageReferences,
	scanLinkTargets,
	sceneLinkTargets
} from '../references';
import {parseScene} from '../parse-scene';

const PASSAGE = `mood: tense
seen_mira: true
--
[scene]
id: tavern-night
bg: tavern/night
beats:
  - mira: "Will you [[stay]] or [[go]]?"
  - box: "The door is [[ajar -> Back Alley]]."

links:
  stay: {to: Tavern Fight, if: has_weapon}
  go:   {to: Street, transition: fade}

[note]
Director: she should feel cornered.
`;

describe('sceneLinkTargets', () => {
	it('reads the shorthand form', () => {
		expect(
			sceneLinkTargets(['links:', '  back: Other Passage'].join('\n'))
		).toEqual(new Map([['back', 'Other Passage']]));
	});

	it('reads the flow map form', () => {
		expect(
			sceneLinkTargets(
				['links:', '  onward: {to: Next Passage, if: has_weapon}'].join('\n')
			)
		).toEqual(new Map([['onward', 'Next Passage']]));
	});

	it('reads an entry whose keys are on their own lines', () => {
		expect(
			sceneLinkTargets(
				['links:', '  onward:', '    to: Next Passage', '    if: x'].join('\n')
			)
		).toEqual(new Map([['onward', 'Next Passage']]));
	});

	it('reads the whole block written inline', () => {
		expect(
			sceneLinkTargets(
				'links: {onward: {to: Next Passage}, back: Other Passage}'
			)
		).toEqual(
			new Map([
				['onward', 'Next Passage'],
				['back', 'Other Passage']
			])
		);
	});

	it('reads a second inline block later in the text', () => {
		// The flow-map regex is module-level, so a stale lastIndex would drop entries.
		const text = [
			'links: {a: {to: One}}',
			'--',
			'links: {b: {to: Two}}'
		].join('\n');

		expect(sceneLinkTargets(text)).toEqual(
			new Map([
				['a', 'One'],
				['b', 'Two']
			])
		);
	});

	it('strips quotes and trailing comments', () => {
		expect(
			sceneLinkTargets(
				['links:', '  back: "Other Passage"   # shorthand'].join('\n')
			)
		).toEqual(new Map([['back', 'Other Passage']]));
	});

	it('stops at the end of the block', () => {
		expect(
			sceneLinkTargets(
				['links:', '  back: Other Passage', 'beats:', '  - box: "Hi"'].join('\n')
			)
		).toEqual(new Map([['back', 'Other Passage']]));
	});

	it('is not confused by a links: block that is still being typed', () => {
		expect(sceneLinkTargets(['links:', '  onward:'].join('\n'))).toEqual(
			new Map()
		);
	});

	it('is the same function as the older scanLinkTargets name', () => {
		expect(scanLinkTargets).toBe(sceneLinkTargets);
	});
});

describe('parsePassageReferences', () => {
	it('finds inline targets', () => {
		expect(parsePassageReferences('He went [[out -> The Street]].')).toEqual([
			'The Street'
		]);
	});

	it('resolves bare links through the links: map', () => {
		expect(parsePassageReferences(PASSAGE)).toEqual([
			'Tavern Fight',
			'Street',
			'Back Alley'
		]);
	});

	it('handles the block form of a links entry', () => {
		const text = ['[[stay]]', 'links:', '  stay:', '    to: Fight', '    if: brave'].join(
			'\n'
		);

		expect(parsePassageReferences(text)).toEqual(['Fight']);
	});

	it('handles the scalar shorthand', () => {
		expect(parsePassageReferences('[[stay]]\nlinks:\n  stay: Fight\n')).toEqual([
			'Fight'
		]);
	});

	it('strips quotes from targets', () => {
		expect(parsePassageReferences('[[stay]]\nlinks:\n  stay: {to: "A Room"}\n')).toEqual(
			['A Room']
		);
	});

	it('dedupes repeated targets', () => {
		const text = '[[a -> Hall]] [[b -> Hall]] [[c -> Hall]]';

		expect(parsePassageReferences(text)).toEqual(['Hall']);
	});

	it('ignores bare links with no entry', () => {
		expect(parsePassageReferences('[[nowhere]]')).toEqual([]);
	});

	it('returns nothing for text with no links', () => {
		expect(parsePassageReferences('just prose\nlinks:\n  a: {to: B}\n')).toEqual([]);
	});

	it('stops reading link entries at the end of the block', () => {
		const text = [
			'[[stay]] [[bg]]',
			'links:',
			'  stay: {to: Fight}',
			'bg: tavern/night'
		].join('\n');

		// `bg:` sits outside the links block, so [[bg]] resolves to nothing.
		expect(parsePassageReferences(text)).toEqual(['Fight']);
	});

	it('agrees with the full parser on the same passage', () => {
		const block = PASSAGE.split('[scene]\n')[1].split('\n[note]')[0];
		const {scene} = parseScene(block);
		const fromParser = Object.values(scene.links).map(l => l.to);

		for (const target of fromParser) {
			expect(parsePassageReferences(PASSAGE)).toContain(target);
		}
	});
});
