import {parseLinkText} from '../dialogue';
import {parseMarkup} from '../markup';

const parse = (text: string) => parseMarkup(parseLinkText(text));
const t = (value: string) => ({kind: 'text', value});

describe('parseMarkup', () => {
	it('passes plain text straight through', () => {
		expect(parse('You should not have come back.')).toEqual([
			t('You should not have come back.')
		]);
	});

	it('reads the five marks', () => {
		expect(parse('*a* **b** _c_ ==d== ~e~ ~~f~~')).toEqual([
			{kind: 'strong', children: [t('a')]},
			t(' '),
			{kind: 'strong', children: [t('b')]},
			t(' '),
			{kind: 'em', children: [t('c')]},
			t(' '),
			{kind: 'mark', children: [t('d')]},
			t(' '),
			{kind: 's', children: [t('e')]},
			t(' '),
			{kind: 's', children: [t('f')]}
		]);
	});

	it('nests marks', () => {
		expect(parse('*very _much_ so*')).toEqual([
			{
				kind: 'strong',
				children: [t('very '), {kind: 'em', children: [t('much')]}, t(' so')]
			}
		]);
	});

	it('closes before punctuation and opens after it', () => {
		expect(parse('"*No*," she said (_quietly_).')).toEqual([
			t('"'),
			{kind: 'strong', children: [t('No')]},
			t('," she said ('),
			{kind: 'em', children: [t('quietly')]},
			t(').')
		]);
	});

	it('leaves marks inside words and between spaces alone', () => {
		for (const text of [
			'snake_case_name',
			'2*3*4',
			'a==b',
			'x == y',
			'a * b * c',
			'wait ~ what ~ now',
			'****'
		]) {
			expect(parse(text)).toEqual([t(text)]);
		}
	});

	it('leaves an unclosed mark as its characters', () => {
		expect(parse('*sigh and _then')).toEqual([t('*sigh and _then')]);
	});

	it('does not pair different delimiters', () => {
		expect(parse('*a** and ~b~~')).toEqual([t('*a** and ~b~~')]);
	});

	it('keeps an unmatched inner opener as text inside the outer mark', () => {
		expect(parse('*a _b*')).toEqual([{kind: 'strong', children: [t('a _b')]}]);
	});

	it('spells a delimiter with a backslash', () => {
		expect(parse('\\*not bold\\* and a \\\\')).toEqual([t('*not bold* and a \\')]);
	});

	it('keeps other backslashes', () => {
		expect(parse('C:\\path')).toEqual([t('C:\\path')]);
	});

	it('lets a mark wrap a link, and a link sit next to a mark', () => {
		expect(parse('*[[go]]* or _[[stay -> Inn]] now_')).toEqual([
			{kind: 'strong', children: [{kind: 'link', name: 'go', target: 'go'}]},
			t(' or '),
			{
				kind: 'em',
				children: [{kind: 'link', name: 'stay', target: 'Inn'}, t(' now')]
			}
		]);
	});

	it('never reads a delimiter inside a link name', () => {
		expect(parse('[[a_b_c]]')).toEqual([{kind: 'link', name: 'a_b_c', target: 'a_b_c'}]);
	});

	it('handles astral characters next to a mark', () => {
		expect(parse('🔥*hot*🔥')).toEqual([
			t('🔥'),
			{kind: 'strong', children: [t('hot')]},
			t('🔥')
		]);
	});
});
