import {render} from '@testing-library/react';
import * as React from 'react';
import type {LibraryEngine} from '@sliders/asset-library';
import {attachCollections} from '../../../store/asset-library/auto-attach';
import {useAttachOnDrop} from '../attach-on-drop';

jest.mock('../../../store/asset-library/auto-attach', () => ({
	attachCollections: jest.fn()
}));

const engine = {} as LibraryEngine;
let arm: (collection: string) => void;

const Harness: React.FC = () => {
	arm = useAttachOnDrop(engine, 'S1', 'My story');

	return (
		<>
			<div className="sliders-assets-dialog">
				<div data-testid="rail" />
			</div>
			<div data-testid="stage" />
		</>
	);
};

function fire(type: string, target: Element | Document) {
	target.dispatchEvent(new Event(type, {bubbles: true, cancelable: true}));
}

describe('useAttachOnDrop', () => {
	it('attaches the source collection when the drag lands outside the Library', () => {
		const {getByTestId} = render(<Harness />);

		arm('pack-b');
		fire('drop', getByTestId('stage'));
		expect(attachCollections).toHaveBeenCalledWith(
			engine,
			'S1',
			['pack-b'],
			'My story'
		);
	});

	it('ignores drops inside the Library (rail move/copy)', () => {
		const {getByTestId} = render(<Harness />);

		arm('pack-b');
		fire('drop', getByTestId('rail'));
		expect(attachCollections).not.toHaveBeenCalled();
	});

	it('disarms on dragend, so a later drop attaches nothing', () => {
		const {getByTestId} = render(<Harness />);

		arm('pack-b');
		fire('dragend', document);
		fire('drop', getByTestId('stage'));
		expect(attachCollections).not.toHaveBeenCalled();
	});

	it('does nothing when no drag was armed', () => {
		const {getByTestId} = render(<Harness />);

		fire('drop', getByTestId('stage'));
		expect(attachCollections).not.toHaveBeenCalled();
	});
});
