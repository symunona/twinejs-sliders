/**
 * Drives a real CodeMirror with the real show-hint addon, because the shape of
 * a completion object is a contract with the addon and nothing else checks it.
 * The unit tests around `sceneCompletion()` prove what's in the list; this
 * proves the list reaches the screen.
 */

// The repo stubs `codemirror` for every other suite (src/__mocks__/codemirror.ts).
// This one needs the real editor, or there is nothing to integrate with.
jest.unmock('codemirror');

import CodeMirror from 'codemirror';
import 'codemirror/addon/hint/show-hint';
import {AssetMeta, Character} from '@sliders/scene-types';
import {sceneCompletion} from '../use-scene-hints';
import {
	noteNameUsed,
	resetRecentNamesCache
} from '../../../util/sliders-recent-names';

const library = {
	all: [
		{
			animated: false,
			bytes: 1,
			h: 10,
			hash: 'street',
			id: 'a_street',
			kind: 'bg',
			mime: 'image/webp',
			name: 'street',
			tags: [],
			w: 10
		},
		{
			animated: false,
			bytes: 1,
			h: 10,
			hash: 'tavern-night',
			id: 'a_tavern',
			kind: 'bg',
			mime: 'image/webp',
			name: 'tavern-night',
			tags: [],
			w: 10
		}
	] as AssetMeta[],
	characters: [
		{
			frames: {idle: {asset: 'a_mira-idle'}},
			id: 'mira',
			name: 'mira',
			origin: {x: 0.5, y: 1},
			size: {h: 10, w: 10},
			tags: []
		}
	] as Character[]
};

/**
 * CodeMirror measures text by range, and jsdom has no layout, so these are
 * missing entirely. Zeroes are fine -- nothing here asserts on geometry.
 */
beforeAll(() => {
	const empty = () => ({
		bottom: 0,
		height: 0,
		left: 0,
		right: 0,
		top: 0,
		width: 0
	});

	Range.prototype.getBoundingClientRect = empty as never;
	Range.prototype.getClientRects = (() => ({item: () => null, length: 0})) as never;
});

function openHints(passage: string, cursor: {ch: number; line: number}) {
	const editor = CodeMirror(document.body, {value: passage});

	editor.setCursor(cursor);
	editor.showHint({
		completeSingle: false,
		hint: () => sceneCompletion(editor, library)
	});

	return editor;
}

describe('the scene hint dropdown', () => {
	beforeEach(() => {
		window.localStorage.clear();
		resetRecentNamesCache();
	});

	afterEach(() => {
		document.body.innerHTML = '';
	});

	it('renders the names the completion offers', () => {
		openHints('[scene]\nbg: ', {ch: 4, line: 1});

		const items = document.querySelectorAll('.CodeMirror-hint');

		expect([...items].map(item => item.textContent)).toEqual([
			'street',
			'tavern-night'
		]);
	});

	it('marks the names that have been used before', () => {
		noteNameUsed('bg', 'tavern-night');
		openHints('[scene]\nbg: ', {ch: 4, line: 1});

		const items = [...document.querySelectorAll('.CodeMirror-hint')];

		// Used names sort first, and only they carry the marker class.
		expect(items.map(item => item.textContent)).toEqual([
			'tavern-night',
			'street'
		]);
		expect(items.map(item => item.classList.contains('sliders-hint-recent'))).toEqual([
			true,
			false
		]);
	});

	it('shows nothing outside a scene block', () => {
		openHints('Just prose.', {ch: 5, line: 0});
		expect(document.querySelector('.CodeMirror-hints')).toBeNull();
	});

	it('prefills a picked entity and selects the at value', () => {
		const editor = openHints('[scene]\ncast:\n  mi', {ch: 4, line: 2});

		(document.querySelector('.CodeMirror-hint') as HTMLElement).click();

		expect(editor.getValue()).toBe(
			'[scene]\ncast:\n  mira: {at: 0, layer: mid}'
		);
		// The next thing typed should replace the position, not sit after the
		// closing brace.
		expect(editor.getSelection()).toBe('0');

		editor.replaceSelection('-0.4');
		expect(editor.getValue()).toBe(
			'[scene]\ncast:\n  mira: {at: -0.4, layer: mid}'
		);
	});

	it('replaces the token and remembers the pick', () => {
		const editor = openHints('[scene]\nbg: tav', {ch: 7, line: 1});

		(document.querySelector('.CodeMirror-hint') as HTMLElement).click();

		expect(editor.getValue()).toBe('[scene]\nbg: tavern-night');
		expect(
			JSON.parse(window.localStorage.getItem('sliders-recent-names')!)
		).toEqual({bg: ['tavern-night']});
	});
});
