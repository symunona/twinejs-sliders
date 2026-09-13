import {parseSceneText} from '../use-scene-parse';
import {linkTargetErrors, LinkTargetError} from '../validate-links';

const passages = ['Street', 'Tavern Fight', 'Cellar'].map(name => ({
	name,
	text: ''
}));

/**
 * Every unknown-passage error the parse of `text` produces. `parseSceneText` widens these
 * back to `SceneError` on the way through, so the cast is what makes `missingPassage`
 * visible again.
 */
function unknown(text: string, names = passages) {
	return parseSceneText(text, names).errors.filter(
		error => error.code === 'unknown-passage'
	) as LinkTargetError[];
}

describe('linkTargetErrors()', () => {
	it('accepts a links: target that names a passage', () => {
		expect(
			unknown('[scene]\nbg: tavern\nlinks:\n  stay: {to: Street}\n')
		).toEqual([]);
	});

	it('reports a links: target that names no passage', () => {
		const errors = unknown('[scene]\nlinks:\n  stay: {to: Streetz}\n');

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({
			code: 'unknown-passage',
			line: 3,
			severity: 'error'
		});
		expect(errors[0].message).toContain('Streetz');
		expect(errors[0].hint).toContain('Street');
	});

	it('reports a target written inline in beat text', () => {
		const errors = unknown(
			'[scene]\nbeats:\n  - mira: "Out [[go -> Cellarz]]"\n'
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(3);
		expect(errors[0].hint).toContain('Cellar');
	});

	it('accepts a name with spaces in it', () => {
		expect(
			unknown('[scene]\nbeats:\n  - mira: "[[go -> Tavern Fight]]"\n')
		).toEqual([]);
	});

	it('reports a plain link in the prose after the block', () => {
		// Prose only leaves the block at the next modifier line; before that it is YAML.
		const errors = unknown(
			'[scene]\nbg: tavern\n[continued]\nGo to [[Nowhere]].\n'
		);

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({line: 4});
		expect(errors[0].message).toContain('Nowhere');
	});

	it('reports a plain link in the prose above the block', () => {
		const errors = unknown('Go to [[Nowhere]].\n[scene]\nbg: tavern\n');

		expect(errors).toHaveLength(1);
		expect(errors[0]).toMatchObject({line: 1});
	});

	it('reads every prose link form Twine does', () => {
		expect(
			unknown(
				'[scene]\nbg: tavern\n[continued]\n[[Street]] [[go->Cellar]] [[Street<-back]] [[go|Tavern Fight]]\n'
			)
		).toEqual([]);
		expect(
			unknown(
				'[scene]\nbg: tavern\n[continued]\n[[go->Nowhere]] [[go|Nothing]]\n'
			)
		).toHaveLength(2);
	});

	it('leaves external links alone', () => {
		expect(
			unknown('[scene]\nbg: tavern\n[continued]\n[[https://twinery.org]]\n')
		).toEqual([]);
	});

	it('judges a bare prose [[name]] by the links: entry that routes it', () => {
		// One error for the bad target, not a second one for the prose link's name.
		const errors = unknown(
			'[scene]\nlinks:\n  stay: {to: Nowhere}\n[continued]\n[[stay]]\n'
		);

		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(3);
	});

	it('says nothing when the story is unknown', () => {
		expect(unknown('[scene]\nlinks:\n  stay: {to: Nowhere}\n', [])).toEqual(
			[]
		);
	});

	// The error list offers to create the passage, and needs the bare name to do it.
	it('carries the missing name on a links: target', () =>
		expect(
			unknown('[scene]\nlinks:\n  stay: {to: Nowhere}\n')[0]
		).toMatchObject({missingPassage: 'Nowhere'}));

	it('carries the missing name on a prose link', () =>
		expect(
			unknown('[scene]\nbg: tavern\n[continued]\n[[go->Nowhere]]\n')[0]
		).toMatchObject({missingPassage: 'Nowhere'}));

	it('takes the passage list as given, parse or no parse', () => {
		expect(
			linkTargetErrors({
				blockLines: 0,
				blockOffset: 0,
				passageNames: ['Street'],
				text: 'Go [[Nowhere]]',
				result: undefined
			})
		).toHaveLength(1);
	});
});
