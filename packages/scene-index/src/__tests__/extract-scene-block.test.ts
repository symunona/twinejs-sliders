/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {extractSceneBlock} from '../extract-scene-block';

const PASSAGE = `mood: tense
seen_mira: true
--
[scene]
id: tavern-night
bg: tavern/night

[note]
Director: she should feel cornered. Not rendered.

[continued]
Normal Chapbook Markdown still works down here.
`;

describe('extractSceneBlock', () => {
	it('returns undefined when there is no scene block', () => {
		expect(extractSceneBlock('Just prose.\n[note]\nA note.')).toBeUndefined();
	});

	it('pulls the block out and stops at the next modifier', () => {
		const block = extractSceneBlock(PASSAGE);

		expect(block?.text).toBe('id: tavern-night\nbg: tavern/night\n');
	});

	it('reports a line offset that maps parser lines back to the passage', () => {
		const block = extractSceneBlock(PASSAGE);

		// `id:` is line 1 of the block and line 5 of the passage.
		expect(block?.lineOffset).toBe(4);
		expect(PASSAGE.split('\n')[(block?.lineOffset ?? 0) + 1 - 1]).toBe(
			'id: tavern-night'
		);
	});

	it('runs to the end of the passage when no modifier follows', () => {
		const block = extractSceneBlock('[scene]\nid: a\nbg: b');

		expect(block).toEqual({lineOffset: 1, text: 'id: a\nbg: b'});
	});

	it('does not treat a [[link]] line as a modifier', () => {
		const block = extractSceneBlock(
			'[scene]\nbeats:\n  - box: "x"\n[[Go on]]\nlinks:\n  a: {to: B}'
		);

		expect(block?.text).toContain('links:');
	});

	it('ignores surrounding whitespace on the modifier lines', () => {
		const block = extractSceneBlock('  [scene]  \nid: a\n  [note]  \nhi');

		expect(block?.text).toBe('id: a');
	});

	it('returns an empty block when the modifier is immediately followed by another', () => {
		expect(extractSceneBlock('[scene]\n[note]\nhi')).toEqual({
			lineOffset: 1,
			text: ''
		});
	});
});
