import {render, screen} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import * as React from 'react';
import {Generation} from '../generation-store';
import {GenerationTile, tileAspect} from '../generation-tile';

/**
 * The history tile.
 *
 * What is pinned here is what the tile does NOT carry: the model, the aspect ratio and
 * the date used to sit under every thumbnail, and a name field above the buttons, which
 * together left the picture a quarter of the tile. They belong to the preview pane, which
 * is where one image is being decided about.
 */

function generation(overrides: Partial<Generation> = {}): Generation {
	return {
		aspect: '16:9',
		attachments: [],
		blob: new Blob(),
		createdAt: Date.parse('2026-02-03T04:05:06Z'),
		id: 'g_1',
		model: 'imagen-4',
		prompt: 'a desert at dusk',
		provider: 'gemini',
		savedAs: [],
		...overrides
	};
}

function renderTile(props: Partial<React.ComponentProps<typeof GenerationTile>> = {}) {
	const onSave = jest.fn();

	render(
		<GenerationTile
			busy={false}
			generation={generation()}
			onDelete={jest.fn()}
			onEdit={jest.fn()}
			onPreview={jest.fn()}
			onReuse={jest.fn()}
			onSave={onSave}
			url="blob:test"
			{...props}
		/>
	);

	return {onSave};
}

describe('tileAspect', () => {
	it('turns a generated ratio into one CSS understands', () => {
		expect(tileAspect('16:9')).toBe('16 / 9');
		expect(tileAspect('1:1')).toBe('1 / 1');
	});

	it('falls back to a square rather than collapsing the tile', () => {
		expect(tileAspect('')).toBe('1 / 1');
		expect(tileAspect('wide')).toBe('1 / 1');
		expect(tileAspect('0:0')).toBe('1 / 1');
	});
});

describe('GenerationTile', () => {
	it('draws the image at the shape it was generated at', () => {
		renderTile();

		// The button's accessible name is the image's alt--the prompt--so the picture is
		// what this has to be found by.
		const image = screen.getByAltText('a desert at dusk').closest('button');

		expect(image).not.toBeNull();
		expect(image!.style.aspectRatio).toBe('16 / 9');
	});

	it('keeps the model and the date off the tile', () => {
		renderTile();

		expect(screen.queryByText(/imagen-4/)).toBeNull();
		expect(screen.queryByText(/16:9/)).toBeNull();
		expect(screen.getByText('a desert at dusk')).toBeInTheDocument();
	});

	it('asks for the name when saving, not before', async () => {
		const {onSave} = renderTile();

		expect(screen.queryByText('dialogs.assetGenerator.assetName')).toBeNull();
		await userEvent.click(
			screen.getByRole('button', {
				name: 'dialogs.assetGenerator.saveAsBackground'
			})
		);
		expect(
			screen.getByText('dialogs.assetGenerator.assetName')
		).toBeInTheDocument();
		expect(onSave).not.toHaveBeenCalled();
	});
});
