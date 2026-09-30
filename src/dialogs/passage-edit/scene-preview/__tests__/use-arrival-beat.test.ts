import {renderHook} from '@testing-library/react-hooks';
import {useArrivalBeat} from '../use-arrival-beat';

function render(passageId: string | undefined) {
	const setBeat = jest.fn();
	const view = renderHook(
		(props: {passageId?: string}) => useArrivalBeat(props.passageId, setBeat),
		{initialProps: {passageId}}
	);

	return {setBeat, view};
}

describe('useArrivalBeat', () => {
	it('stands on state 0 when the preview opens', () => {
		const {setBeat} = render('p1');

		expect(setBeat).toHaveBeenCalledWith(0);
	});

	it('leaves the scrubber alone while the author edits the same passage', () => {
		const {setBeat, view} = render('p1');

		setBeat.mockClear();
		view.rerender({passageId: 'p1'});
		expect(setBeat).not.toHaveBeenCalled();
	});

	it('goes back to state 0 when the passage changes', () => {
		const {setBeat, view} = render('p1');

		setBeat.mockClear();
		view.rerender({passageId: 'p2'});
		expect(setBeat).toHaveBeenCalledWith(0);
	});
});
