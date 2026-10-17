import {applyEdit} from '../index';
import {insertBeatLine} from '../write';

function edit(text: string, index: number, who: string) {
	const out = insertBeatLine(text, index, who);

	return out ? applyEdit(text, out) : undefined;
}

describe('insertBeatLine()', () => {
	const text = [
		'cast:',
		'  mira: {at: -0.4}',
		'beats:',
		'  - mira: "Hello."  # first',
		'  - box: "Rain."'
	].join('\n');

	it('lands after the beat it follows, comment kept with that beat', () => {
		expect(edit(text, 1, 'mira')).toBe(
			[
				'cast:',
				'  mira: {at: -0.4}',
				'beats:',
				'  - mira: "Hello."  # first',
				'  - mira: ""',
				'  - box: "Rain."'
			].join('\n')
		);
	});

	it('goes first at 0, and last past the end', () => {
		expect(edit(text, 0, 'box')?.split('\n')[3]).toBe('  - box: ""');
		expect(edit(text, 9, 'candle')?.split('\n').pop()).toBe('  - candle: ""');
	});

	it('creates beats: when there is none', () => {
		expect(edit('cast:\n  mira: {at: 0}\n', 0, 'mira')).toBe(
			'cast:\n  mira: {at: 0}\nbeats:\n  - mira: ""\n'
		);
	});

	it('fills an empty beats:', () => {
		expect(edit('bg: x\nbeats:\n', 0, 'box')).toBe('bg: x\nbeats:\n  - box: ""\n');
	});
});
