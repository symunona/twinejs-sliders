import {parseScene} from '@sliders/scene-schema';
import {emptyStage} from '@sliders/scene-types';
import {applyScene} from '../apply-scene';
import {beatTiming, beatTransitions, sceneTimeline} from '../beat-timing';
import {runBeats} from '../run-beats';

function compile(text: string) {
	const {errors, scene} = parseScene(text);

	expect(errors.filter(e => e.severity !== 'warning')).toEqual([]);

	const states = runBeats(applyScene(emptyStage(), scene), scene.beats);

	return {scene, states};
}

const CAST = 'cast:\n  mira: {at: 0}\n  joren: {at: 0.5}\nbeats:\n';

describe('beatTransitions', () => {
	it('times each entity by its own part', () => {
		const {scene, states} = compile(
			`${CAST}  - mira: {at: 0.3, dur: 2}\n    joren: {at: -0.3, dur: 1, ease: ease_out}\n`
		);
		const ts = beatTransitions(states[0], states[1], scene.beats[0]);
		const byId = Object.fromEntries(ts.map(t => [t.entityId, t]));

		expect(byId.mira.duration).toBe(2);
		expect(byId.joren).toMatchObject({duration: 1, ease: 'ease_out'});
	});

	it('times an of: child on its parent’s clock', () => {
		const {scene, states} = compile(
			'props:\n  table: {at: 0}\n  candle: {of: table, at: 0.1}\ncast:\n  mira: {at: 0.5}\nbeats:\n  - mira: {at: -0.5}\n    table: {at: 0.4, dur: 3}\n'
		);
		const ts = beatTransitions(states[0], states[1], scene.beats[0]);

		expect(ts.find(t => t.entityId === 'candle')?.duration).toBe(3);
		expect(ts.find(t => t.entityId === 'mira')?.duration).toBe(0.3);
	});
});

describe('beatTiming', () => {
	function timing(beats: string, autoAdvanceSec?: number, index = 0) {
		const {scene, states} = compile(`${CAST}${beats}`);
		const beat = scene.beats[index];

		return beatTiming(
			beat,
			beatTransitions(states[index], states[index + 1], beat),
			states[index + 1],
			{autoAdvanceSec, last: index === scene.beats.length - 1}
		);
	}

	it('a move with nothing to read ends when the move does', () => {
		const t = timing('  - mira: {at: 0.3}\n  - mira: "x"\n');

		expect(t).toMatchObject({advance: 'anim', animSec: 0.3, holdSec: 0.3});
	});

	it('the longest part holds the beat', () => {
		const t = timing('  - mira: {at: 0.3}\n    joren: {at: 0, dur: 3}\n  - mira: "x"\n');

		expect(t).toMatchObject({advance: 'anim', holdSec: 3});
	});

	it('a walk holds the beat until the walker arrives', () => {
		const t = timing(
			'  - mira: {pose: [{name: walk, dur: 0.5}, {name: walk, dur: 0.5}, {name: idle}], poseLoop: once}\n  - mira: "x"\n'
		);

		expect(t.holdSec).toBeCloseTo(1.1);
		expect(t.tracks.some(track => track.kind === 'steps')).toBe(true);
	});

	it('a line auto-advances, or waits for a click', () => {
		expect(timing('  - mira: "a"\n  - mira: "b"\n', 3)).toMatchObject({
			advance: 'auto',
			holdSec: 3
		});
		expect(timing('  - mira: "a"\n  - mira: "b"\n', 0).advance).toBe('reader');
	});

	it('the last line always waits for the reader', () => {
		expect(timing('  - mira: "a"\n', 3).advance).toBe('reader');
	});

	it('wait and dur are timers', () => {
		expect(timing('  - wait: 1.5\n  - mira: "x"\n')).toMatchObject({
			advance: 'timer',
			holdSec: 1.5
		});
		expect(timing('  - mira: {pose: x, dur: 2}\n  - mira: "x"\n')).toMatchObject({
			advance: 'timer',
			holdSec: 2
		});
	});

	it('two speakers are two lines', () => {
		expect(timing('  - mira: "a"\n    joren: "b"\n').lines).toHaveLength(2);
	});
});

describe('sceneTimeline', () => {
	it('lays the beats end to end', () => {
		const {scene, states} = compile(`${CAST}  - mira: {at: 0.3}\n  - wait: 1\n  - mira: "x"\n`);
		const line = sceneTimeline(states, scene.beats, {readerSec: 2});

		expect(line.beats.map(b => b.start)).toEqual([0, 0.3, 1.3]);
		expect(line.total).toBeCloseTo(3.3);
	});
});
