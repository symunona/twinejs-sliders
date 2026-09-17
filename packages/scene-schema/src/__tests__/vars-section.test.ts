import {
	isVarsSeparator,
	looksLikeVarsLine,
	looksLikeVarsSection,
	nearMissSeparator,
	varsLineName
} from '../vars-section';

describe('isVarsSeparator()', () => {
	it('accepts exactly two dashes', () => {
		expect(isVarsSeparator('--')).toBe(true);
	});

	it('accepts trailing spaces and tabs, which are invisible and never meant', () => {
		expect(isVarsSeparator('-- ')).toBe(true);
		expect(isVarsSeparator('--\t')).toBe(true);
	});

	it('rejects three dashes, which Markdown already owns as a horizontal rule', () => {
		expect(isVarsSeparator('---')).toBe(false);
	});

	it('rejects a leading indent', () => {
		expect(isVarsSeparator(' --')).toBe(false);
	});

	it('rejects anything else on the line', () => {
		expect(isVarsSeparator('-- vars')).toBe(false);
		expect(isVarsSeparator('a--')).toBe(false);
	});
});

describe('looksLikeVarsLine()', () => {
	it.each([
		'has_weapon: true',
		'sliders.autoAdvance: 0',
		'has_weapon (visited): true',
		'  indented: 1'
	])('accepts %p', line => expect(looksLikeVarsLine(line)).toBe(true));

	it.each(['Just some prose.', '[scene]', '- mira: "Hello."', ': no name'])(
		'rejects %p',
		line => expect(looksLikeVarsLine(line)).toBe(false)
	);
});

describe('varsLineName()', () => {
	it('returns the name, dots and all', () => {
		expect(varsLineName('sliders.autoAdvance: 0')).toBe('sliders.autoAdvance');
	});

	it('drops a condition', () => {
		expect(varsLineName('has_weapon (visited): true')).toBe('has_weapon');
	});

	it('returns undefined for prose', () => {
		expect(varsLineName('Just some prose.')).toBeUndefined();
	});
});

describe('looksLikeVarsSection()', () => {
	it('accepts a run of vars lines, blank lines ignored', () => {
		expect(looksLikeVarsSection('a: 1\n\nb: 2')).toBe(true);
	});

	it('rejects a run containing prose', () => {
		expect(looksLikeVarsSection('a: 1\nJust some prose.')).toBe(false);
	});

	it('rejects nothing at all', () => {
		expect(looksLikeVarsSection('')).toBe(false);
		expect(looksLikeVarsSection('\n\n')).toBe(false);
	});
});

describe('nearMissSeparator()', () => {
	it('finds three dashes under vars lines', () => {
		expect(nearMissSeparator('sliders.autoAdvance: 0\n---\n[scene]')).toEqual({
			line: 2,
			text: '---'
		});
	});

	it('finds an indented separator', () => {
		expect(nearMissSeparator('a: 1\n  --  \nbody')).toEqual({
			line: 2,
			text: '  --  '
		});
	});

	it('says nothing when the separator is correct', () => {
		expect(nearMissSeparator('a: 1\n--\n---\nbody')).toBeUndefined();
	});

	it('says nothing when trailing whitespace is all that is wrong', () => {
		// The runtime accepts it, so there is nothing to report.
		expect(nearMissSeparator('a: 1\n-- \nbody')).toBeUndefined();
	});

	it('leaves a horizontal rule in prose alone', () => {
		expect(
			nearMissSeparator('Chapter one ended here.\n\n---\n\nChapter two.')
		).toBeUndefined();
	});

	it('leaves a horizontal rule alone below a closed vars section', () => {
		expect(nearMissSeparator('a: 1\n--\nProse.\n\n---\n\nMore.')).toBeUndefined();
	});

	it('says nothing for a passage with no dashes at all', () => {
		expect(nearMissSeparator('a: 1\nb: 2')).toBeUndefined();
	});

	it('handles CRLF', () => {
		expect(nearMissSeparator('a: 1\r\n---\r\nbody')).toEqual({
			line: 2,
			text: '---'
		});
	});
});
