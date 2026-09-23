/**
 * Ragged `|` blocks: one error naming the indent, not the pile YAML reports.
 *
 * The pure scan is `raggedBlockLines`; `parseScene` is what replaces the cascade with it,
 * so both are exercised here.
 */

import {raggedBlockLines} from '../block-scalar';
import {parseScene} from '../parse-scene';

/** Apply an error's fix, the way the passage editor's `handleApplyFix` does. */
function applyFix(text: string, fix: NonNullable<ReturnType<typeof firstFix>>): string {
	const lines = text.split('\n');
	const line = lines[fix.line - 1];
	const from = fix.col - 1;
	const to = (fix.endCol ?? fix.col) - 1;

	expect(line.slice(from, to)).toBe(fix.replaces);
	lines[fix.line - 1] = line.slice(0, from) + fix.text + line.slice(to);

	return lines.join('\n');
}

function firstFix(text: string) {
	return parseScene(text).errors[0]?.fix;
}

describe('raggedBlockLines', () => {
	it('flags a line indented less than the block above it', () => {
		const ragged = raggedBlockLines(
			['beats:', '  - bob: |', '        one', '      two', ''].join('\n')
		);

		expect(ragged).toEqual([
			{
				blockIndent: 8,
				col: 7,
				indentText: '      ',
				key: 'bob',
				line: 4
			}
		]);
	});

	it('leaves a clean block alone, however deep', () => {
		expect(
			raggedBlockLines(
				['beats:', '  - bob: |', '        one', '          two', ''].join('\n')
			)
		).toEqual([]);
	});

	it('lets a sibling key end the block', () => {
		expect(
			raggedBlockLines(
				['cast:', '  bob:', '    say: |', '      hello', '    pose: idle', ''].join(
					'\n'
				)
			)
		).toEqual([]);
	});

	it('keeps the block open across a blank line', () => {
		expect(
			raggedBlockLines(
				['beats:', '  - bob: |', '      one', '', '      two', ''].join('\n')
			)
		).toEqual([]);
	});

	it('reads folded and chomped headers, and one with a comment', () => {
		for (const header of ['>', '>-', '|+', '|2', '| # why']) {
			expect(
				raggedBlockLines(
					['beats:', `  - bob: ${header}`, '        one', '      two', ''].join('\n')
				)
			).toHaveLength(1);
		}
	});

	it('is not fooled by a value that merely contains an indicator', () => {
		expect(
			raggedBlockLines(
				['beats:', '  - bob: "[[Pub->pub]]"', '        one', '      two', ''].join('\n')
			)
		).toEqual([]);
	});

	it('reports every stray line in one block', () => {
		expect(
			raggedBlockLines(
				['beats:', '  - bob: |', '        one', '      two', '      three', ''].join(
					'\n'
				)
			).map(entry => entry.line)
		).toEqual([4, 5]);
	});
});

describe('parseScene, ragged block', () => {
	const text = [
		'id: x',
		'beats:',
		'  - bob: |',
		'          [[Pub->pub]] ',
		'        [[Walk->walk]]?',
		''
	].join('\n');

	it('replaces the YAML cascade with one error', () => {
		const {errors} = parseScene(text);

		expect(errors).toHaveLength(1);
		expect(errors[0].line).toBe(5);
		expect(errors[0].message).toContain('`bob:`');
		expect(errors[0].hint).toContain('column 11');
	});

	it('offers a fix that re-indents the line', () => {
		const fix = firstFix(text);

		expect(fix).toBeDefined();
		expect(fix!.replaces).toBe('        ');
		expect(fix!.text).toBe('          ');

		const fixed = applyFix(text, fix!);
		const {errors, scene} = parseScene(fixed);

		expect(errors).toEqual([]);
		expect(scene.beats[0]).toMatchObject({
			kind: 'say',
			text: '[[Pub->pub]] \n[[Walk->walk]]?\n',
			who: 'bob'
		});
	});

	it('still reports problems on other lines', () => {
		const {errors} = parseScene(
			['id: x', 'bgg: hall', 'beats:', '  - bob: |', '        one', '      two', ''].join(
				'\n'
			)
		);

		expect(errors.map(error => error.line)).toEqual([2, 6]);
	});
});
