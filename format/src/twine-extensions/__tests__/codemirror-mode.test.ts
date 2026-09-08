import type CodeMirrorTypes from 'codemirror';
import {mode} from '../codemirror-mode';

// A real editor needs layout APIs jsdom does not have, so the mode is driven directly
// over a `StringStream` instead. That is what CodeMirror itself does with it.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const CodeMirror: typeof CodeMirrorTypes = require('codemirror/lib/codemirror.js');

/** Every non-blank token of a passage, as `[text, style]` pairs. */
function tokenize(text: string): [string, string | null][] {
	const lines = text.split('\n');
	const passageMode = mode();
	const state = passageMode.startState!();
	const result: [string, string | null][] = [];

	for (let i = 0; i < lines.length; i++) {
		if (lines[i] === '') {
			passageMode.blankLine?.(state);
			continue;
		}

		const stream = new (CodeMirror as any).StringStream(lines[i], 4, {
			// Chapbook's mode scans ahead for the `--` that ends a vars section.
			lookAhead: (n: number) => lines[i + n]
		});

		while (!stream.eol()) {
			const style = passageMode.token!(stream, state);

			if (stream.pos === stream.start) {
				throw new Error(`The mode did not advance on line ${i + 1}.`);
			}

			if (stream.current().trim() !== '') {
				result.push([stream.current(), style ?? null]);
			}

			stream.start = stream.pos;
		}
	}

	return result;
}

/** The styles every token whose text is exactly `needle` was given. */
function stylesOf(text: string, needle: string) {
	return tokenize(text)
		.filter(([string]) => string === needle)
		.map(([, style]) => style);
}

describe('the Chapbook half of the mode', () => {
	it('still styles modifiers and links', () => {
		const text = ['[note]', 'Text [[Link]]'].join('\n');

		expect(stylesOf(text, '[note]')).toEqual(['keyword']);
		expect(stylesOf(text, '[[Link]]')).toEqual(['link']);
	});

	it('still styles a vars section', () => {
		expect(stylesOf(['color: red', '--', 'Body'].join('\n'), 'color:')).toEqual([
			'def'
		]);
	});
});

describe('the scene half of the mode', () => {
	const scene = [
		'[scene]',
		'id: alley',
		'camera: {at: [0, 0], zoom: 1}',
		'notakey: 1',
		'cast:',
		'  mira: {at: -0.4, frame: idle}',
		'# a comment',
		'[continued]',
		'After.'
	].join('\n');

	it('styles a known top-level key as a keyword', () => {
		expect(stylesOf(scene, 'id')).toEqual(['keyword']);
		expect(stylesOf(scene, 'camera')).toEqual(['keyword']);
		expect(stylesOf(scene, 'cast')).toEqual(['keyword']);
	});

	it('styles an unknown top-level key as an error', () => {
		expect(stylesOf(scene, 'notakey')).toEqual(['error']);
	});

	it('styles an entity id as a definition and its keys as keywords', () => {
		expect(stylesOf(scene, 'mira')).toEqual(['def']);
		expect(stylesOf(scene, 'at')).toEqual(['keyword', 'keyword']);
		expect(stylesOf(scene, 'frame')).toEqual(['keyword']);
	});

	it('styles comments and numbers', () => {
		expect(stylesOf(scene, '# a comment')).toEqual(['comment']);
		expect(stylesOf(scene, '-0.4')).toEqual(['number']);
	});

	it('leaves the block at the next modifier', () => {
		expect(stylesOf(scene, '[continued]')).toEqual(['keyword']);
		expect(stylesOf(scene, 'After.')).toEqual(['text']);
	});

	it('styles a beat command as an atom', () => {
		const beats = ['[scene]', 'beats:', '  - box: "Hi"', '  - wait: 0.5'].join(
			'\n'
		);

		expect(stylesOf(beats, 'box')).toEqual(['atom']);
		expect(stylesOf(beats, 'wait')).toEqual(['atom']);
	});

	it('does not treat another modifier as a scene', () => {
		expect(stylesOf(['[note]', 'notakey: 1'].join('\n'), 'notakey')).not.toEqual([
			'error'
		]);
	});
});
