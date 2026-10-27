import {render} from '@testing-library/react';
import * as React from 'react';
import {DEFAULT_HIGHLIGHT, HIGHLIGHT_PRESETS} from '@sliders/scene-types';
import type {StageEntity} from '@sliders/scene-types';
import {
	HIGHLIGHT_PREVIEW_ATTR,
	HIGHLIGHT_PREVIEW_VAR,
	highlightGlow,
	highlightWrites,
	useHighlightPreview
} from '../highlight-preview';

describe('highlightGlow', () => {
	it('draws a preset in its own colour', () => {
		expect(highlightGlow('cold')).toBe(HIGHLIGHT_PRESETS.cold);
		expect(highlightGlow('danger')).toBe(HIGHLIGHT_PRESETS.danger);
	});

	it('falls back to the default glow for nothing and for a story token', () => {
		expect(highlightGlow(undefined)).toBe(DEFAULT_HIGHLIGHT);
		expect(highlightGlow('')).toBe(DEFAULT_HIGHLIGHT);
		expect(highlightGlow('moonlight')).toBe(DEFAULT_HIGHLIGHT);
	});
});

describe('highlightWrites', () => {
	const prop = (id: string) => ({id, kind: 'prop', ref: id} as StageEntity);

	it('writes every selected entity, and clears with reset null', () => {
		expect(highlightWrites([prop('a'), prop('b')], 'gold')).toEqual([
			expect.objectContaining({id: 'a', key: 'highlight', value: 'gold'}),
			expect.objectContaining({id: 'b', key: 'highlight', value: 'gold'})
		]);
		expect(highlightWrites([prop('a')], undefined)).toEqual([
			expect.objectContaining({id: 'a', reset: null, value: undefined})
		]);
	});
});

describe('useHighlightPreview', () => {
	function stage() {
		const root = document.createElement('div');

		for (const id of ['door', 'chest']) {
			const el = document.createElement('div');

			el.className = 'sliders-entity';
			el.dataset.entityId = id;
			root.appendChild(el);
		}

		return root;
	}

	const Probe: React.FC<{root: HTMLElement; token: string | null}> = ({
		root,
		token
	}) => {
		useHighlightPreview(root, ['door'], token);
		return null;
	};

	const box = (root: HTMLElement, id: string) =>
		root.querySelector<HTMLElement>(`[data-entity-id="${id}"]`)!;

	it('lights only the selection, and takes it back', () => {
		const root = stage();
		const {rerender} = render(<Probe root={root} token="cold" />);

		expect(box(root, 'door').hasAttribute(HIGHLIGHT_PREVIEW_ATTR)).toBe(true);
		expect(box(root, 'door').style.getPropertyValue(HIGHLIGHT_PREVIEW_VAR)).toBe(
			HIGHLIGHT_PRESETS.cold
		);
		expect(box(root, 'chest').hasAttribute(HIGHLIGHT_PREVIEW_ATTR)).toBe(false);

		rerender(<Probe root={root} token={null} />);
		expect(box(root, 'door').hasAttribute(HIGHLIGHT_PREVIEW_ATTR)).toBe(false);
		expect(box(root, 'door').style.getPropertyValue(HIGHLIGHT_PREVIEW_VAR)).toBe('');
	});
});
