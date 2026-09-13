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

describe('values inside a scene', () => {
	/** The style of a value, as one token, given the line that holds it. */
	function valueOf(line: string) {
		const tokens = tokenize(['[scene]', line].join('\n'));

		// Drop `[scene]`, the key and its colon.
		return tokens.slice(3);
	}

	it('reads a plain scalar as one string, however number-ish it looks', () => {
		expect(valueOf('  back: 04 some passage')).toEqual([
			['04 some passage', 'string']
		]);
		expect(valueOf('  - mira: it costs 5 gold, ok?').slice(1)).toEqual([
			['it costs 5 gold, ok?', 'string']
		]);
	});

	it('leaves a time of day alone inside dialogue', () => {
		// `12:30` has no space after its colon, so the key lookahead cannot claim it, and
		// the value it sits in is one string anyway.
		expect(valueOf('  - mira: meet me at 12:30').slice(1)).toEqual([
			['meet me at 12:30', 'string']
		]);
		expect(stylesOf(['[scene]', '  - mira: at 12:30'].join('\n'), '12')).toEqual(
			[]
		);
	});

	it('still numbers a value that is exactly a number', () => {
		expect(valueOf('z: 3')).toEqual([['3', 'number']]);
		expect(valueOf('  - wait: 0.5').slice(1)).toEqual([['0.5', 'number']]);
		expect(valueOf('  scale: 1.5')).toEqual([['1.5', 'number']]);
		expect(valueOf('  at: -0.4')).toEqual([['-0.4', 'number']]);
	});

	it('still atoms a value that is exactly an atom', () => {
		expect(valueOf('bg: ~')).toEqual([['~', 'atom']]);
		expect(valueOf('  if: true')).toEqual([['true', 'atom']]);
		expect(valueOf('  if: false')).toEqual([['false', 'atom']]);
		expect(valueOf('  frame: @idle')).toEqual([['@idle', 'atom']]);
	});

	it('still types every part of a flow value', () => {
		expect(valueOf('  at: [123, 432]')).toEqual([
			['[', null],
			['123', 'number'],
			[',', null],
			['432', 'number'],
			[']', null]
		]);

		expect(valueOf('  lamp: {at: [1, 2], z: 3}')).toEqual([
			['{', null],
			['at', 'keyword'],
			[':', null],
			['[', null],
			['1', 'number'],
			[',', null],
			['2', 'number'],
			[']', null],
			[',', null],
			['z', 'keyword'],
			[':', null],
			['3', 'number'],
			['}', null]
		]);
	});

	it('still comments, quotes and links', () => {
		expect(stylesOf(['[scene]', '# whole line'].join('\n'), '# whole line')).toEqual(
			['comment']
		);
		expect(
			stylesOf(['[scene]', 'camera: {zoom: 1} # after'].join('\n'), '# after')
		).toEqual(['comment']);
		expect(valueOf('  - box: "Hi there"').slice(1)).toEqual([
			['"Hi there"', 'string']
		]);
		expect(
			stylesOf(['[scene]', '  to: [[wiki link]]'].join('\n'), '[[wiki link]]')
		).toEqual(['link']);
	});

	it('hands a trailing comment back, even after a plain scalar', () => {
		expect(valueOf('bg: tavern # the good one')).toEqual([
			['tavern', 'string'],
			['# the good one', 'comment']
		]);

		// YAML opens a comment only after whitespace, so an unspaced `#` stays in the value.
		expect(valueOf('  - mira: it costs 5#5 gold').slice(1)).toEqual([
			['it costs 5#5 gold', 'string']
		]);

		expect(valueOf('  z: 3 # still a number')).toEqual([
			['3', 'number'],
			['# still a number', 'comment']
		]);
	});

	it('reads a digit-leading link name as a key', () => {
		const tokens = tokenize(['[scene]', 'links:', '  04 foo: Elsewhere'].join('\n'));

		expect(tokens).toContainEqual(['04 foo', 'def']);
		expect(tokens).toContainEqual(['Elsewhere', 'string']);
	});

	it('still errors an unknown top-level key, whatever follows it', () => {
		expect(stylesOf(['[scene]', 'notakey: 04 words here'].join('\n'), 'notakey')
		).toEqual(['error']);
		expect(stylesOf(['[scene]', '04key: 1'].join('\n'), '04key')).toEqual([
			'error'
		]);
	});

	it('starts each line with no value in progress', () => {
		// `id:` opens a value, but the next line is its own key again.
		const tokens = tokenize(['[scene]', 'id: alley', 'z: 3'].join('\n'));

		expect(tokens).toContainEqual(['id', 'keyword']);
		expect(tokens).toContainEqual(['alley', 'string']);
		expect(tokens).toContainEqual(['3', 'number']);
	});
});
