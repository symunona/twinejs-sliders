import type {Scene} from '@sliders/scene-types';
import {effectiveLocks, lockReason} from '../scene-lock';

function scene(locked?: Scene['locked']): Scene {
	return {
		beats: [],
		entities: {},
		links: {},
		...(locked === undefined ? {} : {locked})
	};
}

const OPEN = {cameraLocked: false, locked: false};
const PREFERRED = {cameraLocked: true, locked: true};

describe('effectiveLocks()', () => {
	it('leaves the preference alone when the scene says nothing', () => {
		expect(effectiveLocks(scene(), OPEN)).toEqual(OPEN);
		expect(effectiveLocks(scene(), PREFERRED)).toEqual(PREFERRED);
	});

	it('locks everything on locked: true', () => {
		expect(effectiveLocks(scene(true), OPEN)).toEqual({
			cameraLocked: true,
			locked: true
		});
	});

	// A stage nobody may edit is not a stage whose camera should still swing.
	it('implies the background lock from the whole-stage lock', () => {
		expect(effectiveLocks(scene(true), OPEN).cameraLocked).toBe(true);
	});

	// The narrow case this key exists for: the shot is framed, the sprites are not done.
	it('pins the background and leaves sprites to the author', () => {
		expect(effectiveLocks(scene(['bg']), OPEN)).toEqual({
			cameraLocked: true,
			locked: false
		});
	});

	it('locks the stage on an entities lock', () => {
		expect(effectiveLocks(scene(['entities']), OPEN)).toEqual({
			cameraLocked: true,
			locked: true
		});
	});

	// One-way: a scene pins things, it never hands back a lock the author asked for.
	it('never unlocks what the preference locked', () => {
		expect(effectiveLocks(scene(['bg']), PREFERRED)).toEqual(PREFERRED);
		expect(effectiveLocks(scene(), PREFERRED)).toEqual(PREFERRED);
	});

	it('survives a scene it was given nothing for', () => {
		expect(effectiveLocks(undefined, OPEN)).toEqual(OPEN);
	});
});

describe('lockReason()', () => {
	it('names the scene when the scene is what locked it', () => {
		expect(lockReason(scene(['bg']), 'bg')).toBe('scene');
		expect(lockReason(scene(true), 'entities')).toBe('scene');
	});

	it('says nothing when only the preference locked it', () => {
		expect(lockReason(scene(), 'bg')).toBeUndefined();
		expect(lockReason(scene(['bg']), 'entities')).toBeUndefined();
	});
});
