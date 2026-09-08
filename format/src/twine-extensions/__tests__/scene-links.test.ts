import {sceneLinkTargets} from '../sliders/scene-links';
import {parsePassageText} from '../parse-references';

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
			sceneLinkTargets('links: {onward: {to: Next Passage}, back: Other Passage}')
		).toEqual(
			new Map([
				['onward', 'Next Passage'],
				['back', 'Other Passage']
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
});

describe('parsePassageText', () => {
	it('reports a scene link as a passage reference', () => {
		const text = [
			'Some prose.',
			'',
			'[scene]',
			'id: alley',
			'links:',
			'  onward: {to: Next Passage}',
			'  back:   Other Passage'
		].join('\n');

		expect(parsePassageText(text)).toEqual(['Next Passage', 'Other Passage']);
	});

	it('still reports Chapbook references', () => {
		expect(parsePassageText("{link to: 'Somewhere'}")).toEqual(['Somewhere']);
	});

	it('reports a passage named by both syntaxes only once', () => {
		const text = ["{link to: 'Somewhere'}", '[scene]', 'links:', '  go: Somewhere'].join(
			'\n'
		);

		expect(parsePassageText(text)).toEqual(['Somewhere']);
	});
});
