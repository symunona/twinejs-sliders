import {fireEvent, render, screen} from '@testing-library/react';
import * as React from 'react';
import {useParticleHover} from '../particle-tile-preview';

const Tile: React.FC<{id: string; enabled?: boolean}> = ({enabled = true, id}) => {
	const hover = useParticleHover(enabled);

	return (
		<div
			data-testid={id}
			onPointerEnter={hover.onPointerEnter}
			onPointerLeave={hover.onPointerLeave}
		>
			{hover.live ? 'live' : 'still'}
		</div>
	);
};

describe('useParticleHover', () => {
	it('is live only while hovered', () => {
		render(<Tile id="a" />);
		expect(screen.getByTestId('a')).toHaveTextContent('still');
		fireEvent.pointerOver(screen.getByTestId('a'));
		expect(screen.getByTestId('a')).toHaveTextContent('live');
		fireEvent.pointerOut(screen.getByTestId('a'));
		expect(screen.getByTestId('a')).toHaveTextContent('still');
	});

	it('keeps at most one preview live', () => {
		render(
			<>
				<Tile id="a" />
				<Tile id="b" />
			</>
		);
		fireEvent.pointerOver(screen.getByTestId('a'));
		// No leave for `a`: a drag or a fast flick can swallow it.
		fireEvent.pointerOver(screen.getByTestId('b'));
		expect(screen.getByTestId('a')).toHaveTextContent('still');
		expect(screen.getByTestId('b')).toHaveTextContent('live');
	});

	it('never goes live for a tile that is not an emitter', () => {
		render(<Tile enabled={false} id="a" />);
		fireEvent.pointerOver(screen.getByTestId('a'));
		expect(screen.getByTestId('a')).toHaveTextContent('still');
	});
});
