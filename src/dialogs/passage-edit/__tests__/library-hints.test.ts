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
 * collections in the order hold. Unattached packs are never offered.
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

		expect(hints.map(hint => hint.insert)).toEqual([
			'tavern-set/night',
			'fantasy/night'
		]);
	});

	it('never offers names from unattached packs', async () => {
		const {ana} = await library();
		const inserts = libraryHints(ana.engine, 'S').map(hint => hint.insert);

		expect(inserts).not.toContain('dawn');
		expect(inserts).not.toContain('arrow');
		expect(hintsForSlot('bg', libraryHints(ana.engine, 'S')).map(h => h.label)).toEqual([
			'fantasy/night',
			'tavern-set/night'
		]);
	});

	it('sceneCompletion puts them under the plain names, attached only', async () => {
		const {ana} = await library();
		const completion = sceneCompletion(
			editorAt('[scene]\nbg: |'),
			{all: [], characters: []},
			[],
			[],
			{hints: libraryHints(ana.engine, 'S')}
		)!;

		expect(completion.list.map(item => [item.displayText, item.className])).toEqual([
			['fantasy/night', 'sliders-hint-shadowed'],
			['tavern-set/night', 'sliders-hint-shadowed']
		]);
	});
});
