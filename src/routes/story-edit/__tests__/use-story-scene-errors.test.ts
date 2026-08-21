import {act, renderHook} from '@testing-library/react-hooks';
import {fakePassage} from '../../../test-util';
import {
	storySceneErrors,
	useStorySceneErrors
} from '../use-story-scene-errors';

const goodScene = ['[scene]', 'id: tavern-night', 'bg: tavern-night'].join('\n');
const badScene = ['[scene]', 'id: broken', 'chast:', '  mira: {at: 0}'].join(
	'\n'
);

describe('storySceneErrors()', () => {
	it('ignores passages with no scene block', () => {
		const passages = [
			fakePassage({text: 'Just prose.\n'}),
			fakePassage({text: 'More prose.\n'})
		];

		expect(storySceneErrors(passages)).toEqual({});
	});

	it('ignores a scene that parses cleanly', () => {
		expect(storySceneErrors([fakePassage({text: goodScene})])).toEqual({});
	});

	it('counts the errors of a broken scene against its passage id', () => {
		const passage = fakePassage({text: badScene});
		const counts = storySceneErrors([passage]);

		expect(counts[passage.id]).toBeGreaterThan(0);
	});

	it('reports only the broken passages of a mixed story', () => {
		const good = fakePassage({text: goodScene});
		const bad = fakePassage({text: badScene});
		const counts = storySceneErrors([good, bad, fakePassage({text: 'Prose.'})]);

		expect(Object.keys(counts)).toEqual([bad.id]);
	});

	it('flags a link pointing at a passage that does not exist', () => {
		const start = fakePassage({
			name: 'Start',
			text: ['[scene]', 'id: start', 'links:', '  on: Nowhere At All'].join('\n')
		});

		expect(storySceneErrors([start])[start.id]).toBeGreaterThan(0);
	});

	it('clears a link error once the target passage appears', () => {
		// Same passage text both times: the cache must not answer from the run where
		// the target was missing.
		const start = fakePassage({
			name: 'Start',
			text: ['[scene]', 'id: start', 'links:', '  on: Street'].join('\n')
		});

		expect(storySceneErrors([start])[start.id]).toBeGreaterThan(0);
		expect(
			storySceneErrors([start, fakePassage({name: 'Street', text: 'Prose.'})])
		).toEqual({});
	});
});

describe('useStorySceneErrors()', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('reports nothing before the debounce elapses', () => {
		const passage = fakePassage({text: badScene});
		const {result} = renderHook(() => useStorySceneErrors([passage], 500));

		expect(result.current).toEqual({});
	});

	it('reports the scan once the debounce elapses', () => {
		const passage = fakePassage({text: badScene});
		const {result} = renderHook(() => useStorySceneErrors([passage], 500));

		act(() => {
			jest.advanceTimersByTime(500);
		});

		expect(result.current[passage.id]).toBeGreaterThan(0);
	});

	it('does not rescan when only a passage position changes', () => {
		const passage = fakePassage({text: badScene, left: 10});
		const {rerender, result} = renderHook(
			({passages}) => useStorySceneErrors(passages, 500),
			{initialProps: {passages: [passage]}}
		);

		act(() => {
			jest.advanceTimersByTime(500);
		});

		const first = result.current;

		rerender({passages: [{...passage, left: 200}]});
		act(() => {
			jest.advanceTimersByTime(500);
		});

		expect(result.current).toBe(first);
	});
});
