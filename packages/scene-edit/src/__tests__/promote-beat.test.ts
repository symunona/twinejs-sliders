/**
 * Promoting a bare dialogue beat to map form, when the dialogue does not fit a flow map.
 *
 * `- bob: "Hi."` promotes inline; a `|` block and a plain scalar holding a `,` cannot,
 * and used to be spliced into `{say: …}` anyway — which produced YAML that parsed into
 * a beat saying `|`, or a beat with a key called `world`.
 */

import {parseScene} from '@sliders/scene-schema';
import {applyEdit} from '../index';
import {setBeatBubble, setBeatKey, setEntityKey} from '../write';

function moved(text: string, beat = 0) {
	const out = setEntityKey(text, {beat, id: 'bob', kind: 'cast'}, 'at', [
		0.1, 0
	]);

	return out ? applyEdit(text, out) : undefined;
}

/** What the parser makes of the result: the only thing the author sees. */
function said(text: string, beat = 0) {
	const result = parseScene(text);

	return {
		errors: result.errors.map(error => error.message),
		text: (result.scene.beats[beat] as {text?: string} | undefined)?.text
	};
}

const BLOCK = [
	'id: x',
	'cast:',
	'  bob: {at: -0.4}',
	'beats:',
	'  - bob: |',
	'      [[Pub->pub]] or [[Walk->walk]]?',
	''
].join('\n');

describe('a block scalar beat', () => {
	it('promotes to block form, keeping the dialogue verbatim', () => {
		expect(moved(BLOCK)).toBe(
			[
				'id: x',
				'cast:',
				'  bob: {at: -0.4}',
				'beats:',
				'  - bob:',
				'      say: |',
				'        [[Pub->pub]] or [[Walk->walk]]?',
				'      at: [0.1, 0]',
				''
			].join('\n')
		);
	});

	it('parses back to the same line, with no errors', () => {
		expect(said(moved(BLOCK)!)).toEqual({
			errors: [],
			text: '[[Pub->pub]] or [[Walk->walk]]?\n'
		});
	});

	it('keeps relative indentation inside the block', () => {
		const text = [
			'cast:',
			'  bob: {at: -0.4}',
			'beats:',
			'  - bob: |',
			'      One.',
			'        Two, indented.',
			''
		].join('\n');

		expect(moved(text)).toBe(
			[
				'cast:',
				'  bob: {at: -0.4}',
				'beats:',
				'  - bob:',
				'      say: |',
				'        One.',
				'          Two, indented.',
				'      at: [0.1, 0]',
				''
			].join('\n')
		);
	});

	it('promotes the same way for a beat key and for a bubble', () => {
		expect(applyEdit(BLOCK, setBeatKey(BLOCK, 0, 'dur', 1.5)!)).toContain(
			'      say: |\n        [[Pub->pub]] or [[Walk->walk]]?\n      dur: 1.5'
		);
		expect(applyEdit(BLOCK, setBeatBubble(BLOCK, 0, {as: 'yell'})!)).toContain(
			'      bubble: {as: yell}'
		);
		expect(said(applyEdit(BLOCK, setBeatKey(BLOCK, 0, 'dur', 1.5)!))).toEqual({
			errors: [],
			text: '[[Pub->pub]] or [[Walk->walk]]?\n'
		});
	});

	it('promotes a narration box under `text:`', () => {
		const text = ['beats:', '  - box: |', '      The candle gutters.', ''].join(
			'\n'
		);

		expect(applyEdit(text, setBeatKey(text, 0, 'dur', 2)!)).toBe(
			[
				'beats:',
				'  - box:',
				'      text: |',
				'        The candle gutters.',
				'      dur: 2',
				''
			].join('\n')
		);
	});
});

describe('a plain scalar beat', () => {
	it('promotes to block form when the text holds a flow indicator', () => {
		const text = [
			'cast:',
			'  bob: {at: -0.4}',
			'beats:',
			'  - bob: Hello, world',
			''
		].join('\n');

		expect(moved(text)).toBe(
			[
				'cast:',
				'  bob: {at: -0.4}',
				'beats:',
				'  - bob:',
				'      say: Hello, world',
				'      at: [0.1, 0]',
				''
			].join('\n')
		);
		expect(said(moved(text)!)).toEqual({errors: [], text: 'Hello, world'});
	});

	it('still promotes inline when the text is one safe line', () => {
		const text = [
			'cast:',
			'  bob: {at: -0.4}',
			'beats:',
			'  - bob: "Hi."',
			''
		].join('\n');

		expect(moved(text)).toBe(
			[
				'cast:',
				'  bob: {at: -0.4}',
				'beats:',
				'  - bob: {say: "Hi.", at: [0.1, 0]}',
				''
			].join('\n')
		);
	});

	it('keeps a quoted comma inline', () => {
		const text = ['beats:', '  - bob: "Hello, world"', ''].join('\n');

		expect(applyEdit(text, setBeatKey(text, 0, 'dur', 1)!)).toBe(
			['beats:', '  - bob: {say: "Hello, world", dur: 1}', ''].join('\n')
		);
	});
});
