/**
 * The player's half of the vars split.
 *
 * `parse()` is what the READER gets, and it held its own copy of the vars-section split
 * for as long as there was one — which is how `split(sep, 2)` shipped the same data loss
 * twice. `packages/scene-schema/src/__tests__/vars-lines.test.ts` guards the editor's
 * half; this file guards the player's, so a repair to one that misses the other is red
 * here rather than live for a reader.
 */

// The logger's barrel drags in `logger/init.ts`, which reads `event.detail` off a plain
// `Event` and only typechecks under the format's OWN tsconfig (it has the ambient
// `custom-events.d.ts`; the jest tsconfig does not, and widening that one pulls in a
// dozen unrelated errors from the format's separate dependency tree). Stub the barrel:
// `parse` wants two log functions and nothing else.
jest.mock('../../logger', () => ({
	createLoggers: () => ({log: jest.fn(), warn: jest.fn()})
}));

import {parse} from '../parse';

function text(source: string) {
	return parse(source)
		.blocks.filter(block => block.type === 'text')
		.map(block => block.content);
}

function varNames(source: string) {
	return parse(source).vars.map(declaration => declaration.name);
}

describe('parse', () => {
	it('reads a vars section and the body under it', () => {
		const result = parse('a: 1\nb: 2\n--\nHello.');

		expect(result.vars.map(v => v.name)).toEqual(['a', 'b']);
		expect(result.vars.map(v => v.value())).toEqual([1, 2]);
		expect(result.blocks).toEqual([{content: 'Hello.', type: 'text'}]);
	});

	it('treats a passage with no separator as all body', () => {
		expect(text('Just prose.')).toEqual(['Just prose.']);
		expect(varNames('Just prose.')).toEqual([]);
	});

	it('treats `---` as prose, never as a separator', () => {
		// A Markdown horizontal rule. Accepting it would turn the prose above any scene
		// break in any Chapbook story into variable declarations.
		expect(text('Above.\n---\nBelow.')).toEqual(['Above.\n---\nBelow.']);
		expect(varNames('a: 1\n---\nBelow.')).toEqual([]);
	});

	/**
	 * THE REGRESSION. `src.split(opts.varsSep, 2)` ran a full split and dropped every
	 * piece past the second, so a bare `--` line in the PROSE truncated the passage in
	 * the reader's browser. Everything the author wrote below it simply never rendered.
	 *
	 * Never soften this. A passage is allowed to contain as many `--` lines as it likes;
	 * only the first one closes the vars section.
	 */
	it('keeps prose below a second `--` line', () => {
		const result = parse('a: 1\n--\nfirst\n--\nsecond');

		expect(varNames('a: 1\n--\nfirst\n--\nsecond')).toEqual(['a']);
		expect(result.blocks).toEqual([
			{content: 'first\n--\nsecond', type: 'text'}
		]);
	});

	it('keeps prose below a `--` line when there is no vars section at all', () => {
		// The first separator closes an EMPTY vars section here, which is what the player
		// has always done. What must not happen is the tail going missing.
		const result = parse('--\nfirst\n--\nsecond');

		expect(result.vars).toEqual([]);
		expect(result.blocks).toEqual([
			{content: 'first\n--\nsecond', type: 'text'}
		]);
	});

	it('still finds modifiers below a second `--` line', () => {
		// The truncation did not merely hide text, it hid MODIFIERS: everything below the
		// second separator was never scanned, so an [align center] there did nothing.
		expect(parse('a: 1\n--\nfirst\n--\n[align center]\nsecond').blocks).toEqual([
			{content: 'first\n--', type: 'text'},
			{content: 'align center', type: 'modifier'},
			{content: 'second', type: 'text'}
		]);
	});

	it('sets a variable only when its (condition) holds', () => {
		const [declaration] = parse('a (false): 1\n--\nx').vars;

		expect(declaration.condition?.()).toBe(false);
	});

	it('parses two passages independently', () => {
		// The separator lives in module scope. A stateful regexp would make the second
		// call split somewhere else, or not at all.
		expect(text('a: 1\n--\none')).toEqual(['one']);
		expect(text('a: 1\n--\ntwo')).toEqual(['two']);
	});
});
