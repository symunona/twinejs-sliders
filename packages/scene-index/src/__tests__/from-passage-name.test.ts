/**
 * `from:` by passage name, and the hole that hid the bug report behind it.
 *
 * Reported: a passage called `official-landing-template` set a `bg:`, a second passage
 * wrote `from: official-landing-template`, and nothing merged — with NO error anywhere.
 * Scene ids are gone since: a passage name is the only address a scene has.
 */

import {buildSceneIndex} from '../index';

const TEMPLATE = ['TEMPLATE', '', '[scene]', 'bg: desert-landing', ''].join(
	'\n'
);
const PATCH = [
	'Drone landing.',
	'',
	'[scene]',
	'from: official-landing-template',
	'props:',
	'  drone: {at: [0.1, 0.2]}',
	''
].join('\n');

describe('from: across passages', () => {
	it('inherits the template bg when from: names a passage', () => {
		const index = buildSceneIndex([
			{name: 'official-landing-template', text: TEMPLATE},
			{name: 'official landing', text: PATCH}
		]);

		expect(index.errors).toEqual([]);

		const stage = index.resolve('official landing');

		expect(stage?.bg).toBe('desert-landing');
		expect(Object.keys(stage?.entities ?? {})).toEqual(['drone']);
	});

	it('reports an unresolvable from:', () => {
		const index = buildSceneIndex([{name: 'official landing', text: PATCH}]);

		expect(index.errors.map(error => error.code)).toEqual(['unknown-from']);
		expect(index.errors[0].message).toContain('official-landing-template');
	});

	it('matches a passage name case-insensitively, the way a link does', () => {
		const index = buildSceneIndex([
			{name: 'Official Landing Template', text: '[scene]\nbg: oasis\n'},
			{name: 'after', text: '[scene]\nfrom: official landing template\n'}
		]);

		expect(index.errors).toEqual([]);
		expect(index.resolve('after')?.bg).toBe('oasis');
	});

	it('catches a cycle built out of passage names', () => {
		const index = buildSceneIndex([
			{name: 'a', text: '[scene]\nfrom: b\n'},
			{name: 'b', text: '[scene]\nfrom: a\n'}
		]);

		expect(index.errors.map(error => error.code)).toContain('from-cycle');
	});

	it('names a scene by its passage in a cycle message', () => {
		const index = buildSceneIndex([
			{name: 'a', text: '[scene]\nfrom: b\n'},
			{name: 'b', text: '[scene]\nfrom: a\n'}
		]);

		expect(index.errors[0].message).toContain('a -> b -> a');
	});
});
