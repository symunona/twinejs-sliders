import {Passage, Story} from '../stories.types';
import {passageDefaults} from '../defaults';
import {rectsIntersect} from '../../../util/geometry';

/**
 * Where to put passages created from a link in another passage: in a row under the
 * passage that links to them, nudged sideways and then downward until the row lands on
 * empty canvas.
 *
 * Shared so that the automatic `[[…]]` creation and the editor's explicit "create this
 * passage" fix put a new passage in the same place. Two copies of this would drift, and
 * an author would have to learn two different layouts for the same idea.
 */
export function newPassagePositions(
	story: Story,
	parent: Passage,
	count: number
): {left: number; top: number}[] {
	if (count < 1) {
		return [];
	}

	const passageDefs = passageDefaults();
	const passageGap = 25;

	let top = parent.top + parent.height + passageGap;
	const newPassagesWidth =
		count * passageDefs.width + (count - 1) * passageGap;

	// Horizontally center the passages.

	let left = parent.left + (parent.width - newPassagesWidth) / 2;

	// Move them to avoid overlaps.

	const needsMoving = () =>
		story.passages.some(passage =>
			rectsIntersect(passage, {
				left,
				top,
				height: passageDefs.height,
				width: newPassagesWidth
			})
		);

	while (needsMoving()) {
		// Try rightward.

		left += passageDefs.width + passageGap;

		if (!needsMoving()) {
			break;
		}

		// Try leftward.

		left -= 2 * (passageDefs.width + passageGap);

		if (!needsMoving()) {
			break;
		}

		// Move downward and try again.

		left += passageDefs.width + passageGap;
		top += passageDefs.height + passageGap;
	}

	const result: {left: number; top: number}[] = [];

	for (let i = 0; i < count; i++) {
		result.push({left, top});
		left += passageDefs.width + passageGap;
	}

	return result;
}
