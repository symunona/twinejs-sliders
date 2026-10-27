/**
 * `highlight:` in the selection tab: what each choice writes, and the glow it shows on the
 * stage while its menu item is hovered.
 *
 * The player draws the glow on `:hover` of a linked sprite. The editor never gets that
 * hover — its overlay covers the whole stage and takes every pointer event — so the preview
 * is an attribute this file sets on the renderer's own box, painted by `scene-stage.css`
 * with the player's own three drop-shadows. Nothing goes through the stage: a hover writes
 * nothing, and the attribute is gone the moment the pointer leaves.
 */

import * as React from 'react';
import {DEFAULT_HIGHLIGHT, HIGHLIGHT_PRESETS} from '@sliders/scene-types';
import type {EntityId, StageEntity} from '@sliders/scene-types';
import {entityHighlightWrites} from './object-link-panel';
import type {EntityKeyWrite} from './use-scene-writer';

/** The data attribute `scene-stage.css` paints. */
export const HIGHLIGHT_PREVIEW_ATTR = 'data-highlight-preview';

/** The custom property holding the previewed colour. */
export const HIGHLIGHT_PREVIEW_VAR = '--scene-highlight-preview';

/**
 * The colour a token glows in, as the player would draw it: a preset's own, a CSS colour
 * as written, the default for anything else (a story stylesheet's token, which the editor
 * cannot know the look of) and for no token at all.
 */
export function highlightGlow(token: string | undefined): string {
	const value = token?.trim();

	if (!value) {
		return DEFAULT_HIGHLIGHT;
	}

	if (value in HIGHLIGHT_PRESETS) {
		return HIGHLIGHT_PRESETS[value as keyof typeof HIGHLIGHT_PRESETS];
	}

	const supports = (globalThis as {CSS?: {supports?(p: string, v: string): boolean}})
		.CSS?.supports;

	return typeof supports === 'function' &&
		supports.call(globalThis.CSS, 'color', value)
		? value
		: DEFAULT_HIGHLIGHT;
}

/** `highlight:` on every selected entity; `undefined` drops it (`highlight: ~` on a beat). */
export function highlightWrites(
	entities: StageEntity[],
	highlight: string | undefined
): EntityKeyWrite[] {
	return entities.flatMap(entity => entityHighlightWrites(entity, highlight));
}

/**
 * Light the given sprites with `token`'s glow while `token` is not null.
 *
 * Found by comparing `data-entity-id`, not by a selector built from it: an id is the
 * author's word, and jsdom has no `CSS.escape`. Re-run on every change, so a sprite the
 * renderer rebuilds under the hover is lit again.
 */
export function useHighlightPreview(
	root: HTMLElement | null,
	ids: EntityId[],
	token: string | null
): void {
	const key = ids.join('\u0000');

	React.useEffect(() => {
		if (!root || token === null) {
			return;
		}

		const wanted = new Set(key.split('\u0000'));
		const boxes = Array.from(
			root.querySelectorAll<HTMLElement>('.sliders-entity[data-entity-id]')
		).filter(el => wanted.has(el.dataset.entityId ?? ''));
		const colour = highlightGlow(token);

		for (const el of boxes) {
			el.setAttribute(HIGHLIGHT_PREVIEW_ATTR, '');
			el.style.setProperty(HIGHLIGHT_PREVIEW_VAR, colour);
		}

		return () => {
			for (const el of boxes) {
				el.removeAttribute(HIGHLIGHT_PREVIEW_ATTR);
				el.style.removeProperty(HIGHLIGHT_PREVIEW_VAR);
			}
		};
	}, [key, root, token]);
}
