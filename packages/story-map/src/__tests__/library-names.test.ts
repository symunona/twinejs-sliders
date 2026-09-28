import type {Character} from '@sliders/scene-types';
import {catalogFromManifest, resolveSceneAssets} from '../assets';
import {lintStory} from '../lint';
import type {AssetMetaRow, Manifest, PassageLike, StoryLike} from '../types';
import {parseScene} from '@sliders/scene-schema';

// Shared asset library: qualified `collection/name` refs, and the ambiguity lint.

function asset(id: string, name: string): AssetMetaRow {
	return {
		bytes: 1,
		h: 1,
		hash: `h_${id}`,
		id,
		kind: 'bg',
		mime: 'image/webp',
		name,
		tags: [],
		w: 1
	};
}

const mira: Character = {
	id: 'mira',
	name: 'mira',
	origin: {x: 0.5, y: 1},
	poses: {idle: {asset: 'a_idle'}},
	size: {h: 1, w: 1},
	tags: []
};

function manifest(): Manifest {
	return {
		// The view: first-wins names only (tavern-set's `night` wins).
		ambiguous: {mira: ['tavern-set', 'cast'], night: ['tavern-set', 'fantasy']},
		assets: [asset('a_night', 'night'), asset('a_idle', 'mira-idle')],
		characters: [mira],
		missing: [],
		qualified: {
			assets: {
				'fantasy/night': 'a_night2',
				'tavern-set/night': 'a_night'
			},
			characters: {'cast/mira': 'mira'}
		},
		rev: 0,
		version: 1
	};
}

function story(text: string): StoryLike {
	const passage: PassageLike = {
		id: 'p1',
		name: 'Start',
		tags: [],
		text
	};

	return {id: 's', name: 'S', passages: [passage], startPassage: 'p1'};
}

describe('qualified names in the catalog', () => {
	it('resolves collection/name to the same row', async () => {
		const catalog = await catalogFromManifest(manifest());
		const rows = resolveSceneAssets(
			parseScene('bg: tavern-set/night').scene,
			catalog
		);

		expect(rows[0]).toMatchObject({id: 'a_night', present: 'present'});
	});

	it('a qualified name whose row is outside the view stays unknown', async () => {
		const catalog = await catalogFromManifest(manifest());
		const rows = resolveSceneAssets(
			parseScene('bg: fantasy/night').scene,
			catalog
		);

		expect(rows[0].present).toBe('unknown');
	});

	it('resolves a qualified character', async () => {
		const catalog = await catalogFromManifest(manifest());

		expect(catalog.characters.get('cast/mira')).toBe(
			catalog.characters.get('mira')
		);
	});
});

describe('ambiguity lint', () => {
	it('warns on a name two attached collections hold, suggesting the qualified form', async () => {
		const findings = lintStory({
			body: story('[scene]\nbg: night\nentities:\n  mira: {at: 0}'),
			catalog: await catalogFromManifest(manifest()),
			ref: 's'
		}).filter(finding => /Ambiguous/.test(finding.message));

		expect(findings.map(finding => finding.message)).toEqual([
			expect.stringContaining('Write tavern-set/night'),
			expect.stringContaining('Write tavern-set/mira')
		]);
		expect(findings.every(finding => finding.level === 'warn')).toBe(true);
	});

	it('says nothing for the qualified form', async () => {
		const findings = lintStory({
			body: story('[scene]\nbg: tavern-set/night'),
			catalog: await catalogFromManifest(manifest()),
			ref: 's'
		}).filter(finding => /Ambiguous|Unknown/.test(finding.message));

		expect(findings).toEqual([]);
	});
});
