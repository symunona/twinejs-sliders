import {renderHook} from '@testing-library/react-hooks';
import {SceneSidebarTabId} from '../scene-sidebar';
import {useParticleTab} from '../use-particle-tab';

interface Props {
	emitterId?: string;
	hasSelection: boolean;
	active: SceneSidebarTabId;
}

function render(initialProps: Props) {
	const setActive = jest.fn();
	const view = renderHook(
		(props: Props) =>
			useParticleTab(
				props.emitterId,
				props.hasSelection,
				props.active,
				setActive
			),
		{initialProps}
	);

	return {setActive, view};
}

describe('useParticleTab', () => {
	it('opens Particles once the selected emitter resolves', () => {
		const {setActive, view} = render({active: 'selection', hasSelection: true});

		expect(setActive).not.toHaveBeenCalled();
		view.rerender({active: 'selection', emitterId: 'e1', hasSelection: true});
		expect(setActive).toHaveBeenCalledWith('particles');
	});

	it('opens Particles from any non-links tab', () => {
		const {setActive} = render({
			active: 'transform',
			emitterId: 'e1',
			hasSelection: true
		});

		expect(setActive).toHaveBeenCalledWith('particles');
	});

	it('leaves Links alone', () => {
		const {setActive} = render({
			active: 'links',
			emitterId: 'e1',
			hasSelection: true
		});

		expect(setActive).not.toHaveBeenCalled();
	});

	it('leaves the author on the tab they picked after', () => {
		const {setActive, view} = render({
			active: 'particles',
			emitterId: 'e1',
			hasSelection: true
		});

		view.rerender({active: 'selection', emitterId: 'e1', hasSelection: true});
		expect(setActive).not.toHaveBeenCalled();
	});

	it('opens Particles again for another emitter', () => {
		const {setActive, view} = render({
			active: 'selection',
			emitterId: 'e1',
			hasSelection: true
		});

		setActive.mockClear();
		view.rerender({active: 'selection', emitterId: 'e2', hasSelection: true});
		expect(setActive).toHaveBeenCalledWith('particles');
	});

	it('falls back to the selection tab when the selection moves off an emitter', () => {
		const {setActive, view} = render({
			active: 'particles',
			emitterId: 'e1',
			hasSelection: true
		});

		view.rerender({active: 'particles', hasSelection: true});
		expect(setActive).toHaveBeenCalledWith('selection');
	});

	it('does nothing on deselect -- the selection effect restores the tab', () => {
		const {setActive, view} = render({
			active: 'particles',
			emitterId: 'e1',
			hasSelection: true
		});

		view.rerender({active: 'particles', hasSelection: false});
		expect(setActive).not.toHaveBeenCalled();
	});

	it('ignores a non-emitter selection', () => {
		const {setActive} = render({active: 'selection', hasSelection: true});

		expect(setActive).not.toHaveBeenCalled();
	});
});
