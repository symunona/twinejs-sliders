/**
 * @jest-environment-options {"customExportConditions": ["node"]}
 */
import {applyEdit, removeSceneKey, setSceneKey} from '../index';

/**
 * The promise of the two-tier strategy is that a write does not reformat the file. These
 * fixtures are deliberately comment-heavy and inconsistently styled for that reason: if a
 * splice ever widens to the whole document, one of these breaks immediately.
 */

const block = [
	'# The tavern, after dark.',
	'id: tavern',
	'bg: tavern-day # swapped at dusk',
	'cast:',
	'  mira: {at: -0.4}',
	'',
	'beats:',
	'  - mira: "Get out."'
].join('\n');

function write(text: string, key: string, formatted: string): string {
	return applyEdit(text, setSceneKey(text, key, formatted));
}

describe('setSceneKey()', () => {
	it('splices only the value, leaving the trailing comment alone', () => {
		expect(write(block, 'bg', 'tavern-night')).toBe(
			block.replace('bg: tavern-day', 'bg: tavern-night')
		);
	});

	it('touches nothing else in the file', () => {
		const after = write(block, 'bg', 'tavern-night');

		expect(after).toContain('# The tavern, after dark.');
		expect(after).toContain('  mira: {at: -0.4}');
		expect(after.split('\n').length).toBe(block.split('\n').length);
	});

	it('inserts a missing key in spec 02 order, not at the end', () => {
		const after = write(block, 'camera', '{zoom: 1.5}');
		const lines = after.split('\n');

		// After bg:, before cast:.
		expect(lines[3]).toBe('camera: {zoom: 1.5}');
		expect(lines[4]).toBe('cast:');
	});

	it('puts a key that sorts first above everything', () => {
		const after = write('cast:\n  mira: {at: 0}\n', 'bg', 'tavern');

		expect(after.split('\n')[0]).toBe('bg: tavern');
	});

	it('fills in a value the author has not typed yet', () => {
		expect(write('bg:\ncast:\n', 'bg', 'tavern')).toBe('bg: tavern\ncast:\n');
	});

	it('does not double the space after the colon', () => {
		expect(write('bg: \n', 'bg', 'tavern')).toBe('bg: tavern\n');
	});

	it('replaces a block-style camera map with the flow form', () => {
		const source = ['camera:', '  zoom: 2', 'cast:', '  mira: {at: 0}'].join(
			'\n'
		);

		expect(write(source, 'camera', '{zoom: 3}')).toBe(
			['camera: {zoom: 3}', 'cast:', '  mira: {at: 0}'].join('\n')
		);
	});

	it('appends when the block is not parseable as a map', () => {
		expect(write('', 'bg', 'tavern')).toBe('bg: tavern\n');
	});
});

describe('removeSceneKey()', () => {
	it('takes the whole line, comment included', () => {
		const edit = removeSceneKey(block, 'bg');

		expect(edit).toBeDefined();
		expect(applyEdit(block, edit!)).toBe(
			block.replace('bg: tavern-day # swapped at dusk\n', '')
		);
	});

	it('is undefined for a key that is not there', () => {
		expect(removeSceneKey(block, 'camera')).toBeUndefined();
	});
});
