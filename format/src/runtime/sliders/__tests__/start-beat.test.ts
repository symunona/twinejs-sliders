import {resetStartBeat, takeStartBeat} from '../start-beat';

function storyData(attributes: Record<string, string> = {}): void {
	const el = document.createElement('tw-storydata');

	for (const [name, value] of Object.entries(attributes)) {
		el.setAttribute(name, value);
	}

	document.body.append(el);
}

describe('takeStartBeat', () => {
	beforeEach(() => {
		document.body.innerHTML = '';
		resetStartBeat();
	});

	it('is undefined when the story was published without one', () => {
		storyData();
		expect(takeStartBeat()).toBeUndefined();
	});

	it('is undefined when there is no story data at all', () => {
		expect(takeStartBeat()).toBeUndefined();
	});

	it('reads the beat the editor published', () => {
		storyData({'data-sliders-start-beat': '5'});
		expect(takeStartBeat()).toBe(5);
	});

	// A second scene in the same story is a different scene; the request named one beat of
	// one of them.
	it('answers once, and undefined after that', () => {
		storyData({'data-sliders-start-beat': '5'});
		expect(takeStartBeat()).toBe(5);
		expect(takeStartBeat()).toBeUndefined();
	});

	it('ignores a beat of zero, which is an ordinary play', () => {
		storyData({'data-sliders-start-beat': '0'});
		expect(takeStartBeat()).toBeUndefined();
	});

	it('ignores anything that is not a number', () => {
		storyData({'data-sliders-start-beat': 'nonsense'});
		expect(takeStartBeat()).toBeUndefined();
	});
});
