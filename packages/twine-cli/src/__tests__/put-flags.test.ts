/** @jest-environment node */
/**
 * `put` flags that used to be taken at their word: a repeated `--delete` kept only the last
 * name, and `--kind obj` — the spelling the docs used — was stored as a kind nothing knows.
 */
import {parseArgs} from '../args';
import {assetKind, run} from '../cmd/put';
import {CliError, EXIT} from '../types';
import type {Ctx, StoryBody, StoryMeta} from '../types';

describe('parseArgs', () => {
	it('collects every --delete, in order', () => {
		const {args, flags} = parseArgs([
			'put',
			'ep3',
			'--all',
			'tmp/ep3',
			'--delete',
			'A',
			'--delete=B'
		]);

		expect(args).toEqual(['ep3', 'tmp/ep3']);
		expect(flags.delete).toEqual(['A', 'B']);
		expect(flags.all).toBe(true);
	});

	it('keeps other value flags last-wins', () => {
		expect(parseArgs(['ls', '--sort', 'rev', '--sort', 'name']).flags.sort).toBe('name');
	});
});

describe('assetKind', () => {
	it('reads obj as object', () => {
		expect(assetKind('obj')).toBe('object');
	});

	it('passes every stored kind through', () => {
		for (const kind of ['bg', 'object', 'frame', 'fx', 'sound']) {
			expect(assetKind(kind)).toBe(kind);
		}
	});

	it('refuses a kind nothing knows', () => {
		expect(() => assetKind('prop')).toThrow(CliError);
	});
});

describe('put --delete', () => {
	const meta = {id: 's1', name: 'Ep', rev: 7} as StoryMeta;
	const body = {
		name: 'Ep',
		passages: ['A', 'B', 'C'].map(name => ({name, text: ''}))
	} as unknown as StoryBody;

	function fakeCtx(flags: Ctx['flags']) {
		const written: StoryBody[] = [];
		const ctx = {
			flags,
			out: () => undefined,
			source: {body: async () => body, list: async () => [meta]},
			write: {
				putStory: async (_id: string, next: StoryBody) => {
					written.push(next);
					return {rev: 8};
				}
			}
		} as unknown as Ctx;

		return {ctx, written};
	}

	it('removes every named passage in one write', async () => {
		const {ctx, written} = fakeCtx({delete: ['A', 'B']});

		expect(await run(ctx, ['Ep'])).toBe(EXIT.ok);
		expect(written).toHaveLength(1);
		expect(written[0].passages?.map(passage => passage.name)).toEqual(['C']);
	});

	it('writes nothing when one name is unknown', async () => {
		const {ctx, written} = fakeCtx({delete: ['A', 'Nope']});

		await expect(run(ctx, ['Ep'])).rejects.toThrow('passage "Nope" is not in "Ep"');
		expect(written).toEqual([]);
	});
});
