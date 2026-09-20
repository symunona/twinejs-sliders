/**
 * `scanVarsLines` is RUNTIME TRUTH, so these are characterization tests, not wishes.
 *
 * Every case here is what `format/src/runtime/template/parse.ts` did before it was made to
 * read this module instead. The ugly ones are the point: a tidy-up that narrows the grammar
 * would stop setting a variable in stories already published, and nothing else in the suite
 * would notice. If a case below looks wrong, it is still what the player does — change the
 * player and this together, deliberately, or not at all.
 */

import {
	scanVarsLines,
	splitVarsSection,
	varsConditionError,
	varsConditionSource,
	varsValueError,
	varsValueErrors,
	varsValueSource
} from '../vars-section';

describe('splitVarsSection', () => {
	it('splits at the separator and keeps the body whole', () => {
		expect(splitVarsSection('a: 1\n--\nHello.')).toEqual({
			body: '\nHello.',
			vars: 'a: 1\n'
		});
	});

	it('is undefined when there is no separator', () => {
		expect(splitVarsSection('Just prose.')).toBeUndefined();
		// `---` is a Markdown rule, not a separator. That rule is the module's oldest.
		expect(splitVarsSection('a: 1\n---\nHello.')).toBeUndefined();
	});

	/**
	 * The one case in this file that is a DEFECT rather than a grammar quirk.
	 *
	 * Everywhere else here, narrowing the rule would stop setting a variable in a story
	 * already published — so the ugly answer is the right one to pin. Not here. `String
	 * .split(re, 2)` runs a FULL split and then throws away every piece past the second,
	 * so a passage whose prose contains a bare `--` line silently loses the rest of
	 * itself. `format/src/runtime/template/parse.ts:58` does the same thing, so this is
	 * live in the player, not only in the editor.
	 *
	 * Fixing it can only ever make text appear that the author wrote and expected. No
	 * story can depend on the loss, which is why this one gets an `it.failing` and the
	 * rest of the file does not.
	 */
	it('takes the vars half from the FIRST separator', () => {
		// True whichever way the tail is handled — the split point does not move.
		const split = splitVarsSection('a: 1\n--\nfirst\n--\nsecond');

		expect(split?.vars).toBe('a: 1\n');
		expect(split?.body?.startsWith('\nfirst')).toBe(true);
	});

	/**
	 * FAILING ON PURPOSE — this states the fix, not the bug.
	 *
	 * `it.failing` passes only while the assertion below does NOT hold, so it documents
	 * the data loss today and turns RED the moment someone fixes it. When that happens
	 * the answer is to flip it to `it`, never to soften the assertion.
	 *
	 * The fix is one line in `splitVarsSection`: split on the first separator only and
	 * keep the remainder whole (`indexOf` + `slice`, or rejoin parts 1..n). The player's
	 * `parse.ts` must change in the same commit — it holds a second copy of the call.
	 */
	it.failing('keeps the whole body when the prose contains another `--` line', () => {
		const split = splitVarsSection('a: 1\n--\nfirst\n--\nsecond');

		expect(split?.body).toBe('\nfirst\n--\nsecond');
	});
});

describe('scanVarsLines', () => {
	function names(text: string) {
		return scanVarsLines(text).declarations.map(d => `${d.name}=${d.value}`);
	}

	it('reads the ordinary forms', () => {
		expect(names('has_weapon: true\nmood: \'tense\'\nsliders.autoAdvance: 0')).toEqual([
			'has_weapon=true',
			"mood='tense'",
			'sliders.autoAdvance=0'
		]);
	});

	it('splits on the FIRST colon, so a value may hold more', () => {
		expect(names('when: 12:30')).toEqual(['when=12:30']);
		expect(names('url: https://example.com')).toEqual([
			'url=https://example.com'
		]);
	});

	it('accepts a name that is not identifier-shaped', () => {
		// The editor heuristic (`VARS_LINE_RE`) refuses this; the runtime does not, and the
		// runtime is what the reader gets.
		expect(names('my name: 1')).toEqual(['my name=1']);
	});

	it('takes a (condition) out of the name', () => {
		const [declaration] = scanVarsLines('has_weapon (visited): true').declarations;

		expect(declaration).toMatchObject({
			condition: '(visited)',
			name: 'has_weapon',
			value: 'true'
		});
	});

	it('matches a condition greedily, the way the runtime does', () => {
		expect(scanVarsLines('a (b) (c): 1').declarations[0]).toMatchObject({
			condition: '(b) (c)',
			name: 'a'
		});
	});

	it('skips blank lines and reports the line number of the rest', () => {
		expect(scanVarsLines('\na: 1\n\nb: 2').declarations.map(d => d.line)).toEqual([
			2, 4
		]);
	});

	it('ignores a line with no colon, and says so', () => {
		const scan = scanVarsLines('a: 1\njust prose\nb: 2');

		expect(scan.declarations).toHaveLength(2);
		expect(scan.ignored).toEqual([
			{line: 2, reason: 'no-colon', text: 'just prose'}
		]);
	});

	it('ignores a name that is entirely a condition instead of throwing', () => {
		// The runtime guarded with `if (!condMatch.index)`, and index 0 is falsy — so this
		// threw and took the whole passage with it. Reported now, the way its colonless
		// neighbour always was.
		const scan = scanVarsLines('(visited): 1');

		expect(scan.declarations).toHaveLength(0);
		expect(scan.ignored[0]).toMatchObject({reason: 'no-name'});
	});

	it('keeps an empty value rather than dropping the line', () => {
		// It is broken — `return ()` does not compile — but the runtime builds the
		// declaration and throws on compile, so the lint is what should report it.
		expect(names('a:')).toEqual(['a=']);
	});

	it('carries the line verbatim, for a fix to rewrite', () => {
		expect(scanVarsLines('  a: 1  ').declarations[0].text).toBe('  a: 1  ');
	});
});

describe('the source the runtime compiles', () => {
	it('is one spelling, so a checker cannot disagree with it', () => {
		expect(varsValueSource('true')).toBe('return (true)');
		expect(varsConditionSource('(visited)')).toBe('return !!((visited))');
	});
});

describe('varsValueError', () => {
	it('passes every value a story legitimately writes', () => {
		for (const value of [
			'true',
			'false',
			"'tense'",
			'"x"',
			'0.5',
			'[800, 300]',
			'{a: 1}',
			'has_weapon',
			'1 + 2',
			'config.testing'
		]) {
			expect(varsValueError(value)).toBeUndefined();
		}
	});

	it('catches the unquoted multi-word value that ships a broken passage', () => {
		// `name: Take The Key` — how `twine-cli put --new` once wrote front matter into a
		// passage body. The player compiles every value as the passage parses, so this one
		// line took the whole passage down and showed the reader nothing but "an unexpected
		// error has occurred".
		expect(varsValueError('Take The Key')).toMatch(/Unexpected identifier/);
	});

	it('catches an empty value', () => {
		expect(varsValueError('')).toBeDefined();
	});

	it('does not RUN the value', () => {
		const before = (globalThis as {__ranVarsValue?: boolean}).__ranVarsValue;

		expect(
			varsValueError('(globalThis.__ranVarsValue = true)')
		).toBeUndefined();
		expect((globalThis as {__ranVarsValue?: boolean}).__ranVarsValue).toBe(
			before
		);
	});

	it('checks a condition the same way', () => {
		expect(varsConditionError('(visited)')).toBeUndefined();
		expect(varsConditionError('(a b)')).toBeDefined();
	});
});

describe('varsValueErrors', () => {
	it('says nothing about a passage with no vars section', () => {
		expect(varsValueErrors('Just prose.\n')).toEqual([]);
	});

	it('points at the value, not at the line or the colon', () => {
		const [error] = varsValueErrors('name: Take The Key\n--\nx');

		expect(error).toMatchObject({code: 'vars-value', line: 1, severity: 'error'});
		// `name: ` is six characters, so the value opens at column 7.
		expect(error.col).toBe(7);
		// The message names the VARIABLE and the compiler's reason; the value is in the
		// hint, next to the repair. The squiggle is already sitting on the value.
		expect(error.message).toMatch(/'name'/);
		expect(error.message).toMatch(/Unexpected identifier/);
		expect(error.hint).toMatch(/Take The Key/);
	});

	it('finds the value past any amount of space', () => {
		expect(varsValueErrors('c:    Two Words\n--\nx')[0].fix?.replaces).toBe(
			'Two Words'
		);
	});

	it('offers to quote a phrase', () => {
		const [error] = varsValueErrors('name: Take The Key\n--\nx');

		expect(error.fix).toMatchObject({
			replaces: 'Take The Key',
			text: '"Take The Key"'
		});
	});

	it('offers NOTHING for a half-written expression', () => {
		// Quoting would "work" — and would turn a broken array into the string "[1,".
		expect(varsValueErrors('b: [1,\n--\nx')[0].fix).toBeUndefined();
		expect(varsValueErrors('a:\n--\nx')[0].fix).toBeUndefined();
	});

	it('reports the line within the passage, vars being at the top', () => {
		expect(varsValueErrors('ok: 1\nbad: two words\n--\nx')[0].line).toBe(2);
	});
});
