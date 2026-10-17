import {act, render} from '@testing-library/react';
import * as React from 'react';
import {gradeFilter} from '@sliders/render-dom';
import type {GradeKey} from '@sliders/scene-types';
import {GradeExtremesOverlay} from '../grade-extremes-overlay';

// A stable `t`, as the real hook has (TRAPS: the shared mock hands back a fresh one each
// call). Interpolation echoed so the value in each label is assertable.
jest.mock('react-i18next', () => {
	const t = (key: string, options?: {value?: number}) =>
		options?.value === undefined ? key : `${key} ${options.value}`;

	return {useTranslation: () => ({t})};
});

function art(): HTMLImageElement {
	const img = document.createElement('img');

	img.src = 'http://localhost/mira-idle.png';
	Object.defineProperty(img, 'naturalWidth', {value: 200});
	Object.defineProperty(img, 'naturalHeight', {value: 400});

	return img;
}

function setup(gradeKey: GradeKey | null, picture = art()) {
	const anchor = document.createElement('div');

	document.body.appendChild(anchor);
	anchors.push(anchor);

	const result = render(
		<GradeExtremesOverlay
			anchor={anchor}
			art={picture}
			grade={{warmth: 20}}
			gradeKey={gradeKey}
		/>
	);

	return {...result, anchor, picture};
}

function overlay() {
	return document.querySelector<HTMLElement>(
		'[data-testid="scene-grade-extremes"]'
	);
}

const anchors: HTMLElement[] = [];

afterEach(() => {
	anchors.splice(0).forEach(el => el.remove());
});

describe('GradeExtremesOverlay', () => {
	it('draws the sprite at the hovered slider’s min and max, labelled', async () => {
		const {picture} = setup('brightness');

		// Popper settles its position asynchronously.
		await act(async () => {});

		const el = overlay();

		expect(el).not.toBeNull();
		// Portalled to the body, not inside the render container.
		expect(el!.parentElement).toBe(document.body);
		expect(el!.dataset.gradeKey).toBe('brightness');

		const figures = Array.from(el!.querySelectorAll('figure'));

		expect(
			figures.map(f => f.querySelector('figcaption')!.textContent)
		).toEqual([
			'dialogs.passageEdit.scenePreview.grade.extremeMin -100',
			'dialogs.passageEdit.scenePreview.grade.extremeMax 100'
		]);

		const imgs = figures.map(f => f.querySelector('img')!);

		expect(imgs.map(img => img.src)).toEqual([picture.src, picture.src]);
		// The renderer's own filter for each end, the other keys kept.
		expect(imgs[0].style.filter).toBe(
			gradeFilter({brightness: -100, warmth: 20}).css
		);
		expect(imgs[1].style.filter).toBe(
			gradeFilter({brightness: 100, warmth: 20}).css
		);
		expect(imgs[0].style.filter).not.toBe(imgs[1].style.filter);
		// Fitted to the thumbnail at the art's own aspect.
		expect(imgs[0].style.height).toBe('140px');
		expect(imgs[0].style.width).toBe('70px');
	});

	it('uses each key’s own range', async () => {
		setup('gamma');
		await act(async () => {});

		expect(
			Array.from(overlay()!.querySelectorAll('figure')).map(
				f => f.dataset.value
			)
		).toEqual(['0.1', '3']);
	});

	it('disappears when nothing is hovered', async () => {
		const {anchor, picture, rerender} = setup('contrast');

		await act(async () => {});
		expect(overlay()).not.toBeNull();

		rerender(
			<GradeExtremesOverlay
				anchor={anchor}
				art={picture}
				grade={{warmth: 20}}
				gradeKey={null}
			/>
		);
		await act(async () => {});
		expect(overlay()).toBeNull();
	});

	it('draws nothing for a sprite with no picture (a placeholder)', async () => {
		const anchor = document.createElement('div');

		render(
			<GradeExtremesOverlay
				anchor={anchor}
				art={undefined}
				grade={undefined}
				gradeKey="hue"
			/>
		);
		await act(async () => {});
		expect(overlay()).toBeNull();
	});
});
