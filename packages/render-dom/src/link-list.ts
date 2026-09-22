/**
 * The link list, drawn INSIDE the stage box — what a scene's `linkList:` asks for.
 *
 * Without that key the player emits the scene's links as ordinary Chapbook markup in `#page`
 * flow under the stage, and for a scene that only wants a way out that is still the right
 * answer. With it the list becomes part of the picture: a positioned layer over the art,
 * placed by the same stage fractions a bubble is placed by, so dragging a menu and dragging
 * a speech bubble in the visual editor write the same kind of number.
 *
 * This is the dialogue layer's smaller sibling and shares its parts on purpose — the same
 * `MeasuringRenderer` slice, the same `pinnedRect` clamp, the same `data-sliders-link`
 * attributes and the same delegated click. A host that already binds one handler for bubble
 * links and clickable props gets this list for free (D3).
 */

import type {Frac2, LinkListStyle} from '@sliders/scene-types';
import type {StageBox} from './coords';
import type {LinkHandler, MeasuringRenderer} from './dialogue';
import {pinnedRect} from './dialogue';
import {injectStyles} from './styles';

export interface LinkListEntry {
	/** What the reader sees and what `onLink` is called with. */
	name: string;
	/** The passage the entry leads to. */
	to: string;
	/** Beats the list's own `icon:`. */
	icon?: string;
	/** Beats the list's own `transition:`. */
	transition?: string;
}

export interface LinkListLayerOptions {
	onLink?: LinkHandler;
	/** Inset in px kept between the list and the stage box edge when clamping. */
	margin?: number;
	document?: Document;
}

/**
 * Where a list with no `at:` goes: centred, near the bottom, clear of the floor.
 *
 * 0.86 rather than 1 because a menu flush with the bottom edge reads as the player's
 * chrome rather than as part of the scene, which is the whole point of drawing it here.
 */
const DEFAULT_AT: Frac2 = {x: 0.5, y: 0.86};

/**
 * Width of a list with no `w:`, as a fraction of the stage box.
 *
 * Wide enough that a long passage name does not wrap on a narrow stage, narrow enough that
 * the art still frames it.
 */
const DEFAULT_W = 0.8;

export class LinkListLayer {
	/** Assignable after construction, matching the `onLink(name)` requirement. */
	onLink?: LinkHandler;

	private opts: LinkListLayerOptions;
	private doc?: Document;
	private mountEl?: HTMLElement;
	private rootEl?: HTMLDivElement;
	private renderer?: MeasuringRenderer;

	private style?: LinkListStyle;
	/** Last list rendered, so an unchanged one is never rebuilt out from under a focus. */
	private rendered?: string;

	private unsubscribe?: () => void;
	private observer?: ResizeObserver;
	private windowResize?: () => void;

	constructor(options: LinkListLayerOptions = {}) {
		this.opts = options;
		this.onLink = options.onLink;
	}

	mount(el: HTMLElement, renderer: MeasuringRenderer): void {
		this.destroy();

		this.mountEl = el;
		this.doc = this.opts.document ?? el.ownerDocument ?? globalThis.document;
		this.renderer = renderer;

		injectStyles(this.doc);

		// Built here but attached only while there is a list to show, so a scene that never
		// wrote `linkList:` leaves nothing of this layer on the stage. The listener below
		// rides the detached element and is still there for the next `set`.
		const root = this.doc.createElement('div');

		root.className = 'sliders-linklist';
		this.rootEl = root;

		// One click handler for every entry, now and in the future.
		root.addEventListener('click', this.handleClick);

		// The renderer tells us when anything moved — after every apply() and every resize.
		this.unsubscribe = renderer.subscribe?.(() => this.reposition());

		if (!this.unsubscribe) {
			if (typeof ResizeObserver !== 'undefined') {
				this.observer = new ResizeObserver(() => this.reposition());
				this.observer.observe(el);
			} else {
				this.windowResize = () => this.reposition();
				globalThis.addEventListener?.('resize', this.windowResize);
			}
		}
	}

	// -----------------------------------------------------------------------
	// Content
	// -----------------------------------------------------------------------

	/** Draw these entries with this style. Empty array or undefined style clears it. */
	set(entries: LinkListEntry[], style?: LinkListStyle): void {
		const root = this.rootEl;

		if (!root || !this.doc) {
			return;
		}

		// No style is the scene not having written `linkList:` at all, and then this layer
		// draws nothing — the player's own markup under the stage is the list. No entries is
		// a scene with nowhere to go, which is a menu of nothing rather than an empty plate.
		if (!style || entries.length === 0) {
			this.clear();

			return;
		}

		this.style = style;

		if (style.as) {
			root.dataset.style = style.as;
		} else {
			delete root.dataset.style;
		}

		if (!root.isConnected) {
			this.mountEl?.appendChild(root);
		}

		const key = listKey(entries, style);

		if (this.rendered !== key) {
			this.rendered = key;
			root.replaceChildren(
				...entries.map(entry => this.createLink(entry, style))
			);
		}

		this.reposition();
	}

	destroy(): void {
		this.rootEl?.removeEventListener('click', this.handleClick);
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.observer?.disconnect();
		this.observer = undefined;

		if (this.windowResize) {
			globalThis.removeEventListener?.('resize', this.windowResize);
			this.windowResize = undefined;
		}

		this.rootEl?.remove();
		this.rootEl = undefined;
		this.style = undefined;
		this.rendered = undefined;
		this.renderer = undefined;
		this.mountEl = undefined;
	}

	// -----------------------------------------------------------------------
	// Positioning
	// -----------------------------------------------------------------------

	/**
	 * Re-ask the renderer how big the stage is. Cheap enough to call after every apply() and
	 * every resize, which is exactly when it is called.
	 */
	reposition(): void {
		const root = this.rootEl;

		if (!root || !this.renderer || !root.isConnected) {
			return;
		}

		const box = this.renderer.stageBox();
		const style = this.style ?? {};
		const margin = this.opts.margin ?? 12;
		const w = (style.w ?? DEFAULT_W) * box.width;

		root.style.width = `${w}px`;
		// An absent `h:` is not a height of zero: the list is as tall as the entries it has,
		// which is what a menu is. Only a stated one fixes the box.
		root.style.height =
			typeof style.h === 'number' ? `${style.h * box.height}px` : '';

		this.place(root, box, w, margin);
	}

	private place(
		root: HTMLElement,
		box: StageBox,
		w: number,
		margin: number
	): void {
		const style = this.style ?? {};
		// Measured after the width is written, because the entries wrap inside it.
		const h =
			typeof style.h === 'number' ? style.h * box.height : root.offsetHeight;
		// The bubbles' own clamp, not a second one: `at` means the same thing here (the
		// CENTRE, in stage fractions from the box's top left) and a list dragged to the same
		// place as a bubble has to land on it. The clamp is what keeps a menu parked half
		// off stage in the YAML still clickable.
		const rect = pinnedRect({at: style.at ?? DEFAULT_AT}, box, w, h, margin);

		if (!rect) {
			return;
		}

		root.style.transform = `translate(${rect.left}px, ${rect.top}px)`;
	}

	// -----------------------------------------------------------------------
	// DOM building
	// -----------------------------------------------------------------------

	private createLink(
		entry: LinkListEntry,
		style: LinkListStyle
	): HTMLAnchorElement {
		const a = this.doc!.createElement('a');

		a.className = 'sliders-link';
		a.href = '#';
		a.dataset.slidersLink = entry.name;

		if (entry.to) {
			a.dataset.slidersTarget = entry.to;
		}

		// The entry's own key beats the list's, the way a beat's `bubble:` keys beat the
		// speaking character's: the specific statement wins over the standing one.
		const icon = entry.icon ?? style.icon;
		const transition = entry.transition ?? style.transition;

		if (icon) {
			a.dataset.icon = icon;
		}

		if (transition) {
			a.dataset.transition = transition;
		}

		a.textContent = entry.name;

		return a;
	}

	/** Take the list off the stage. The root keeps its listener for the next `set`. */
	private clear(): void {
		const root = this.rootEl;

		if (root) {
			delete root.dataset.style;
			root.replaceChildren();
			root.remove();
		}

		this.rendered = undefined;
		this.style = undefined;
	}

	private handleClick = (event: MouseEvent): void => {
		const target = event.target as HTMLElement | null;
		const link = target?.closest?.('[data-sliders-link]') as HTMLElement | null;

		if (!link) {
			return;
		}

		event.preventDefault();
		this.onLink?.(
			link.dataset.slidersLink ?? '',
			link.dataset.slidersTarget || undefined,
			event
		);
	};
}

/**
 * What a rebuild is keyed on: everything that reaches an entry's markup, and nothing that
 * only reaches its position.
 *
 * Rebuilding on every `set` would be correct and would also throw away the focus ring of a
 * reader tabbing through the menu while a beat repaints behind them. The separator is a NUL
 * because no passage name can contain one, so no two different lists can collide on it.
 */
function listKey(entries: LinkListEntry[], style: LinkListStyle): string {
	return entries
		.map(e =>
			[
				e.name,
				e.to,
				e.icon ?? style.icon ?? '',
				e.transition ?? style.transition ?? ''
			].join(' ')
		)
		.join('');
}
