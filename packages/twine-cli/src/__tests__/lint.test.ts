/** @jest-environment node */

import type {Character} from '@sliders/scene-types';
import {catalogFromManifest} from '../assets';
import type {AssetCatalog} from '../assets';
import {
	buildLinkGraph,
	formatFinding,
	hasErrors,
	lintPassageText,
	lintStory,
	passageExits
} from '../lint';
import type {LintFinding} from '../lint';
import type {AssetMetaRow, Manifest, PassageObject, StoryBody} from '../types';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function passage(name: string, text: string, id = name.toLowerCase()): PassageObject {
	return {id, left: 0, name, tags: [], text, top: 0};
}

function story(passages: PassageObject[], startPassage = passages[0]?.id): StoryBody {
	return {
		id: 'story-1',
		ifid: 'IFID',
		name: 'Trip to my Desert',
		passages,
		startPassage
	};
}

function asset(id: string, name: string, kind: string): AssetMetaRow {
	return {
		bytes: 512,
		h: 720,
		hash: `h_${id}`,
		id,
		kind,
		mime: 'image/webp',
		name,
		tags: [],
		w: 1280
	};
}

const mira: Character = {
	frames: {angry: {asset: 'a_angry'}, idle: {asset: 'a_idle'}},
	id: 'mira',
	name: 'Mira',
	origin: {x: 0.5, y: 1},
	size: {h: 1024, w: 512},
	tags: []
};

function manifest(missing: string[] = []): Manifest {
	return {
		assets: [
			asset('a_bg', 'tavern/night', 'bg'),
			asset('a_idle', 'mira/idle', 'frame'),
			asset('a_angry', 'mira/angry', 'frame'),
			asset('a_moon', 'moon', 'object')
		],
		characters: [mira],
		missing,
		rev: 2,
		version: 1
	};
}

async function catalog(missing: string[] = []): Promise<AssetCatalog> {
	return catalogFromManifest(manifest(missing), async id => `/data/assets/${id}.webp`);
}

function messages(findings: LintFinding[]): string[] {
	return findings.map(formatFinding);
}

// ---------------------------------------------------------------------------
// Tier 1
// ---------------------------------------------------------------------------

describe('tier 1 — YAML', () => {
	it('reports an unknown key with a did-you-mean', () => {
		const text = `[scene]\nid: tavern-night\nchar:\n  mira: {at: 0}\n`;
		const findings = lintPassageText(text, 'tmp/p.md');

		expect(findings).toHaveLength(1);
		expect(findings[0].level).toBe('error');
		expect(findings[0].message).toMatch(/char/);
		expect(findings[0].message).toMatch(/Did you mean 'cast'\?/);
		expect(findings[0].line).toBe(3);
	});

	it('offsets lines past a cat receipt', () => {
		const receipt = `---\nstory: ep3\npassage: Tavern Night\nrev: 42\nhash: 9f31c8a2\n---\n`;
		const text = `[scene]\nid: tavern-night\nchar: {}\n`;
		const findings = lintPassageText(text, 'tmp/p.md', {lineBase: 7});

		// Line 3 of the passage is line 9 of a file whose passage text starts at line 7.
		expect(findings[0].line).toBe(9);
		expect(receipt.split('\n')).toHaveLength(7);
	});

	it('says nothing about a passage with no scene in it', () => {
		expect(lintPassageText('Just prose and a [[link->Street]].', 'tmp/p.md')).toEqual([]);
	});

	it('catches a bad coordinate', () => {
		const findings = lintPassageText(
			`[scene]\nid: x\ncast:\n  mira: {at: "over there"}\n`,
			'tmp/p.md'
		);

		expect(hasErrors(findings)).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// Tier 2
// ---------------------------------------------------------------------------

describe('tier 2 — cross-passage', () => {
	it('reports a duplicate scene id against the second passage', () => {
		const body = story([
			passage('Start', `[scene]\nid: tavern-night\nlinks:\n  go: {to: Street}\n`),
			passage('Street', `[scene]\nid: tavern-night\nlinks:\n  back: {to: Start}\n`)
		]);
		const dupe = lintStory({body, ref: 'ep3'}).filter(finding =>
			/Duplicate scene id/.test(finding.message)
		);

		expect(dupe).toHaveLength(1);
		expect(dupe[0].file).toBe('ep3/Street');
		expect(dupe[0].level).toBe('error');
		expect(dupe[0].line).toBe(2);
		expect(dupe[0].message).toMatch(/already used by passage 'Start'/);
	});

	it('reports an unknown from: on the passage that wrote it', () => {
		const body = story([
			passage('Start', `[scene]\nid: tavern-night\nlinks:\n  go: {to: Street}\n`),
			passage(
				'Street',
				`[scene]\nid: street-day\nfrom: tavern-dawn\nlinks:\n  back: {to: Start}\n`
			)
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/Unknown scene/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Street', level: 'error', line: 3});
	});

	it('reports an unknown @mark', () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nbeats:\n  - box: "hi"\nlinks:\n  go: {to: Street}\n`
			),
			passage(
				'Street',
				`[scene]\nid: street-day\nfrom: tavern-night@tense\nlinks:\n  back: {to: Start}\n`
			)
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/no mark/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0].file).toBe('ep3/Street');
	});

	it('reports a from: cycle on both scenes in it', () => {
		const body = story([
			passage('A', `[scene]\nid: a\nfrom: b\nlinks:\n  go: {to: B}\n`),
			passage('B', `[scene]\nid: b\nfrom: a\nlinks:\n  go: {to: A}\n`)
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/cycle/.test(finding.message)
		);

		expect(findings.map(finding => finding.file).sort()).toEqual(['ep3/A', 'ep3/B']);
	});
});

// ---------------------------------------------------------------------------
// Tier 3
// ---------------------------------------------------------------------------

describe('tier 3 — story graph', () => {
	it('reports a link to a passage that does not exist', () => {
		const body = story([
			passage('Start', `Prose. [[go->Nowhere]]\n`),
			passage('Street', `[[back->Start]]`)
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/not a passage/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Start', level: 'error', line: 1});
		expect(findings[0].message).toMatch(/'Nowhere'/);
	});

	it('reports the spec-02 trap: the only exit is a link outside the block', () => {
		const body = story([
			passage(
				'Start',
				`mood: tense\n--\n[scene]\nid: tavern-night\nbg: tavern/night\nbeats:\n  - box: "The door shuts."\n\n[continued]\nYou could [[go->Street]].\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/never drawn/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Start', level: 'error', line: 10});
		expect(findings[0].message).toMatch(/only exit/);
		expect(hasErrors(findings)).toBe(true);
	});

	it('downgrades an outside link to a warning when links: still has a way out', () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nlinks:\n  go: {to: Street}\n\n[continued]\nAlso [[back->Street]].\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/never drawn/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0].level).toBe('warn');
	});

	it('leaves an inside-the-block link alone', () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nbeats:\n  - mira: "Will you [[stay]]?"\nlinks:\n  stay: {to: Street}\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);

		expect(messages(lintStory({body, ref: 'ep3'}))).toEqual([]);
	});

	it('warns about a passage nothing links to', () => {
		const body = story([
			passage('Start', `[[go->Street]]`),
			passage('Street', `[[back->Start]]`, 'street'),
			passage('Orphan', `Nobody comes here.`, 'orphan')
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/Unreachable/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Orphan', level: 'warn', line: 0});
	});

	it('does not count an undrawn link as reaching its target', () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nlinks:\n  go: {to: Street}\n\n[continued]\n[[secret->Cellar]]\n`
			),
			passage('Street', `[[back->Start]]`, 'street'),
			passage('Cellar', `[[back->Start]]`, 'cellar')
		]);
		const findings = lintStory({body, ref: 'ep3'}).filter(finding =>
			/Unreachable/.test(finding.message)
		);

		expect(findings.map(finding => finding.file)).toEqual(['ep3/Cellar']);
	});
});

describe('passageExits / buildLinkGraph', () => {
	it('reads both authored link forms', () => {
		const exits = passageExits(
			`[scene]\nid: x\nbeats:\n  - mira: "Will you [[stay]] or [[go->Street]]?"\nlinks:\n  stay: {to: Tavern Fight}\n  extra: {to: Attic}\n`
		);

		expect(exits.map(exit => exit.target).sort()).toEqual([
			'Attic',
			'Street',
			'Tavern Fight'
		]);
		expect(exits.every(exit => exit.drawn)).toBe(true);
	});

	it('builds a graph keyed by passage name', () => {
		const body = story([
			passage('Start', `[[go->Street]]`),
			passage('Street', `[[back->Start]]`, 'street')
		]);

		expect(buildLinkGraph(body)).toEqual(
			new Map([
				['Start', ['Street']],
				['Street', ['Start']]
			])
		);
	});
});

// ---------------------------------------------------------------------------
// Tier 4
// ---------------------------------------------------------------------------

describe('tier 4 — assets', () => {
	it('reports a frame the scene needs whose blob is gone', async () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nbg: tavern/night\ncast:\n  mira: {at: 0, frame: angry}\nlinks:\n  go: {to: Street}\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);
		const findings = lintStory({
			body,
			catalog: await catalog(['a_angry']),
			ref: 'ep3'
		}).filter(finding => /no blob/.test(finding.message));

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Start', level: 'error', line: 5});
		expect(findings[0].message).toMatch(/a_angry/);
	});

	it('reports a scene reference the manifest has never heard of', async () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nbg: tavern/dawn\nlinks:\n  go: {to: Street}\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);
		const findings = lintStory({body, catalog: await catalog(), ref: 'ep3'}).filter(
			finding => /Unknown asset/.test(finding.message)
		);

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/Start', level: 'error', line: 3});
	});

	it('warns about a blob nothing references, and never calls it an error', async () => {
		const body = story([
			passage(
				'Start',
				`[scene]\nid: tavern-night\nbg: tavern/night\ncast:\n  mira: {at: 0}\nlinks:\n  go: {to: Street}\n`
			),
			passage('Street', `[[back->Start]]`, 'street')
		]);
		const findings = lintStory({body, catalog: await catalog(), ref: 'ep3'});
		const unused = findings.filter(finding => /referenced by no scene/.test(finding.message));

		expect(unused).toHaveLength(1);
		expect(unused[0]).toMatchObject({file: 'ep3/assets.json', level: 'warn'});
		expect(unused[0].message).toMatch(/a_moon/);
		expect(hasErrors(findings)).toBe(false);
	});

	it('reports a manifest entry with no blob even when no scene uses it', async () => {
		const body = story([passage('Start', `Just prose.`)]);
		const findings = lintStory({
			body,
			catalog: await catalog(['a_moon']),
			ref: 'ep3'
		}).filter(finding => /Manifest entry/.test(finding.message));

		expect(findings).toHaveLength(1);
		expect(findings[0]).toMatchObject({file: 'ep3/assets.json', level: 'error'});
	});

	it('skips tier 4 entirely with no manifest in hand', () => {
		const body = story([passage('Start', `[scene]\nid: x\nbg: nope\n`)]);

		expect(
			lintStory({body, ref: 'ep3'}).filter(finding => /asset/i.test(finding.message))
		).toEqual([]);
	});
});

describe('formatFinding', () => {
	it('drops the line when the finding is about a whole file', () => {
		expect(
			formatFinding({file: 'ep3/assets.json', level: 'warn', line: 0, message: 'x'})
		).toBe('ep3/assets.json: warning: x');
		expect(
			formatFinding({file: 'tmp/p.md', level: 'error', line: 12, message: 'x'})
		).toBe('tmp/p.md:12: error: x');
	});
});
