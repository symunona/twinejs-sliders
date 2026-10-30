import {act, renderHook} from '@testing-library/react-hooks';
import {
	addParticleToScene,
	hasParticleSceneTarget,
	registerParticleSceneTarget,
	resetParticleSceneTargets,
	useParticleSceneTarget
} from '../particle-scene-target';

afterEach(() => resetParticleSceneTargets());

describe('particle scene target', () => {
	it('no scene editor: nothing to add to', () => {
		expect(hasParticleSceneTarget()).toBe(false);
		expect(addParticleToScene('fire')).toBe(false);
	});

	it('the last scene editor opened takes it; closing hands back', () => {
		const first = jest.fn();
		const second = jest.fn();
		const stopFirst = registerParticleSceneTarget(first);
		const stopSecond = registerParticleSceneTarget(second);

		expect(addParticleToScene('fire')).toBe(true);
		expect(second).toHaveBeenCalledWith('fire');
		expect(first).not.toHaveBeenCalled();

		stopSecond();
		addParticleToScene('smoke');
		expect(first).toHaveBeenCalledWith('smoke');

		stopFirst();
		expect(hasParticleSceneTarget()).toBe(false);
	});

	it('the hook follows editors opening and closing (button enabled / disabled)', () => {
		const {result} = renderHook(() => useParticleSceneTarget());

		expect(result.current).toBe(false);

		let stop: () => void = () => undefined;

		act(() => {
			stop = registerParticleSceneTarget(jest.fn());
		});
		expect(result.current).toBe(true);
		act(() => stop());
		expect(result.current).toBe(false);
	});
});
