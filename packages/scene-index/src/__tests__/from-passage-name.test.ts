/**
 * `from:` by passage name, and the hole that hid the bug report behind it.
 *
 * Reported: a passage called `official-landing-template` set a `bg:`, a second passage
 * wrote `from: official-landing-template`, and nothing merged — with NO error anywhere.
 * Two separate faults met: the template had no `id:` so it could not be a target, and
 * the patch scene had no `id:` either, so the index skipped it and never checked its
 * `from:` at all.
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
	it('inherits the template bg when from: names a passage with no scene id', () => {
		const index = buildSceneIndex([
			{name: 'official-landing-template', text: TEMPLATE},
			{name: 'official landing', text: PATCH}
		]);

		expect(index.errors).toEqual([]);

		const stage = index.resolve('official landing');

		expect(stage?.bg).toBe('desert-landing');
		expect(Object.keys(stage?.entities ?? {})).toEqual(['drone']);
	});

	it('reports an unresolvable from: even when the patch scene has no id of its own', () => {
		const index = buildSceneIndex([{name: 'official landing', text: PATCH}]);

		expect(index.errors.map(error => error.code)).toEqual(['unknown-from']);
		expect(index.errors[0].message).toContain('official-landing-template');
	});

	it('lets a scene id win over a passage of the same name', () => {
		const index = buildSceneIndex([
			// The passage is CALLED tavern; a different passage declares `id: tavern`.
			{name: 'tavern', text: '[scene]\nbg: wrong-one\n'},
			{name: 'Tavern Night', text: '[scene]\nid: tavern\nbg: right-one\n'},
			{name: 'after', text: '[scene]\nfrom: tavern\n'}
		]);

		expect(index.errors).toEqual([]);
		expect(index.resolve('after')?.bg).toBe('right-one');
	});

	it('still indexes a scene under its id, and an anonymous one under its passage', () => {
		const index = buildSceneIndex([
			{name: 'Tavern Night', text: '[scene]\nid: tavern\nbg: night\n'},
			{name: 'Street', text: '[scene]\nbg: dawn\n'}
		]);

		expect([...index.scenes.keys()].sort()).toEqual(['Street', 'tavern']);
		expect(index.scenes.get('tavern')?.id).toBe('tavern');
		expect(index.scenes.get('Street')?.id).toBeUndefined();
	});

	it('matches a passage name case-insensitively, the way a link does', () => {
		const index = buildSceneIndex([
			{name: 'Official Landing Template', text: '[scene]\nbg: oasis\n'},
			{name: 'after', text: '[scene]\nfrom: official landing template\n'}
		]);

		expect(index.errors).toEqual([]);
		expect(index.resolve('after')?.bg).toBe('oasis');
	});

	it('does NOT fold the case of a scene id', () => {
		const index = buildSceneIndex([
			{name: 'Tavern Night', text: '[scene]\nid: tavern-night\nbg: night\n'},
			{name: 'after', text: '[scene]\nfrom: Tavern-Night\n'}
		]);

		expect(index.errors.map(error => error.code)).toEqual(['unknown-from']);
	});

	it('catches a cycle built out of passage names', () => {
		const index = buildSceneIndex([
			{name: 'a', text: '[scene]\nfrom: b\n'},
			{name: 'b', text: '[scene]\nfrom: a\n'}
		]);

		expect(index.errors.map(error => error.code)).toContain('from-cycle');
	});

	it('names an anonymous scene by its passage in a cycle message', () => {
		const index = buildSceneIndex([
			{name: 'a', text: '[scene]\nfrom: b\n'},
			{name: 'b', text: '[scene]\nfrom: a\n'}
		]);

		expect(index.errors[0].message).toContain('a -> b -> a');
	});
});
