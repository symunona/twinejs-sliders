import {applyEdit} from '../index';
import {removeBeat} from '../write';

function edit(text: string, index: number) {
	const out = removeBeat(text, index);

	return out ? applyEdit(text, out) : undefined;
}

describe('removeBeat()', () => {
	const text = [
		'cast:',
		'  mira: {at: -0.4}',
		'beats:',
		'  - mira: "Hello."  # first',
		'  - mira:',
		'      at: 0.2',
		'      say: "Moving."',
		'  - box: "Rain."'
	].join('\n');

	it('takes a one-line beat and its trailing comment', () => {
		expect(edit(text, 0)).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'beats:',
				'  - mira:',
				'      at: 0.2',
				'      say: "Moving."',
				'  - box: "Rain."'
			].join('\n')
		);
	});

	it('takes every line of a block beat', () => {
		expect(edit(text, 1)).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'beats:',
				'  - mira: "Hello."  # first',
				'  - box: "Rain."'
			].join('\n')
		);
	});

	it('leaves no empty line when the last beat ends the block', () => {
		expect(edit(text, 2)).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'beats:',
				'  - mira: "Hello."  # first',
				'  - mira:',
				'      at: 0.2',
				'      say: "Moving."'
			].join('\n')
		);
		expect(edit(`${text}\n`, 2)?.endsWith('say: "Moving."\n')).toBe(true);
	});

	it('takes beats: with the only beat', () => {
		expect(edit('bg: rain\nbeats:\n  - wait: 1\n', 0)).toBe('bg: rain\n');
	});

	it('does nothing past the end, or without beats', () => {
		expect(removeBeat(text, 3)).toBeUndefined();
		expect(removeBeat('bg: rain\n', 0)).toBeUndefined();
	});
});
