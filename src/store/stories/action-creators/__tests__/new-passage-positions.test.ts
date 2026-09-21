import {fakePassage, fakeStory} from '../../../../test-util';
import {passageDefaults} from '../../defaults';
import {passageSizes} from '../../../../util/passage-sizes';
import {newPassagePositions} from '../new-passage-positions';

const gap = 25;

describe('newPassagePositions()', () => {
	it('returns nothing when asked for no passages', () =>
		expect(newPassagePositions(fakeStory(1), fakePassage(), 0)).toEqual([]));

	it('puts one passage centered under its parent', () => {
		const defs = passageDefaults();
		const parent = fakePassage({height: 100, left: 500, top: 200, width: 100});
		const story = fakeStory(0);

		story.passages = [parent];

		expect(newPassagePositions(story, parent, 1)).toEqual([
			{
				height: defs.height,
				left: 500 + (100 - defs.width) / 2,
				top: 200 + 100 + gap,
				width: defs.width
			}
		]);
	});

	// Placement and creation read the size from the same function, so a row laid out for
	// preview-sized cards is also created at that size--see `newPassageSize`.
	it('lays the row out at preview size when the story already uses it', () => {
		const parent = fakePassage({height: 100, left: 500, top: 200, width: 100});
		const previewing = fakePassage({
			...passageSizes.largeWithPreview,
			left: 5000,
			top: 5000
		});
		const story = fakeStory(0);

		story.passages = [parent, previewing];

		const positions = newPassagePositions(story, parent, 2);

		expect(positions[0]).toEqual({
			height: passageSizes.largeWithPreview.height,
			left: 500 + (100 - (2 * passageSizes.largeWithPreview.width + gap)) / 2,
			top: 200 + 100 + gap,
			width: passageSizes.largeWithPreview.width
		});
		expect(positions[1].left - positions[0].left).toBe(
			passageSizes.largeWithPreview.width + gap
		);
	});

	it('spaces a row of passages by the gap', () => {
		const defs = passageDefaults();
		const parent = fakePassage({height: 100, left: 500, top: 200, width: 100});
		const story = fakeStory(0);

		story.passages = [parent];

		const positions = newPassagePositions(story, parent, 3);

		expect(positions).toHaveLength(3);
		expect(positions[1].left - positions[0].left).toBe(defs.width + gap);
		expect(positions[2].left - positions[1].left).toBe(defs.width + gap);
		expect(positions.every(position => position.top === positions[0].top)).toBe(
			true
		);
	});

	it('moves the row off a passage already sitting there', () => {
		const defs = passageDefaults();
		const parent = fakePassage({height: 100, left: 500, top: 200, width: 100});
		const blocker = fakePassage({
			height: defs.height,
			left: 500 + (100 - defs.width) / 2,
			top: 200 + 100 + gap,
			width: defs.width
		});
		const story = fakeStory(0);

		story.passages = [parent, blocker];

		const [position] = newPassagePositions(story, parent, 1);

		expect(position).not.toEqual({left: blocker.left, top: blocker.top});
	});
});
