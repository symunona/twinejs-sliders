import {renderHook} from '@testing-library/react-hooks';
import {parseSceneText, type SceneParse} from '../use-scene-parse';
import {useFirstBeat} from '../use-first-beat';

const BEATS = [
	'[scene]',
	'cast:',
	'  mira: {at: -0.4}',
	'beats:',
	'  - mira: "Hello."',
	'  - mira: "Again."'
].join('\n');

const NO_BEATS = ['[scene]', 'cast:', '  mira: {at: -0.4}'].join('\n');

/** A parse is a fresh object every debounce tick, and the hook keys off that. */
const parseOf = (text: string): SceneParse => parseSceneText(text);

/** The parse a passage editor publishes before its debounce has fired. */
const pending = (): SceneParse => parseSceneText('');

function render(passageId: string | undefined, parse: SceneParse) {
	const setBeat = jest.fn();
	const view = renderHook(
		(props: {parse: SceneParse; passageId?: string}) =>
			useFirstBeat(props.passageId, props.parse, setBeat),
		{initialProps: {parse, passageId}}
	);

	return {setBeat, view};
}

describe('useFirstBeat', () => {
	it('stands on the first beat once the passage parses', () => {
		const {setBeat, view} = render('p1', pending());

		// The parse is debounced, so the arrival render has nothing to decide on yet.
		expect(setBeat).toHaveBeenCalledWith(0);
		setBeat.mockClear();
		view.rerender({parse: parseOf(BEATS), passageId: 'p1'});
		expect(setBeat).toHaveBeenCalledWith(1);
	});

	it('stays on state 0 for a scene with no beats', () => {
		const {setBeat, view} = render('p1', pending());

		setBeat.mockClear();
		view.rerender({parse: parseOf(NO_BEATS), passageId: 'p1'});
		expect(setBeat).toHaveBeenCalledWith(0);
		expect(setBeat).not.toHaveBeenCalledWith(1);
	});

	it('leaves the scrubber alone while the author edits the same passage', () => {
		const {setBeat, view} = render('p1', pending());

		view.rerender({parse: parseOf(BEATS), passageId: 'p1'});
		setBeat.mockClear();
		// A later parse of the same passage: the author typed, the scrubber does not jump.
		view.rerender({
			parse: parseOf(BEATS.replace('Hello.', 'Hello!')),
			passageId: 'p1'
		});
		expect(setBeat).not.toHaveBeenCalled();
	});

	it('goes back to the first beat when the passage changes', () => {
		const {setBeat, view} = render('p1', parseOf(BEATS));

		expect(setBeat).toHaveBeenLastCalledWith(1);
		setBeat.mockClear();
		// Switching passages: the new editor's parse has not landed, so reset and wait.
		view.rerender({parse: pending(), passageId: 'p2'});
		expect(setBeat).toHaveBeenLastCalledWith(0);
		setBeat.mockClear();
		view.rerender({parse: parseOf(BEATS), passageId: 'p2'});
		expect(setBeat).toHaveBeenCalledWith(1);
	});
});
