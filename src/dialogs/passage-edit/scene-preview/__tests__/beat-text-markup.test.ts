import {toggleMarkup} from '../beat-text-markup';

describe('toggleMarkup', () => {
	it('wraps the selection in bold', () => {
		expect(toggleMarkup('say hello now', 4, 9, 'bold')).toEqual({
			end: 11,
			start: 6,
			text: 'say **hello** now'
		});
	});

	it('wraps the selection in italic', () => {
		expect(toggleMarkup('say hello now', 4, 9, 'italic').text).toBe(
			'say _hello_ now'
		);
	});

	it('unwraps a selection that sits inside the marks', () => {
		expect(toggleMarkup('say **hello** now', 6, 11, 'bold')).toEqual({
			end: 9,
			start: 4,
			text: 'say hello now'
		});
	});

	it('unwraps a selection that includes the marks', () => {
		expect(toggleMarkup('say _hello_ now', 4, 11, 'italic').text).toBe(
			'say hello now'
		);
	});

	it('treats a single star as bold, the way beat text does', () => {
		expect(toggleMarkup('say *hello* now', 5, 10, 'bold').text).toBe(
			'say hello now'
		);
	});

	it('takes the word under the caret when nothing is selected', () => {
		expect(toggleMarkup('say hello now', 6, 6, 'bold').text).toBe(
			'say **hello** now'
		);
		expect(toggleMarkup('say **hello** now', 8, 8, 'bold').text).toBe(
			'say hello now'
		);
	});

	it('inserts an empty pair with the caret inside between words', () => {
		expect(toggleMarkup('a  b', 2, 2, 'italic')).toEqual({
			end: 3,
			start: 3,
			text: 'a __ b'
		});
	});

	it('keeps edge spaces outside the marks', () => {
		expect(toggleMarkup('say hello now', 3, 10, 'bold').text).toBe(
			'say **hello** now'
		);
	});

	it('adds italic inside bold rather than unwrapping it', () => {
		expect(toggleMarkup('**hi**', 2, 4, 'italic').text).toBe('**_hi_**');
	});
});
