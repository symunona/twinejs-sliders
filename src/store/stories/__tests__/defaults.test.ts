import {newPassageSize, passageDefaults} from '../defaults';
import {passageSizes} from '../../../util/passage-sizes';
import {fakePassage} from '../../../test-util';

describe('newPassageSize()', () => {
	it('is the passage default size in an empty story', () => {
		const defs = passageDefaults();

		expect(newPassageSize([])).toEqual({
			height: defs.height,
			width: defs.width
		});
	});

	it('is the passage default size when no passage previews its scene', () => {
		const defs = passageDefaults();
		const passages = [
			fakePassage(passageSizes.small),
			fakePassage(passageSizes.large),
			fakePassage(passageSizes.tall),
			fakePassage(passageSizes.wide)
		];

		expect(newPassageSize(passages)).toEqual({
			height: defs.height,
			width: defs.width
		});
	});

	// The point of the whole function: an author who sized one passage to show its scene
	// is working that way, and should not have to resize every passage they create after.
	it('follows a passage already sized to preview its scene', () => {
		const passages = [
			fakePassage(passageSizes.small),
			fakePassage(passageSizes.largeWithPreview)
		];

		expect(newPassageSize(passages)).toEqual({
			height: passageSizes.largeWithPreview.height,
			width: passageSizes.largeWithPreview.width
		});
	});
});
