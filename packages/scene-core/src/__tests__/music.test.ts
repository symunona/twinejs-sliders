import {emptyStage} from '@sliders/scene-types';
import type {
	Beat,
	MusicSpec,
	MusicTrack,
	Scene,
	Stage,
	StageMusic
} from '@sliders/scene-types';
import {parseScene} from '@sliders/scene-schema';
import {applyScene} from '../apply-scene';
import {diffStages} from '../diff-stages';
import {applyMusic} from '../music';
import {runBeats} from '../run-beats';
import {cloneStage} from '../stage';

function scene(over: Partial<Scene> = {}): Scene {
	return {beats: [], entities: {}, links: {}, ...over};
}

function stageWith(music: Stage['music']): Stage {
	return {...emptyStage(), music};
}

const rain: MusicTrack = {amount: 1, fade: 1.5, id: 'rain', loop: true};

/** The stage sequence for a whole scene block, the way the player and editor build it. */
function play(yaml: string, base: Stage = emptyStage()): Stage[] {
	const {scene: parsed, errors} = parseScene(yaml);

	expect(errors).toEqual([]);
	return runBeats(applyScene(base, parsed), parsed.beats);
}

describe('applyMusic', () => {
	it('leaves things alone when nothing is said', () => {
		const current: StageMusic = {main: rain};

		expect(applyMusic(current, undefined, 3)).toBe(current);
	});

	it('stops everything on ~', () => {
		expect(applyMusic({main: rain}, null, 0)).toBeUndefined();
	});

	it('fills every default on a redefinition', () => {
		expect(applyMusic(undefined, {tracks: {a: {id: 'x'}}}, 0)).toEqual({
			a: {amount: 1, fade: 1.5, id: 'x', loop: false}
		});
	});

	it('adds a new key beside the running ones', () => {
		const out = applyMusic({main: rain}, {tracks: {drums: {id: 'd', amount: 0.3}}}, 1);

		expect(Object.keys(out!)).toEqual(['main', 'drums']);
		expect(out!.main).toEqual(rain);
	});

	it('redefines a key in full, defaults and all', () => {
		const out = applyMusic({main: {...rain, amount: 0.2, start: 4}}, {tracks: {main: {id: 'storm'}}}, 1);

		expect(out).toEqual({main: {amount: 1, fade: 1.5, id: 'storm', loop: false}});
	});

	it('loops the single form unless it says otherwise, a keyed track plays once', () => {
		const resolved = (spec: MusicSpec) => applyMusic(undefined, spec, 0)!.main.loop;

		expect(resolved({single: true, tracks: {main: {id: 'rain'}}})).toBe(true);
		expect(resolved({single: true, tracks: {main: {id: 'rain', loop: false}}})).toBe(false);
		expect(resolved({single: true, tracks: {main: {id: 'rain', loop: true}}})).toBe(true);
		expect(resolved({tracks: {main: {id: 'rain'}}})).toBe(false);
	});

	it('patches a running track without an id', () => {
		const out = applyMusic({wind: {...rain, id: 'w'}}, {tracks: {wind: {amount: 0.2, fade: 4}}}, 2);

		expect(out).toEqual({wind: {amount: 0.2, fade: 4, id: 'w', loop: true}});
	});

	it('ignores a patch with nothing running under its key', () => {
		expect(applyMusic(undefined, {tracks: {wind: {amount: 0.2}}}, 2)).toBeUndefined();
	});

	it('stops one key on key: ~', () => {
		expect(applyMusic({a: rain, b: rain}, {tracks: {a: null}}, 1)).toEqual({b: rain});
	});

	it('stops every other track on stop-other-tracks: all', () => {
		const spec: MusicSpec = {stopOthers: 'all', tracks: {b: {id: 'rain', loop: true}}};

		expect(Object.keys(applyMusic({a: rain, b: rain, c: rain}, spec, 1)!)).toEqual(['b']);
	});

	it('stops only the named tracks on a list', () => {
		const spec: MusicSpec = {stopOthers: ['a', 'b'], tracks: {b: {id: 'rain', loop: true}}};

		expect(Object.keys(applyMusic({a: rain, b: rain, c: rain}, spec, 1)!)).toEqual(['b', 'c']);
	});

	it('stamps the take on restart, and only then', () => {
		const restarted = applyMusic({main: rain}, {tracks: {main: {id: 'rain', loop: true, restart: true}}}, 4);

		expect(restarted!.main.take).toBe(4);

		// Same id again without restart: the take it had is kept — still that recording.
		const kept = applyMusic(restarted, {tracks: {main: {amount: 0.3, id: 'rain'}}}, 6);

		expect(kept!.main.take).toBe(4);

		// A different id drops it: a new file has no take to keep.
		expect(applyMusic(restarted, {tracks: {main: {id: 'storm'}}}, 6)!.main.take).toBeUndefined();
	});

	it('stamps the take on a restart patch', () => {
		expect(applyMusic({main: rain}, {tracks: {main: {restart: true}}}, 3)!.main.take).toBe(3);
	});

	it('never shares the spec or the current state', () => {
		const loop = {from: 1, to: 4};
		const current: StageMusic = {main: {...rain, loop: {from: 0}}};
		const out = applyMusic(current, {tracks: {b: {id: 'x', loop}}}, 0)!;

		loop.from = 99;
		(current.main.loop as {from: number}).from = 99;
		expect(out.b.loop).toEqual({from: 1, to: 4});
		expect(out.main.loop).toEqual({from: 0});
	});
});

describe('applyScene + music', () => {
	it('plays what the scene declares', () => {
		const out = applyScene(
			emptyStage(),
			scene({music: {tracks: {main: {amount: 0.5, id: 'rain', loop: true}}}})
		);

		expect(out.music).toEqual({main: {...rain, amount: 0.5}});
	});

	it('inherits the tracks through from:', () => {
		const base = stageWith({main: rain});
		const out = applyScene(base, scene({from: 'other'}));

		expect(out.music).toEqual({main: rain});
	});

	it('lays a patch scene over the inherited tracks by key', () => {
		const base = stageWith({main: rain});
		const out = applyScene(base, scene({from: 'other', music: {tracks: {wind: {id: 'w'}}}}));

		expect(Object.keys(out.music!)).toEqual(['main', 'wind']);
	});

	it('silences inherited tracks with music: ~', () => {
		const base = stageWith({main: rain});
		const out = applyScene(base, scene({from: 'other', music: null}));

		expect(out.music).toBeUndefined();
	});

	it('does not carry tracks into a snapshot', () => {
		// A snapshot is a complete statement of the stage, so an absent key is silence.
		// Nothing else would be previewable: the editor renders one passage and cannot know
		// what played before it. Carry is the player's deck, not state.
		const base = stageWith({main: rain});

		expect(applyScene(base, scene({})).music).toBeUndefined();
		expect(
			applyScene(base, scene({music: {tracks: {wind: {id: 'w'}}}})).music
		).toEqual({wind: {amount: 1, fade: 1.5, id: 'w', loop: false}});
	});

	it('stamps take 0 on a restart at the top', () => {
		const out = applyScene(
			emptyStage(),
			scene({music: {tracks: {main: {id: 'rain', restart: true}}}})
		);

		expect(out.music!.main.take).toBe(0);
	});

	it('does not share the scene object with the stage', () => {
		const declared = {amount: 1, id: 'rain', loop: true};
		const out = applyScene(emptyStage(), scene({music: {tracks: {main: declared}}}));

		declared.amount = 0;
		expect(out.music!.main.amount).toBe(1);
	});
});

describe('cloneStage + music', () => {
	it('deep-clones tracks and loop sections', () => {
		const stage = stageWith({main: {...rain, loop: {from: 2, to: 8}}});
		const copy = cloneStage(stage);

		copy.music!.main.amount = 0;
		(copy.music!.main.loop as {from: number}).from = 0;
		expect(stage.music!.main).toEqual({...rain, loop: {from: 2, to: 8}});
	});
});

describe('runBeats + music', () => {
	it('carries the top music through beats that say nothing about it', () => {
		const states = play(
			['music: rain', 'beats:', '  - box: one', '  - box: two'].join('\n')
		);

		expect(states.map(state => state.music)).toEqual([
			{main: rain},
			{main: rain},
			{main: rain}
		]);
	});

	it('changes the track when a beat redefines its key, from that beat on', () => {
		const states = play(
			['music: rain', 'beats:', '  - box: one', '  - music: storm', '  - box: two'].join('\n')
		);

		expect(states.map(state => state.music?.main.id)).toEqual([
			'rain',
			'rain',
			'storm',
			'storm'
		]);
	});

	it('adds a track on a new key and stops it on key: ~', () => {
		const states = play(
			[
				'music: rain',
				'beats:',
				'  - mira: {say: "Listen.", music: {drums: drum@0.3}}',
				'  - box: {text: "Quiet.", music: {drums: ~}}'
			].join('\n')
		);

		expect(states.map(state => Object.keys(state.music ?? {}))).toEqual([
			['main'],
			['main', 'drums'],
			['main']
		]);
		expect(states[1].music!.drums).toEqual({amount: 0.3, fade: 1.5, id: 'drum', loop: false});
	});

	it('stops the others on stop-other-tracks', () => {
		const states = play(
			[
				'music: {a: x, b: y, c: z}',
				'beats:',
				'  - music: {c: z, stop-other-tracks: all}',
				'  - music: ~'
			].join('\n')
		);

		expect(states.map(state => Object.keys(state.music ?? {}))).toEqual([
			['a', 'b', 'c'],
			['c'],
			[]
		]);
		expect(states[2].music).toBeUndefined();
	});

	it('stamps a restart with its beat, and later beats keep it', () => {
		const states = play(
			[
				'music: rain',
				'beats:',
				'  - box: one',
				'  - music: {main: {restart: true}}',
				'  - music: {main: {volume: 0.5}}'
			].join('\n')
		);

		expect(states.map(state => state.music!.main.take)).toEqual([
			undefined,
			undefined,
			2,
			2
		]);
		expect(states[3].music!.main.amount).toBe(0.5);
	});

	it('re-derives the same state at every index, whatever was asked before (scrub)', () => {
		const yaml = [
			'music: {a: x}',
			'beats:',
			'  - music: {b: y@0.5}',
			'  - music: {a: {volume: 0.2}}',
			'  - music: {a: ~}',
			'  - music: {stop-other-tracks: all}'
		].join('\n');
		const first = play(yaml);
		const second = play(yaml);

		expect(second).toEqual(first);
		expect(first.map(state => state.music)).toEqual([
			{a: {amount: 1, fade: 1.5, id: 'x', loop: false}},
			{
				a: {amount: 1, fade: 1.5, id: 'x', loop: false},
				b: {amount: 0.5, fade: 1.5, id: 'y', loop: false}
			},
			{
				a: {amount: 0.2, fade: 1.5, id: 'x', loop: false},
				b: {amount: 0.5, fade: 1.5, id: 'y', loop: false}
			},
			{b: {amount: 0.5, fade: 1.5, id: 'y', loop: false}},
			undefined
		]);
	});

	it('does not leak one state into the next', () => {
		const states = play(['music: {a: x}', 'beats:', '  - music: {a: {volume: 0.2}}'].join('\n'));

		states[1].music!.a.amount = 0.9;
		expect(states[0].music!.a.amount).toBe(1);
	});

	it('patches an inherited from: stage from a beat', () => {
		const base = stageWith({main: rain});
		const states = play(
			['from: Other', 'beats:', '  - music: {main: {volume: 0.1}}'].join('\n'),
			base
		);

		expect(states[0].music).toEqual({main: rain});
		expect(states[1].music).toEqual({main: {...rain, amount: 0.1}});
	});

	it('runs a hand-built music beat', () => {
		const beats: Beat[] = [{index: 0, kind: 'music', music: {tracks: {a: {id: 'x'}}}}];

		expect(runBeats(emptyStage(), beats)[1].music).toEqual({
			a: {amount: 1, fade: 1.5, id: 'x', loop: false}
		});
	});
});

describe('diffStages + music', () => {
	const musicOnly = (from: Stage, to: Stage) =>
		diffStages(from, to).filter(transition => transition.kind === 'music');

	it('emits nothing when the same tracks play the same way', () => {
		// The whole reason every scene can declare its own music: a chapter of passages
		// under one track must play as one unbroken take.
		const from = stageWith({main: {...rain, amount: 0.4}, wind: {...rain, id: 'w'}});
		const to = stageWith({wind: {...rain, id: 'w'}, main: {...rain, amount: 0.4}});

		expect(musicOnly(from, to)).toEqual([]);
	});

	it('emits a transition when a volume changes', () => {
		const from = stageWith({main: {...rain, amount: 0.4}});
		const to = stageWith({main: {...rain, amount: 0.1}});

		expect(musicOnly(from, to)).toEqual([
			{
				duration: 1.5,
				from: {main: {...rain, amount: 0.4}},
				kind: 'music',
				to: {main: {...rain, amount: 0.1}}
			}
		]);
	});

	const changes: Array<[string, Partial<MusicTrack>]> = [
		['id', {id: 'storm'}],
		['loop', {loop: false}],
		['loop section', {loop: {from: 1}}],
		['fade', {fade: 3}],
		['start', {start: 2}],
		['take', {take: 2}]
	];

	it.each(changes)('emits a transition when %s changes', (_, change) => {
		const out = musicOnly(stageWith({main: rain}), stageWith({main: {...rain, ...change}}));

		expect(out).toHaveLength(1);
	});

	it('emits a transition when a track is added or the music stops', () => {
		expect(musicOnly(stageWith({main: rain}), stageWith({main: rain, b: rain}))).toHaveLength(1);

		const out = musicOnly(stageWith({main: rain}), emptyStage());

		expect(out).toHaveLength(1);
		expect(out[0].to).toBeUndefined();
	});

	it('compares loop sections by value', () => {
		const from = stageWith({main: {...rain, loop: {from: 1, to: 4}}});
		const to = stageWith({main: {...rain, loop: {from: 1, to: 4}}});

		expect(musicOnly(from, to)).toEqual([]);
	});

	it('emits nothing between two silent stages', () => {
		expect(musicOnly(emptyStage(), emptyStage())).toEqual([]);
	});
});
