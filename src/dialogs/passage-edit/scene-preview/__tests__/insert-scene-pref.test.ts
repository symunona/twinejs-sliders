import {
	insertSceneAutoAdvance,
	setInsertSceneAutoAdvance
} from '../insert-scene-pref';

describe('insertSceneAutoAdvance()', () => {
	beforeEach(() => window.localStorage.clear());

	it('is unset until something sets it', () => {
		expect(insertSceneAutoAdvance()).toBeUndefined();
	});

	it('round-trips a value', () => {
		setInsertSceneAutoAdvance(1.5);
		expect(insertSceneAutoAdvance()).toBe(1.5);
	});

	// Zero is a real answer here -- "the scenes I write wait for a click" -- so it must not
	// read back as unset the way a falsy check would make it.
	it('round-trips a zero', () => {
		setInsertSceneAutoAdvance(0);
		expect(insertSceneAutoAdvance()).toBe(0);
	});

	it('clears back to unset', () => {
		setInsertSceneAutoAdvance(2);
		setInsertSceneAutoAdvance(undefined);
		expect(insertSceneAutoAdvance()).toBeUndefined();
	});

	// Hand-edited storage is not worth a thrown error inside a text insert.
	it('reads junk as unset', () => {
		window.localStorage.setItem('sliders.insertScene.autoAdvance', 'slow');
		expect(insertSceneAutoAdvance()).toBeUndefined();

		window.localStorage.setItem('sliders.insertScene.autoAdvance', '-3');
		expect(insertSceneAutoAdvance()).toBeUndefined();
	});
});
