/**
 * The four keys, against the DOM a passage actually renders.
 *
 * The stage is a test double — what a beat looks like on screen is `stage-element`'s
 * problem, and mounting a renderer here would test jsdom's layout rather than the key
 * table. What is pinned here is which of the two halves a key reaches: a beat, or a link.
 */

const store: Record<string, unknown> = {};

jest.mock('../../state', () => ({
	get: (name: string) => store[name],
	set: (name: string, value: unknown) => {
		store[name] = value;
	}
}));

// The real `restart()` reloads the window, which jsdom answers with a "not implemented"
// error rather than a navigation. What this suite can say is which key reaches it.
const mockRestart = jest.fn();

jest.mock('../../actions', () => ({restart: () => mockRestart()}));

import {clearResume} from '../history';
import {initKeyboard} from '../keyboard';

/**
 * A stage that only answers the three questions the keyboard asks.
 *
 * Not a subclass of the real one, and deliberately: importing `stage-element` here would
 * drag the renderer, the asset resolver and half of Chapbook into this suite to test a
 * key table. The keyboard finds a stage by those three methods, so a double that has them
 * IS a stage as far as this file is concerned — and if that contract is ever renamed on
 * one side, the suite that mounts a real scene is the one that says so.
 */
class TestStage extends HTMLElement {
	more = true;
	advanced = 0;
	steppedBack = 0;
	/** What `stepBack` answers: `false` means "I am at my first beat". */
	backs = false;

	canAdvance() {
		return this.more;
	}

	advance() {
		this.advanced++;
	}

	stepBack() {
		this.steppedBack++;
		return this.backs;
	}
}

customElements.define('sliders-stage', TestStage);
initKeyboard();

function passage(html: string): HTMLElement {
	document.body.innerHTML = `<article>${html}</article>`;
	return document.body.querySelector('article') as HTMLElement;
}

function stage(): TestStage {
	return document.querySelector('sliders-stage') as TestStage;
}

function press(key: string, init: KeyboardEventInit = {}): KeyboardEvent {
	const event = new KeyboardEvent('keydown', {
		bubbles: true,
		cancelable: true,
		key,
		...init
	});

	(document.activeElement ?? document.body).dispatchEvent(event);
	return event;
}

function link(name: string) {
	return `<passage-link class="link" to="${name}" tabindex="0">${name}</passage-link>`;
}

beforeEach(() => {
	clearResume();
	mockRestart.mockClear();
	store.trail = ['Start', 'Hall'];
	document.body.innerHTML = '';
});

describe('right arrow', () => {
	it('plays the next beat while the scene has one', () => {
		passage('<sliders-stage></sliders-stage>' + link('Cellar'));

		expect(press('ArrowRight').defaultPrevented).toBe(true);
		expect(stage().advanced).toBe(1);
	});

	// The scene's own ending comes first, even when the way out is unambiguous: Right past
	// the last line is what turns the page, and skipping to it would eat that line.
	it('turns the page once the beats are done and there is one way out', () => {
		passage('<sliders-stage></sliders-stage>' + link('Cellar'));
		stage().more = false;
		const click = jest.fn();

		document.querySelector('passage-link')!.addEventListener('click', click);
		expect(press('ArrowRight').defaultPrevented).toBe(true);
		expect(click).toHaveBeenCalled();
	});

	it('does nothing when the reader has a choice to make', () => {
		passage(
			'<sliders-stage></sliders-stage>' + link('Cellar') + link('Garden')
		);
		stage().more = false;

		expect(press('ArrowRight').defaultPrevented).toBe(false);
	});

	it('ignores links the stage is still holding back', () => {
		passage(
			'<sliders-stage></sliders-stage>' +
				`<div class="fork" data-pending>${link('Cellar')}</div>`
		);
		stage().more = false;
		const click = jest.fn();

		document.querySelector('passage-link')!.addEventListener('click', click);
		press('ArrowRight');
		expect(click).not.toHaveBeenCalled();
	});

	it('works in a passage with no scene at all', () => {
		passage(`<p>Just prose. ${link('Cellar')}</p>`);
		const click = jest.fn();

		document.querySelector('passage-link')!.addEventListener('click', click);
		press('ArrowRight');
		expect(click).toHaveBeenCalled();
	});
});

describe('left arrow', () => {
	it('asks the scene for the previous line first', () => {
		passage('<sliders-stage></sliders-stage>');
		stage().backs = true;

		expect(press('ArrowLeft').defaultPrevented).toBe(true);
		expect(stage().steppedBack).toBe(1);
		expect(store.trail).toEqual(['Start', 'Hall']);
	});

	it('leaves the passage when the scene has no line behind it', () => {
		passage('<sliders-stage></sliders-stage>');
		stage().backs = false;

		expect(press('ArrowLeft').defaultPrevented).toBe(true);
		expect(store.trail).toEqual(['Start']);
	});

	it('leaves the passage from prose, where there is no scene to ask', () => {
		passage('<p>Just prose.</p>');

		expect(press('ArrowLeft').defaultPrevented).toBe(true);
		expect(store.trail).toEqual(['Start']);
	});

	it('leaves the browser its own gesture at the start of the story', () => {
		store.trail = ['Start'];
		passage('<p>Just prose.</p>');

		expect(press('ArrowLeft').defaultPrevented).toBe(false);
	});
});

describe('up and down', () => {
	it('walk the ways out, in reading order', () => {
		passage(link('Cellar') + link('Garden'));
		const [first, second] = [
			...document.querySelectorAll<HTMLElement>('passage-link')
		];

		press('ArrowDown');
		expect(document.activeElement).toBe(first);
		press('ArrowDown');
		expect(document.activeElement).toBe(second);
	});

	it('wrap, and start from the end going up', () => {
		passage(link('Cellar') + link('Garden'));
		const [first, second] = [
			...document.querySelectorAll<HTMLElement>('passage-link')
		];

		press('ArrowUp');
		expect(document.activeElement).toBe(second);
		press('ArrowUp');
		expect(document.activeElement).toBe(first);
		press('ArrowUp');
		expect(document.activeElement).toBe(second);
	});

	it('pick up a bubble link too', () => {
		passage(
			'<sliders-stage><a class="sliders-link" href="#" data-sliders-link="stay">stay</a></sliders-stage>' +
				link('Garden')
		);

		press('ArrowDown');
		expect(document.activeElement).toBe(
			document.querySelector('.sliders-link')
		);
	});
});

describe('enter', () => {
	// `<passage-link>` and the entity links listen for Enter themselves; pressing it for
	// them would navigate twice.
	it('is left to a link that is already focused', () => {
		passage(link('Cellar') + link('Garden'));
		document.querySelector<HTMLElement>('passage-link')!.focus();

		expect(press('Enter').defaultPrevented).toBe(false);
	});

	it('takes the only way out when nothing is focused', () => {
		passage(link('Cellar'));
		const click = jest.fn();

		document.querySelector('passage-link')!.addEventListener('click', click);
		expect(press('Enter').defaultPrevented).toBe(true);
		expect(click).toHaveBeenCalled();
	});
});

describe('shift+R', () => {
	it('starts the story over', () => {
		passage('<sliders-stage></sliders-stage>' + link('Cellar'));

		expect(press('R', {shiftKey: true}).defaultPrevented).toBe(true);
		expect(mockRestart).toHaveBeenCalled();
	});

	// Shift+R reaches us as "R" on a normal layout and as "r" with caps lock on. Both are
	// the reader pressing the same two keys.
	it('starts over with caps lock on too', () => {
		passage('<p>Just prose.</p>');

		press('r', {shiftKey: true});
		expect(mockRestart).toHaveBeenCalled();
	});

	it('leaves an unshifted R alone', () => {
		passage('<p>Just prose.</p>');

		expect(press('r').defaultPrevented).toBe(false);
		expect(mockRestart).not.toHaveBeenCalled();
	});

	// Ctrl+Shift+R is the browser's hard reload, and a reader who wants that means it.
	it("leaves the browser's own reload alone", () => {
		passage('<p>Just prose.</p>');

		expect(
			press('R', {ctrlKey: true, shiftKey: true}).defaultPrevented
		).toBe(false);
		expect(mockRestart).not.toHaveBeenCalled();
	});

	it('leaves a capital R being typed alone', () => {
		passage('<input type="text">');
		document.querySelector('input')!.focus();

		expect(press('R', {shiftKey: true}).defaultPrevented).toBe(false);
		expect(mockRestart).not.toHaveBeenCalled();
	});
});

describe('keys that are not ours', () => {
	it("leaves a modified arrow alone — that is the browser's history", () => {
		passage('<sliders-stage></sliders-stage>');

		expect(press('ArrowLeft', {altKey: true}).defaultPrevented).toBe(false);
		expect(store.trail).toEqual(['Start', 'Hall']);
	});

	it('leaves typing alone', () => {
		passage('<input type="text">');
		document.querySelector('input')!.focus();

		expect(press('ArrowLeft').defaultPrevented).toBe(false);
		expect(store.trail).toEqual(['Start', 'Hall']);
	});
});
