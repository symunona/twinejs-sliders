import {
	forwardLinks,
	linkOfBody,
	prefillSceneLinks,
	sceneLinkSeeds
} from '../prefill-links';

/** The links: block the story format's Insert Scene skeleton carries, verbatim. */
const SKELETON = [
	'[scene]',
	'bg: backdrop-id                 # asset id, never a path',
	'',
	'links:',
	'  onward: {to: Next Passage, if: has_weapon, icon: sword, transition: fade}',
	'  back:   Other Passage         # shorthand when the target is all you need',
	'',
	'[continued]'
].join('\n');

function links(skeleton: string) {
	return skeleton
		.split('\n')
		.filter(line => line.startsWith('  '))
		.map(line => line.trimEnd());
}

describe('linkOfBody()', () => {
	it('reads every link form', () => {
		expect(linkOfBody('Street')).toEqual({name: 'Street', to: 'Street'});
		expect(linkOfBody('Go out->Street')).toEqual({name: 'Go out', to: 'Street'});
		expect(linkOfBody('Street<-Go out')).toEqual({name: 'Go out', to: 'Street'});
		expect(linkOfBody('Go out|Street')).toEqual({name: 'Go out', to: 'Street'});
		expect(linkOfBody('Street][coins: 1')).toEqual({
			name: 'Street',
			to: 'Street'
		});
	});
});

describe('forwardLinks()', () => {
	it('keeps source order and drops repeats and externals', () => {
		expect(
			forwardLinks(
				'Go [[Street]] or [[Fight->Tavern Fight]].\nAgain [[Street]].\n[[https://example.com]]'
			)
		).toEqual([
			{name: 'Street', to: 'Street'},
			{name: 'Fight', to: 'Tavern Fight'}
		]);
	});
});

describe('sceneLinkSeeds()', () => {
	it('finds what the passage links to and what links back to it', () => {
		const passages = [
			{name: 'Tavern', text: 'Out to [[Street]].'},
			{name: 'Cellar', text: 'Up to [[Tavern]].'},
			{name: 'Street', text: ''}
		];

		expect(sceneLinkSeeds('Tavern', passages[0].text, passages)).toEqual({
			back: 'Cellar',
			forward: [{name: 'Street', to: 'Street'}]
		});
	});

	it('ignores a link a passage makes to itself', () => {
		expect(sceneLinkSeeds('Tavern', 'Stay [[Tavern]].', [])).toEqual({
			back: undefined,
			forward: []
		});
	});
});

describe('prefillSceneLinks()', () => {
	it('points the example at the passage own links', () => {
		const filled = prefillSceneLinks(SKELETON, {
			back: 'Cellar',
			forward: [{name: 'Go out', to: 'Street'}]
		});

		expect(links(filled)).toEqual([
			'  Go out: {to: Street, if: has_weapon, icon: sword, transition: fade}',
			'  back:   Cellar         # shorthand when the target is all you need'
		]);
	});

	it('keeps the example key when the link has no label of its own', () => {
		const filled = prefillSceneLinks(SKELETON, {
			forward: [{name: 'Street', to: 'Street'}]
		});

		expect(links(filled)[0]).toBe(
			'  Street: {to: Street, if: has_weapon, icon: sword, transition: fade}'
		);
	});

	it('writes every extra link the example had no room for', () => {
		const filled = prefillSceneLinks(SKELETON, {
			back: 'Cellar',
			forward: [
				{name: 'Go out', to: 'Street'},
				{name: 'Fight', to: 'Tavern Fight'},
				{name: 'Hide', to: 'Barrel'}
			]
		});

		expect(links(filled)).toEqual([
			'  Go out: {to: Street, if: has_weapon, icon: sword, transition: fade}',
			'  back:   Cellar         # shorthand when the target is all you need',
			'  Fight: {to: Tavern Fight}',
			'  Hide: {to: Barrel}'
		]);
	});

	it('leaves the whole example alone when the passage has no links', () => {
		expect(prefillSceneLinks(SKELETON, {forward: []})).toBe(SKELETON);
	});

	it('leaves the back example alone when nothing links here', () => {
		const filled = prefillSceneLinks(SKELETON, {
			forward: [{name: 'Go out', to: 'Street'}]
		});

		expect(links(filled)[1]).toContain('Other Passage');
	});

	it('strips structure out of a label used as a key', () => {
		const filled = prefillSceneLinks(SKELETON, {
			forward: [{name: 'Wait: {really}', to: 'Street'}]
		});

		expect(links(filled)[0]).toContain('Wait really: {to: Street');
	});

	it('does nothing to text with no links: block', () => {
		expect(prefillSceneLinks('[scene]\nbg: tavern\n', {back: 'Cellar', forward: []})).toBe(
			'[scene]\nbg: tavern\n'
		);
	});
});
