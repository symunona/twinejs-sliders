import CodeMirror, {Editor} from 'codemirror';
import {team, upload} from '../../../../packages/asset-library/src/testing/scenario';
import {hintsForSlot, libraryHints} from '../library-hints';
import {sceneCompletion} from '../use-scene-hints';

// jsdom has neither SubtleCrypto nor TextEncoder; the real engine needs both.
beforeAll(() => {
	if (typeof globalThis.TextEncoder === 'undefined') {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const util = require('util');

		Object.assign(globalThis, {
			TextDecoder: util.TextDecoder,
			TextEncoder: util.TextEncoder
		});
	}

	if (!globalThis.crypto?.subtle) {
		// eslint-disable-next-line @typescript-eslint/no-var-requires
		const {webcrypto} = require('crypto');

		Object.defineProperty(globalThis, 'crypto', {
			configurable: true,
			value: webcrypto
		});
	}
});

/**
 * Scene autocomplete beyond the story's plain names (plan 1): `coll/name` for names two
 * collections in the order hold, and unattached team names at the bottom — a pick
 * attaches the collection.
 */

async function library() {
	const t = await team();
	const fantasy = t.ana.engine.createCollection({name: 'fantasy'});
	const ui = t.ana.engine.createCollection({name: 'ui-icons'});

	await upload(t.ana, t.tavern.id, 'night', 'night', {kind: 'bg'});
	await upload(t.ana, fantasy.id, 'night', 'blue', {kind: 'bg'});
	await upload(t.ana, ui.id, 'arrow', 'red', {kind: 'object'});
	await upload(t.ana, ui.id, 'dawn', 'green', {kind: 'bg'});
	t.ana.engine.createStory('S', {name: 'Night Market'});
	t.ana.engine.bind('S', [t.tavern.id, fantasy.id]);

	return {...t, fantasy, ui};
}

function editorAt(text: string): Editor {
	const lines = text.split('\n');
	const line = lines.findIndex(one => one.includes('|'));
	const ch = lines[line].indexOf('|');

	lines[line] = lines[line].replace('|', '');

	return {
		getCursor: () => ({ch, line}),
		getValue: () => lines.join('\n')
	} as unknown as Editor;
}

describe('library hints', () => {
	it('offers both qualified forms of a name two attached collections hold', async () => {
		const {ana} = await library();
		const hints = libraryHints(ana.engine, 'S');

		expect(
			hints.filter(hint => hint.source === 'qualified').map(hint => hint.insert)
		).toEqual(['tavern-set/night', 'fantasy/night']);
	});

	it('lists unattached team names with the collection a pick attaches', async () => {
		const {ana, ui} = await library();
		const team = libraryHints(ana.engine, 'S').filter(
			hint => hint.source === 'team'
		);

		expect(team).toEqual(
			expect.arrayContaining([
				expect.objectContaining({collection: ui.id, insert: 'arrow', kind: 'object'}),
				expect.objectContaining({collection: ui.id, insert: 'dawn', kind: 'bg'})
			])
		);
		// bg: gets backdrops only, qualified first, team last.
		expect(hintsForSlot('bg', libraryHints(ana.engine, 'S')).map(h => h.label)).toEqual([
			'fantasy/night',
			'tavern-set/night',
			'dawn — ui-icons'
		]);
	});

	it('sceneCompletion puts them under the plain names; picking a team name attaches', async () => {
		const {ana, ui} = await library();
		const attach = jest.fn();
		const completion = sceneCompletion(
			editorAt('[scene]\nbg: |'),
			{all: [], characters: []},
			[],
			[],
			{attach, hints: libraryHints(ana.engine, 'S')}
		)!;

		expect(completion.list.map(item => [item.displayText, item.className])).toEqual([
			['fantasy/night', 'sliders-hint-shadowed'],
			['tavern-set/night', 'sliders-hint-shadowed'],
			['dawn — ui-icons', 'sliders-hint-team']
		]);
		expect(completion.list[2].text).toContain('dawn');

		const pick = (CodeMirror.on as jest.Mock).mock.calls.find(
			([target, event]) => target === completion && event === 'pick'
		)![2];

		pick({displayText: 'dawn — ui-icons'});
		expect(attach).toHaveBeenCalledWith(ui.id);
	});
});
