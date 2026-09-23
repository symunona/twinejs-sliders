import {SceneRefSpan, sceneRefSpans} from '../asset-refs';

/** The span's own text, cut out of the source it was scanned from. */
function cut(text: string, span: SceneRefSpan) {
	return text.slice(span.start, span.end);
}

/** Spans as `kind:ref` (or `kind:owner/ref` for a pose), so a test reads as one line. */
function summary(text: string) {
	return sceneRefSpans(text).map(span =>
		span.kind === 'pose'
			? `${span.kind}:${span.owner}/${span.ref}`
			: `${span.kind}:${span.ref}`
	);
}

describe('sceneRefSpans', () => {
	it('returns nothing for text with no scene keys', () => {
		expect(sceneRefSpans('')).toEqual([]);
		expect(sceneRefSpans('just some prose')).toEqual([]);
	});

	it('finds a scalar bg', () => {
		const text = 'id: tavern\nbg: tavern/night\n';

		expect(summary(text)).toEqual(['bg:tavern/night']);
	});

	it('finds the id inside a bg map, not its fx', () => {
		const text = 'bg: {id: cellar, fx: parallax_left, speed: 20}\n';

		expect(summary(text)).toEqual(['bg:cellar']);
	});

	it('skips a bg that names no art', () => {
		expect(sceneRefSpans('bg: ~\n')).toEqual([]);
	});

	it('finds cast and prop ids', () => {
		const text = [
			'cast:',
			'  mira: {at: -0.4}',
			'props:',
			'  candle: {at: 0}'
		].join('\n');

		expect(summary(text)).toEqual(['entity:mira', 'entity:candle']);
	});

	it('finds both an id and the ref that renamed its art', () => {
		const text = 'cast:\n  guard2: {ref: guard, at: 0.3}\n';

		expect(summary(text)).toEqual(['entity:guard2', 'entity:guard']);
	});

	it('finds entities: entries, whose kind the parser cannot know either', () => {
		expect(summary('entities:\n  thing: {at: 0}\n')).toEqual(['entity:thing']);
	});

	it('attributes a pose to its entity', () => {
		const text = 'cast:\n  mira: {at: -0.4, pose: arms-crossed}\n';

		expect(summary(text)).toEqual(['entity:mira', 'pose:mira/arms-crossed']);
	});

	it('attributes a pose to the entity ref, not its id', () => {
		const text = 'cast:\n  guard2: {ref: guard, pose: alert}\n';

		expect(summary(text)).toEqual([
			'entity:guard2',
			'entity:guard',
			'pose:guard/alert'
		]);
	});

	it('finds every pose in a step list', () => {
		const text = 'cast:\n  mira: {pose: [walk_1, walk_2]}\n';

		expect(summary(text)).toEqual([
			'entity:mira',
			'pose:mira/walk_1',
			'pose:mira/walk_2'
		]);
	});

	it('finds the name inside a step map', () => {
		const text =
			'cast:\n  mira: {pose: [{name: wave, dur: 0.3}, {name: idle, at: 0.2}]}\n';

		expect(summary(text)).toEqual([
			'entity:mira',
			'pose:mira/wave',
			'pose:mira/idle'
		]);
	});

	it('reads the retired frame: spelling', () => {
		expect(summary('cast:\n  mira: {frame: angry}\n')).toEqual([
			'entity:mira',
			'pose:mira/angry'
		]);
	});

	it('finds a beat speaker and the pose it sets', () => {
		const text = [
			'cast:',
			'  mira: {at: 0}',
			'beats:',
			'  - mira: {pose: angry, say: "Get out."}'
		].join('\n');

		expect(summary(text)).toEqual([
			'entity:mira',
			'entity:mira',
			'pose:mira/angry'
		]);
	});

	it('ignores beat commands, which name no art', () => {
		const text = [
			'beats:',
			'  - wait: 0.5',
			'  - mark: tense',
			'  - fx: shake',
			'  - sfx: door',
			'  - box: "The candle gutters."'
		].join('\n');

		expect(sceneRefSpans(text)).toEqual([]);
	});

	it('finds a bg a beat cuts to, on its own and riding on a line', () => {
		const text = [
			'beats:',
			'  - bg: {id: cellar, fx: earthquake}',
			'  - mira: {say: "Not any more.", bg: street}',
			'  - box: {text: "Dark.", bg: pit}'
		].join('\n');

		expect(summary(text)).toEqual([
			'bg:cellar',
			'entity:mira',
			'bg:street',
			'bg:pit'
		]);
	});

	it('points at the value, not the quotes around it', () => {
		const text = 'bg: "tavern night"\n';
		const [span] = sceneRefSpans(text);

		expect(cut(text, span)).toBe('tavern night');
	});

	it('offsets land on the written word', () => {
		const text = [
			'bg: tavern/night',
			'cast:',
			'  mira: {pose: arms-crossed}'
		].join('\n');

		for (const span of sceneRefSpans(text)) {
			expect(cut(text, span)).toBe(span.ref);
		}
	});

	it('reports spans in the order written', () => {
		const text = [
			'cast:',
			'  mira: {pose: idle}',
			'bg: tavern',
			'props:',
			'  candle: {at: 0}'
		].join('\n');
		const spans = sceneRefSpans(text);

		expect(spans.map(span => span.start)).toEqual(
			[...spans.map(span => span.start)].sort((a, b) => a - b)
		);
	});

	it('survives a half-typed block', () => {
		expect(() => sceneRefSpans('cast:\n  mira: {at:')).not.toThrow();
		expect(() => sceneRefSpans('bg:')).not.toThrow();
		expect(() => sceneRefSpans('\t- nope')).not.toThrow();
	});

	it('still finds what it can when a later line is broken', () => {
		// The lines above the mistake are worth answering for -- the author is typing below.
		expect(summary('bg: tavern\ncast:\n  mira: {at: 0}\n  : oops\n')).toContain(
			'bg:tavern'
		);
	});
});
