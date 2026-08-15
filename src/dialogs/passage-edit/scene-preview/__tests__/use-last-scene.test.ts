import {act, renderHook} from '@testing-library/react-hooks';
import {
	LAST_NAMED_SCENE_KEY,
	LAST_SCENE_KEY,
	readLastScene,
	saveLastScene,
	useLastSceneTracker
} from '../use-last-scene';

const passage = [
	'mood: tense',
	'--',
	'[scene]',
	'id: tavern-night',
	'bg: tavern-night',
	'cast:',
	'  mira: {at: -0.4, frame: idle}',
	'props:',
	'  candle: {at: 0.1}',
	'beats:',
	'  - mira: "Hello."',
	'',
	'[continued]',
	'Ordinary text.'
].join('\n');

beforeEach(() => window.localStorage.clear());

describe('saveLastScene', () => {
	it('stores the scene block, its id, and its entity ids', () => {
		const record = saveLastScene(passage, 'Tavern - Arrival');

		expect(record).toBeDefined();
		expect(record!.id).toBe('tavern-night');
		expect(record!.cast).toEqual(['mira']);
		expect(record!.props).toEqual(['candle']);
		expect(record!.passageName).toBe('Tavern - Arrival');
		// The `[scene]` and `[continued]` lines are not part of the block.
		expect(record!.text).toContain('bg: tavern-night');
		expect(record!.text).not.toContain('[scene]');
		expect(record!.text).not.toContain('Ordinary text.');
		expect(readLastScene()).toEqual(record);
	});

	it('keeps the last NAMED scene, so an overlay always has a target', () => {
		saveLastScene(passage, 'Tavern - Arrival');
		// A scene with no id — a pasted copy, say — replaces the last scene but
		// must not replace the last named one.
		saveLastScene('[scene]\nbg: street-dusk', 'Street');

		expect(readLastScene()!.id).toBeUndefined();
		expect(readLastScene(LAST_NAMED_SCENE_KEY)!.id).toBe('tavern-night');
	});

	it('stores a scene that does not parse cleanly', () => {
		const record = saveLastScene('[scene]\nid: half\nbg:', 'Half Written');

		expect(record!.id).toBe('half');
		expect(record!.text).toContain('bg:');
	});

	it('stores nothing for a passage with no scene', () => {
		expect(saveLastScene('Just text.', 'Plain')).toBeUndefined();
		expect(window.localStorage.getItem(LAST_SCENE_KEY)).toBeNull();
	});

	it('stores nothing for an empty scene block', () => {
		expect(saveLastScene('[scene]\n\n[continued]', 'Empty')).toBeUndefined();
		expect(window.localStorage.getItem(LAST_SCENE_KEY)).toBeNull();
	});
});

describe('useLastSceneTracker', () => {
	beforeEach(() => jest.useFakeTimers());
	afterEach(() => jest.useRealTimers());

	it('does not store the text a passage was opened with', () => {
		renderHook(() => useLastSceneTracker('passage-1', 'Tavern', passage));
		act(() => void jest.advanceTimersByTime(1000));

		expect(readLastScene()).toBeUndefined();
	});

	it('stores the scene once the author changes it', () => {
		const {rerender} = renderHook(
			({text}) => useLastSceneTracker('passage-1', 'Tavern', text),
			{initialProps: {text: passage}}
		);

		rerender({text: passage.replace('Hello.', 'Goodbye.')});
		act(() => void jest.advanceTimersByTime(1000));

		expect(readLastScene()!.text).toContain('Goodbye.');
	});

	it('debounces, storing only where the author stopped', () => {
		const {rerender} = renderHook(
			({text}) => useLastSceneTracker('passage-1', 'Tavern', text),
			{initialProps: {text: passage}}
		);

		rerender({text: passage.replace('Hello.', 'Mid keystroke')});
		act(() => void jest.advanceTimersByTime(100));
		rerender({text: passage.replace('Hello.', 'Done.')});
		act(() => void jest.advanceTimersByTime(1000));

		expect(readLastScene()!.text).toContain('Done.');
	});

	it('takes a new baseline when a different passage is edited', () => {
		const {rerender} = renderHook(
			({id, text}) => useLastSceneTracker(id, 'Tavern', text),
			{initialProps: {id: 'passage-1', text: passage}}
		);

		rerender({id: 'passage-2', text: 'A different scene entirely.'});
		act(() => void jest.advanceTimersByTime(1000));

		expect(readLastScene()).toBeUndefined();
	});
});
