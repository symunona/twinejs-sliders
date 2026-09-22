/** @jest-environment node */

import {catalogFromManifest} from '../assets';
import {buildStoryMap, linksOf, renderStoryMap, tokenEstimate} from '../map';
import type {AssetMetaRow, Manifest, PassageLike, StoryLike} from '../types';

function passage(name: string, text: string): PassageLike {
	return {id: name.toLowerCase().replace(/\W+/g, '-'), name, tags: [], text};
}

function story(passages: PassageLike[]): StoryLike {
	return {id: 'story-1', ifid: 'IFID', name: 'Trip to my Desert', passages};
}

function asset(id: string, name: string, kind: string): AssetMetaRow {
	return {
		bytes: 2048,
		h: 720,
		hash: `h_${id}`,
		id,
		kind,
		mime: 'image/png',
		name,
		tags: [],
		w: 1280
	};
}

function manifest(assets: AssetMetaRow[], missing: string[] = []): Manifest {
	return {assets, characters: [], missing, rev: 3, version: 1};
}

const TAVERN = `[scene]
id: tavern
bg: tavern/night
cast:
  mara: {at: [0.3, 0.8]}
beats:
  - mara: "Sit down."
  - mark: sit
links:
  onward: {to: Street Dawn}
`;

describe('buildStoryMap', () => {
	it('reports one row per passage, with line counts and the scene block offset', () => {
		const map = buildStoryMap({
			ref: 'ep3',
			story: story([passage('Tavern Night', TAVERN), passage('Street Dawn', 'no scene here')])
		});

		expect(map.passages).toHaveLength(2);
		expect(map.passages[0]).toMatchObject({
			name: 'Tavern Night',
			ref: 'ep3/Tavern Night',
			// `[scene]` is line 1, so the YAML the parser sees starts on line 2.
			scene: 2
		});
		expect(map.passages[1].scene).toBeUndefined();
	});

	it('collects scenes with their cast, beat count and named marks', () => {
		const map = buildStoryMap({ref: 'ep3', story: story([passage('Tavern Night', TAVERN)])});

		expect(map.scenes).toEqual([
			{
				beats: 2,
				cast: ['mara'],
				from: undefined,
				id: 'tavern',
				marks: ['sit'],
				passage: 'Tavern Night'
			}
		]);
	});

	it('follows a link written inside the scene block', () => {
		const map = buildStoryMap({ref: 'ep3', story: story([passage('Tavern Night', TAVERN)])});

		expect(map.passages[0].links).toContain('Street Dawn');
	});

	it('counts lint the way lint does — a dead link is an error, not a silent pass', () => {
		const map = buildStoryMap({
			ref: 'ep3',
			// `Street Dawn` is linked and does not exist.
			story: story([passage('Tavern Night', TAVERN)])
		});

		expect(map.errors).toBeGreaterThan(0);
	});

	it('omits the asset block entirely when no manifest was handed in', () => {
		const map = buildStoryMap({ref: 'ep3', story: story([passage('A', 'x')])});

		expect(map.assets).toBeUndefined();
		expect(renderStoryMap(map).join('\n')).not.toContain('ASSETS');
	});

	it('tallies assets by kind and flags the ones no passage mentions', async () => {
		const catalog = await catalogFromManifest(
			manifest([asset('a1', 'tavern/night', 'bg'), asset('a2', 'unused/thing', 'object')])
		);
		const map = buildStoryMap({
			catalog,
			ref: 'ep3',
			story: story([passage('Tavern Night', TAVERN), passage('Street Dawn', 'end')])
		});

		expect(map.assets).toMatchObject({
			bytes: 4096,
			count: 2,
			kinds: {bg: 1, object: 1},
			missing: 0,
			unused: 1
		});
	});

	it('keeps the findings only when asked, so the common call stays small', () => {
		const input = {ref: 'ep3', story: story([passage('Tavern Night', TAVERN)])};

		expect(buildStoryMap(input).findings).toBeUndefined();
		expect(buildStoryMap({...input, keepFindings: true}).findings!.length).toBeGreaterThan(0);
	});
});

describe('renderStoryMap', () => {
	it('prints a header, a PASSAGES table and a LINT tally', () => {
		const map = buildStoryMap({
			ref: 'ep3',
			rev: 42,
			story: story([passage('Tavern Night', TAVERN), passage('Street Dawn', 'end')])
		});
		const text = renderStoryMap(map, {mode: 'local'}).join('\n');

		expect(text).toContain('ep3  Trip to my Desert  rev 42  2 passages');
		expect(text).toContain('local');
		expect(text).toContain('PASSAGES');
		expect(text).toContain('SCENES');
		expect(text).toMatch(/LINT {4}\d+ warnings, \d+ errors/);
	});

	it('names the lint command only when there is an error to chase', () => {
		const clean = buildStoryMap({ref: 'ep3', story: story([passage('Only', 'plain text')])});

		expect(renderStoryMap(clean).join('\n')).not.toContain('twine-cli lint');
	});

	it('drops the rev from the header when the caller has none', () => {
		const map = buildStoryMap({ref: 'ep3', story: story([passage('Only', 'plain')])});

		expect(renderStoryMap(map)[0]).not.toContain('rev');
	});
});

describe('linksOf', () => {
	it('dedupes a target reached two different ways', () => {
		expect(linksOf(passage('A', '[[Barn]] and [[Barn]] again'))).toEqual(['Barn']);
	});

	it('takes the target of a piped wiki link, not its label', () => {
		expect(linksOf(passage('A', '[[go inside->Barn]]'))).toEqual(['Barn']);
	});
});

describe('tokenEstimate', () => {
	it('is four characters to the token', () => {
		expect(tokenEstimate(4000)).toBe(1000);
	});
});
