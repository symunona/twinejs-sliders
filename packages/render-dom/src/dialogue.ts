/**
 * Speech bubbles and narration boxes.
 *
 * Bubbles are DOM in EVERY renderer (D2) — they never compute their own position, they ask
 * the renderer `measure(who, 'bubble')` and place themselves at whatever point comes back.
 * That is the whole reason a three.js renderer can drop in later without touching this file:
 * swap the renderer, the bubbles still land on the right shoulder.
 *
 * Links inside bubble text are real `<a>` elements (D3), so hover, focus, keyboard nav and
 * screen readers come for free.
 */

import type {BubblePlace, BubbleStyle, EntityId, Vec2} from '@sliders/scene-types';
import type {BubblePadding, BubbleSide} from './bubble-shapes';
import {bubbleShape, hashSeed, isBubbleShape} from './bubble-shapes';
import type {StageBox} from './coords';
import {injectStyles} from './styles';

export type {BubbleSide};

/** The slice of a renderer a dialogue layer needs. Any renderer can satisfy it. */
export interface MeasuringRenderer {
	measure(entityId: EntityId, anchor: string): Vec2 | null;
	stageBox(): StageBox;
	subscribe?(fn: () => void): () => void;
}

export interface BubbleSpec {
	/** The speaking entity. Must exist on the stage or the bubble falls back to the centre. */
	who: EntityId;
	text: string;
	/** Optional speaker label drawn above the text. */
	name?: string;
	/** Anchor to hang off. `bubble` is the one every character manifest must define (D2). */
	anchor?: string;
	/**
	 * Look and placement. Already merged from the speaking character's defaults and the
	 * beat's own keys by the time it gets here — this layer never reads a character.
	 */
	style?: BubbleStyle;
}

/**
 * Fired when a `[[link]]` in bubble or box text is activated.
 *
 * `event` is the click that did it, so a host can tell a plain follow-the-link from a
 * modified one — the editor preview opens the target passage on ctrl/cmd-click.
 */
export type LinkHandler = (
	name: string,
	target?: string,
	event?: MouseEvent
) => void;

export interface DialogueLayerOptions {
	onLink?: LinkHandler;
	/** Gap in px between the anchor point and the tail tip. */
	tailGap?: number;
	/** Inset in px kept between a bubble and the stage box edge when clamping. */
	margin?: number;
	document?: Document;
}

/** Half the tail's base width — see `.sliders-bubble-tail` in styles.ts. */
const TAIL_HALF = 9;

/** Keep the tail this far from the bubble's rounded corners. */
const TAIL_INSET = 8;

/** The anchor every character defines for "where the words come out". */
const MOUTH_ANCHOR = 'mouth';

/**
 * What an `sizing: absolute` bubble is when the author gave no numbers.
 *
 * Half the stage wide and a fifth of it tall is a caption panel: enough for two or three
 * lines at a readable size, and small enough that the default does not cover the art it is
 * spoken over.
 */
const ABSOLUTE_W = 0.5;
const ABSOLUTE_H = 0.2;

/**
 * Type size in an absolute bubble, as a fraction of the STAGE height before fitting.
 *
 * Measured against the stage rather than against the bubble because the whole point of
 * `sizing: absolute` is that the picture is composed at a fixed scale: two panels of
 * different sizes on one slide should still be set in the same type.
 */
const ABSOLUTE_TEXT = 0.055;

/** How far the fitter may take the type from that base. */
const FIT_MIN = 0.25;
const FIT_MAX = 2.4;

/**
 * A fixed bubble's inset, as a fraction of the STAGE height, for the same reason the type
 * is. The numbers are the stylesheet's 10px and 14px at a 900px stage, so nothing composed
 * at that size moves.
 */
const PAD_Y = 10 / 900;
const PAD_X = 14 / 900;

/**
 * The narration box's inset, in the same stage fractions, from its own `padding: 16px 22px`
 * at a 900px stage. Wider than a bubble's because the bar spans the stage: the two only
 * read as the same margin when each keeps its own number.
 */
const BOX_PAD_Y = 16 / 900;
const BOX_PAD_X = 22 / 900;

interface BubbleRecord {
	el: HTMLDivElement;
	body: HTMLDivElement;
	tail: HTMLDivElement;
	shape: HTMLDivElement;
	spec: BubbleSpec;
	/** Last text rendered, so unchanged text is never re-parsed or re-created. */
	rendered?: string;
	/** Last drawn shape, so an unchanged one is never rebuilt from a string. */
	shapeKey?: string;
	/** Room the drawn shape asked the text to leave it. */
	padding?: BubblePadding;
}

export class DialogueLayer {
	/** Assignable after construction, matching the `onLink(name)` requirement. */
	onLink?: LinkHandler;

	private opts: DialogueLayerOptions;
	private doc?: Document;
	private mountEl?: HTMLElement;
	private rootEl?: HTMLDivElement;
	private boxEl?: HTMLDivElement;
	/** The box's words, so the fitter has something to measure. See `setBox`. */
	private boxBody?: HTMLDivElement;
	private boxStyle?: BubbleStyle;
	private renderer?: MeasuringRenderer;

	private bubbles = new Map<EntityId, BubbleRecord>();
	private unsubscribe?: () => void;
	private observer?: ResizeObserver;
	private windowResize?: () => void;

	constructor(options: DialogueLayerOptions = {}) {
		this.opts = options;
		this.onLink = options.onLink;
	}

	mount(el: HTMLElement, renderer: MeasuringRenderer): void {
		this.destroy();

		this.mountEl = el;
		this.doc = this.opts.document ?? el.ownerDocument ?? globalThis.document;
		this.renderer = renderer;

		injectStyles(this.doc);

		const root = this.doc.createElement('div');

		root.className = 'sliders-dialogue';
		el.appendChild(root);
		this.rootEl = root;

		// One click handler for every link, now and in the future.
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

	/** Show exactly one bubble, from the speaker of a `say` beat. */
	say(who: EntityId, text: string, opts: Omit<BubbleSpec, 'who' | 'text'> = {}): void {
		this.setBubbles([{who, text, ...opts}]);
	}

	/** Reconciled against what is already on screen — unchanged bubbles are never rebuilt. */
	setBubbles(specs: BubbleSpec[]): void {
		if (!this.rootEl || !this.doc) {
			return;
		}

		const seen = new Set<EntityId>();

		for (const spec of specs) {
			seen.add(spec.who);

			let rec = this.bubbles.get(spec.who);

			if (!rec) {
				rec = this.createBubble(spec);
				this.bubbles.set(spec.who, rec);
			}

			rec.spec = spec;
			this.renderBubbleContent(rec);
		}

		for (const [who, rec] of this.bubbles) {
			if (!seen.has(who)) {
				rec.el.remove();
				this.bubbles.delete(who);
			}
		}

		this.reposition();
	}

	/** The narration bar. `null` hides it. */
	setBox(text: string | null, style?: BubbleStyle): void {
		if (!this.rootEl || !this.doc) {
			return;
		}

		if (text === null || text === undefined) {
			this.boxEl?.remove();
			this.boxEl = undefined;
			this.boxBody = undefined;
			this.boxStyle = undefined;

			return;
		}

		if (!this.boxEl) {
			this.boxEl = this.doc.createElement('div');
			this.boxEl.className = 'sliders-box';
			// The words go in an inner element for the same reason a bubble's do: the fitter
			// asks how tall the text WANTS to be, and an element that is itself the fixed
			// rectangle can only ever answer with the rectangle.
			this.boxBody = this.doc.createElement('div');
			this.boxBody.className = 'sliders-box-body';
			this.boxEl.appendChild(this.boxBody);
			this.rootEl.appendChild(this.boxEl);
			this.fadeIn(this.boxEl);
		}

		this.boxStyle = style;
		applyStyleAttributes(this.boxEl, style);

		if (this.boxEl.dataset.text !== text) {
			this.boxEl.dataset.text = text;
			this.renderRichText(this.boxBody!, text);
		}

		this.positionBox();
	}

	clear(): void {
		for (const rec of this.bubbles.values()) {
			rec.el.remove();
		}

		this.bubbles.clear();
		this.setBox(null);
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
		this.boxEl = undefined;
		this.boxBody = undefined;
		this.bubbles.clear();
		this.renderer = undefined;
		this.mountEl = undefined;
	}

	// -----------------------------------------------------------------------
	// Positioning
	// -----------------------------------------------------------------------

	/**
	 * Re-ask the renderer where everyone is. Cheap enough to call after every apply() and
	 * every resize, which is exactly when it is called.
	 */
	reposition(): void {
		if (!this.renderer) {
			return;
		}

		const box = this.renderer.stageBox();

		for (const rec of this.bubbles.values()) {
			this.positionBubble(rec, box);
		}

		this.positionBox();
	}

	private positionBubble(rec: BubbleRecord, box: StageBox): void {
		const style = rec.spec.style;
		const anchorName = rec.spec.anchor ?? 'bubble';
		// A detached bubble belongs to the stage: it never asks where its speaker is, so it
		// keeps its place when they walk off, and it grows no tail back to them.
		const detached = style?.anchor === 'scene';
		// `tail:` names the point the tail reaches for, in stage fractions — a door, a
		// window, somebody off the side of the frame. It stands in for the speaker's own
		// anchor everywhere the anchor is used, so an un-pinned bubble also hangs off it.
		const anchor = detached
			? null
			: tailPoint(style, box) ??
			  this.renderer?.measure(rec.spec.who, anchorName) ??
			  null;
		const el = rec.el;
		const margin = this.opts.margin ?? 12;
		const gap = this.opts.tailGap ?? 12;

		const {w, h} = this.sizeBubble(rec, box);
		const pinned =
			pinnedRect(style, box, w, h, margin) ??
			(detached ? centreRect(box, w, h, margin) : undefined);

		if (pinned) {
			// The author said where this goes. The tail still points home when the speaker is
			// on stage — a bubble parked on the left with a tail reaching right reads as
			// theirs — and simply disappears for a narrator with nobody to point at.
			el.dataset.anchored = anchor ? 'true' : 'false';
			el.style.transform = `translate(${pinned.left}px, ${pinned.top}px)`;

			const tail = anchor ? tailToward(anchor, pinned, w, h) : undefined;

			setAnchorData(el, anchor ? localPoint(anchor, pinned) : null);

			if (!tail) {
				el.dataset.side = 'above';
				rec.tail.style.display = 'none';
				this.paintShape(rec, {w, h, side: 'above', anchor: null});

				return;
			}

			el.dataset.side = tail.side;
			rec.tail.style.display = '';
			this.placeTail(rec, tail.side, tail.offset);
			this.paintShape(rec, {
				w,
				h,
				side: tail.side,
				anchor: localPoint(anchor!, pinned)
			});

			return;
		}

		if (!anchor) {
			// Speaker is not on stage (bad `who`, or an exit already finished). Still show the
			// line — losing dialogue is worse than a mispositioned bubble.
			el.dataset.anchored = 'false';
			el.dataset.side = 'above';
			rec.tail.style.display = 'none';
			setAnchorData(el, null);
			el.style.transform = `translate(${box.left + (box.width - w) / 2}px, ${
				box.top + margin
			}px)`;
			this.paintShape(rec, {w, h, side: 'above', anchor: null});

			return;
		}

		el.dataset.anchored = 'true';
		rec.tail.style.display = '';

		// The mouth is what the tail points back at, so the mouth -> anchor vector is the
		// author's statement of which way the bubble leans. A flipped character mirrors both
		// anchors, so it leans the other way for free.
		const mouth = this.renderer?.measure(rec.spec.who, MOUTH_ANCHOR) ?? null;
		const place = placeBubble({anchor, mouth, box, w, h, gap, margin});

		el.dataset.side = place.side;
		el.style.transform = `translate(${place.left}px, ${place.top}px)`;
		setAnchorData(el, localPoint(anchor, place));
		this.placeTail(rec, place.side, place.tail);
		this.paintShape(rec, {
			w,
			h,
			side: place.side,
			anchor: localPoint(anchor, place)
		});
	}

	// -----------------------------------------------------------------------
	// Size
	// -----------------------------------------------------------------------

	/**
	 * Settle the bubble's box, and report it.
	 *
	 * Two modes, and they pull in opposite directions (`BubbleSizing`). `auto` lets the
	 * words decide the height and only caps the width. `absolute` states the rectangle in
	 * fractions of the stage and scales the type until the words fit it.
	 *
	 * The loop is here because a drawn shape's padding is a fraction of the box, and the
	 * box under `auto` is a function of the padding: fewer than a couple of passes and a
	 * cloud's first frame has its text against the edge. It converges immediately in
	 * practice — the second pass changes the height by a line at most — so it is capped
	 * rather than run to a fixed point.
	 */
	private sizeBubble(rec: BubbleRecord, box: StageBox): {w: number; h: number} {
		const style = rec.spec.style;
		const el = rec.el;
		const absolute = style?.sizing === 'absolute';
		// Both fixed sizings state the same rectangle; they differ only in what the words
		// do inside it. `absolute` fits the type to the box, `manual` leaves the type alone
		// and lets the box clip — the author dragged that edge, so it is the edge they meant.
		const fixed = absolute || style?.sizing === 'manual';

		if (fixed) {
			const w = (style?.w ?? ABSOLUTE_W) * box.width;
			const h = (style?.h ?? ABSOLUTE_H) * box.height;

			el.style.width = `${w}px`;
			el.style.height = `${h}px`;
			// A fixed rectangle is stated against the stage and so is its type, so its inset
			// has to be as well. A flat 10px is a tenth of a caption panel on a 1600-wide
			// stage and a third of one on a phone.
			el.style.setProperty('--sliders-bubble-pad-y', `${box.height * PAD_Y}px`);
			el.style.setProperty('--sliders-bubble-pad-x', `${box.height * PAD_X}px`);
			this.applyPadding(rec, w, h);

			if (absolute) {
				this.fitText(rec.el, rec.body, box, w, h, style, rec.padding);
			} else {
				rec.body.style.fontSize = '';
			}

			return {w, h};
		}

		el.style.height = '';
		el.style.width = style?.w ? `${style.w * box.width}px` : '';
		rec.body.style.fontSize = '';

		let w = el.offsetWidth;
		let h = el.offsetHeight;

		for (let pass = 0; pass < 3; pass++) {
			if (!this.applyPadding(rec, w, h)) {
				break;
			}

			const nw = el.offsetWidth;
			const nh = el.offsetHeight;

			if (Math.abs(nw - w) < 1 && Math.abs(nh - h) < 1) {
				w = nw;
				h = nh;
				break;
			}

			w = nw;
			h = nh;
		}

		return {w, h};
	}

	/** Returns true when the padding changed, i.e. when the box must be measured again. */
	private applyPadding(rec: BubbleRecord, w: number, h: number): boolean {
		const name = rec.spec.style?.as;

		if (!isBubbleShape(name) || w <= 0 || h <= 0) {
			if (!rec.padding) {
				return false;
			}

			rec.padding = undefined;
			rec.el.style.removeProperty('--sliders-bubble-pad');
			rec.el.style.removeProperty('padding');

			return true;
		}

		const shape = bubbleShape(name, {
			width: w,
			height: h,
			side: 'above',
			anchor: null,
			color: rec.spec.style?.bg ?? '',
			accent: rec.spec.style?.accent ?? '',
			seed: this.seedFor(rec)
		})!;
		const pad = shape.padding;
		const was = rec.padding;

		if (
			was &&
			Math.abs(was.top - pad.top) < 0.5 &&
			Math.abs(was.left - pad.left) < 0.5
		) {
			return false;
		}

		rec.padding = pad;
		rec.el.style.padding = `${pad.top}px ${pad.right}px ${pad.bottom}px ${pad.left}px`;

		return true;
	}

	/**
	 * Grow or shrink the type until the words fill the fixed box without spilling.
	 *
	 * A binary search rather than a measure-and-divide: the text wraps, so height is a step
	 * function of the type size and there is no formula to divide by. Twelve passes get
	 * within a thousandth of the largest size that fits, and each pass is one reflow of one
	 * small element.
	 */
	private fitText(
		el: HTMLElement,
		body: HTMLElement,
		box: StageBox,
		w: number,
		h: number,
		style: BubbleStyle | undefined,
		known?: BubblePadding
	): void {
		// The computed padding, not the drawn shape's `known` figure: that one is only ever
		// set by a DRAWN shape, and a bubble without one still has the stylesheet's
		// `padding: 10px 14px`. Fitting to the outer box left the last line under the
		// padding, where the clip cut it in half.
		const pad = elementPadding(el, known);
		const innerW = w - (pad.left + pad.right);
		const innerH = h - (pad.top + pad.bottom);
		const base = box.height * ABSOLUTE_TEXT * (style?.size ?? 1);
		const fits = (size: number) => {
			body.style.fontSize = `${size}px`;

			return body.scrollHeight <= innerH + 0.5 && body.scrollWidth <= innerW + 0.5;
		};

		let lo = base * FIT_MIN;
		let hi = base * FIT_MAX;

		if (fits(hi)) {
			return;
		}

		for (let i = 0; i < 12; i++) {
			const mid = (lo + hi) / 2;

			if (fits(mid)) {
				lo = mid;
			} else {
				hi = mid;
			}
		}

		body.style.fontSize = `${lo}px`;
	}

	// -----------------------------------------------------------------------
	// Drawn shapes
	// -----------------------------------------------------------------------

	/**
	 * The seed a shape's wobble comes from.
	 *
	 * Speaker plus style token, so one character's balloon keeps its outline for the whole
	 * scene while it moves and re-wraps, and two characters on stage do not get identical
	 * ones. Not the text: a balloon that changes shape when a word changes flickers under
	 * the editor's live re-parse.
	 */
	private seedFor(rec: BubbleRecord): number {
		return hashSeed(`${rec.spec.who}:${rec.spec.style?.as ?? ''}`);
	}

	private paintShape(
		rec: BubbleRecord,
		at: {w: number; h: number; side: BubbleSide; anchor: Vec2 | null}
	): void {
		const style = rec.spec.style;
		const name = style?.as;

		if (!isBubbleShape(name) || at.w <= 0 || at.h <= 0) {
			if (rec.shapeKey) {
				rec.shapeKey = undefined;
				rec.shape.replaceChildren();
				delete rec.el.dataset.shape;
			}

			return;
		}

		// Sub-pixel jitter from a reflow must not rebuild the drawing on every frame.
		const key = [
			name,
			Math.round(at.w),
			Math.round(at.h),
			at.side,
			at.anchor ? `${Math.round(at.anchor.x)},${Math.round(at.anchor.y)}` : 'none',
			style?.bg ?? '',
			style?.accent ?? ''
		].join('|');

		rec.el.dataset.shape = name;

		if (rec.shapeKey === key) {
			return;
		}

		rec.shapeKey = key;

		const drawn = bubbleShape(name, {
			width: at.w,
			height: at.h,
			side: at.side,
			anchor: at.anchor,
			color: style?.bg ?? '',
			accent: style?.accent ?? '',
			seed: this.seedFor(rec)
		})!;

		rec.shape.innerHTML = drawn.svg;
	}

	/**
	 * The tail rides the edge facing the anchor: horizontally under or over a bubble that sits
	 * above or below, vertically beside one that sits left or right. The other axis is
	 * cleared, or a leftover inline value fights the stylesheet after a side change.
	 */
	private placeTail(rec: BubbleRecord, side: BubbleSide, offset: number): void {
		const along = offset - TAIL_HALF;
		const horizontal = side === 'above' || side === 'below';

		rec.tail.style.left = horizontal ? `${along}px` : '';
		rec.tail.style.top = horizontal ? '' : `${along}px`;
	}

	private positionBox(): void {
		if (!this.boxEl || !this.renderer) {
			return;
		}

		// The narration bar spans the stage box, not the letterbox bars.
		const box = this.renderer.stageBox();
		const style = this.boxStyle;
		const el = this.boxEl;
		const margin = this.opts.margin ?? 12;

		const absolute = style?.sizing === 'absolute';
		// Both fixed sizings state the rectangle, exactly as on a bubble; they differ only in
		// what the words do inside it. `absolute` fits the type to the bar, `manual` leaves
		// the type alone and lets the bar clip — the author dragged that edge on purpose.
		const fixed = absolute || style?.sizing === 'manual';
		const width = (style?.w ?? 1) * box.width;
		const height = (style?.h ?? ABSOLUTE_H) * box.height;
		const body = this.boxBody;

		el.style.width = `${width}px`;
		// A narration box is a full-width bar by default, so `w` alone has always been
		// enough for it. A fixed sizing states the other side as well — which is what the
		// editor writes the moment an author drags the bar's top or bottom edge, and
		// without this the handle would move and nothing would happen.
		el.style.height = fixed ? `${height}px` : '';

		if (fixed) {
			// The rectangle is stated against the stage and so is the type inside it, so the
			// inset has to be too. A flat 16px is a margin on a 1600-wide stage and a third of
			// the bar on a phone.
			el.style.setProperty('--sliders-box-pad-y', `${box.height * BOX_PAD_Y}px`);
			el.style.setProperty('--sliders-box-pad-x', `${box.height * BOX_PAD_X}px`);
		} else {
			el.style.removeProperty('--sliders-box-pad-y');
			el.style.removeProperty('--sliders-box-pad-x');
		}

		if (body) {
			// Cleared first either way: a beat that drops `sizing:` must not keep the last
			// fitted size, and the fitter needs the base size to search from.
			body.style.fontSize = '';

			if (absolute) {
				this.fitText(el, body, box, width, height, style);
			}
		}

		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const pinned = pinnedRect(style, box, w, h, margin);

		if (pinned) {
			el.dataset.pinned = 'true';
			el.style.left = `${pinned.left}px`;
			el.style.top = `${pinned.top}px`;
			el.style.bottom = 'auto';

			return;
		}

		el.dataset.pinned = 'false';
		el.style.left = `${box.left}px`;
		el.style.top = 'auto';
		el.style.bottom = `${Math.max(
			0,
			(this.mountEl?.clientHeight ?? 0) - (box.top + box.height)
		)}px`;
	}

	// -----------------------------------------------------------------------
	// DOM building
	// -----------------------------------------------------------------------

	private createBubble(spec: BubbleSpec): BubbleRecord {
		const el = this.doc!.createElement('div');

		el.className = 'sliders-bubble';
		el.dataset.speaker = spec.who;

		const body = this.doc!.createElement('div');

		body.className = 'sliders-bubble-body';

		const tail = this.doc!.createElement('div');

		tail.className = 'sliders-bubble-tail';

		// Behind the text and outside the box: a drawn shape spills past the bubble on every
		// side (its tail, its outline, its offset slab), and the text must not move for it.
		const shape = this.doc!.createElement('div');

		shape.className = 'sliders-bubble-shape';

		el.append(shape, body, tail);
		this.rootEl!.appendChild(el);
		this.fadeIn(el);

		return {el, body, tail, shape, spec};
	}

	private renderBubbleContent(rec: BubbleRecord): void {
		applyStyleAttributes(rec.el, rec.spec.style);

		const key = `${rec.spec.name ?? ''} ${rec.spec.text}`;

		if (rec.rendered === key) {
			return;
		}

		rec.rendered = key;
		rec.el.dataset.speaker = rec.spec.who;
		rec.body.replaceChildren();

		if (rec.spec.name) {
			const name = this.doc!.createElement('span');

			name.className = 'sliders-bubble-name';
			name.textContent = rec.spec.name;
			rec.body.appendChild(name);
		}

		const text = this.doc!.createElement('span');

		this.renderRichText(text, rec.spec.text);
		rec.body.appendChild(text);
	}

	/** Text with `[[links]]` turned into real anchors. Everything else goes in as text. */
	private renderRichText(target: HTMLElement, text: string): void {
		target.replaceChildren();

		for (const token of parseLinkText(text)) {
			if (token.kind === 'text') {
				target.appendChild(this.doc!.createTextNode(token.value));
				continue;
			}

			const a = this.doc!.createElement('a');

			a.className = 'sliders-link';
			a.href = '#';
			a.dataset.slidersLink = token.name;

			if (token.target) {
				a.dataset.slidersTarget = token.target;
			}

			a.textContent = token.name;
			target.appendChild(a);
		}
	}

	private fadeIn(el: HTMLElement): void {
		el.dataset.entering = 'true';
		void el.offsetWidth;
		el.dataset.entering = 'false';
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


// ---------------------------------------------------------------------------
// Style
// ---------------------------------------------------------------------------

/**
 * A style reaches CSS two ways: the token as `data-style`, so a preset or a story's own
 * rule can match on it, and the one-off colour keys as custom properties, so they layer
 * over whatever the preset already set instead of replacing it.
 */
/**
 * A character's own `bubble:` defaults, with the beat's keys over the top.
 *
 * Merging is per key rather than all-or-nothing on purpose: a narrator whose character
 * says `place: top` keeps that placement when one line of theirs is written `as: yell`.
 */
export function mergeBubbleStyle(
	base: BubbleStyle | undefined,
	over: BubbleStyle | undefined
): BubbleStyle | undefined {
	if (!base) {
		return over;
	}

	return over ? {...base, ...over} : base;
}

export function applyStyleAttributes(
	el: HTMLElement,
	style: BubbleStyle | undefined
): void {
	if (style?.as) {
		el.dataset.style = style.as;
	} else {
		delete el.dataset.style;
	}

	if (style?.sizing) {
		el.dataset.sizing = style.sizing;
	} else {
		delete el.dataset.sizing;
	}

	if (style?.anchor) {
		el.dataset.anchorMode = style.anchor;
	} else {
		delete el.dataset.anchorMode;
	}

	setVar(el, '--sliders-bubble-bg', style?.bg);
	setVar(el, '--sliders-bubble-color', style?.color);
	setVar(el, '--sliders-bubble-font', style?.font);
	setVar(el, '--sliders-bubble-size', style?.size ? `${style.size}em` : undefined);
}

function setVar(el: HTMLElement, name: string, value: string | undefined): void {
	if (value) {
		el.style.setProperty(name, value);
	} else {
		el.style.removeProperty(name);
	}
}

/**
 * The room a bubble's own box leaves its words.
 *
 * Read off the element rather than off the shape, because a bubble has padding either way:
 * a drawn shape writes its own inline, everything else keeps the stylesheet's. `known` is
 * the shape's figure, used only where there is no view to compute a style in.
 */
function elementPadding(el: HTMLElement, known?: BubblePadding): BubblePadding {
	const zero = known ?? {top: 0, right: 0, bottom: 0, left: 0};
	const computed = el.ownerDocument?.defaultView?.getComputedStyle?.(el);

	if (!computed) {
		return zero;
	}

	const px = (value: string, fallback: number) => {
		const n = parseFloat(value);

		return Number.isFinite(n) ? n : fallback;
	};

	return {
		top: px(computed.paddingTop, zero.top),
		right: px(computed.paddingRight, zero.right),
		bottom: px(computed.paddingBottom, zero.bottom),
		left: px(computed.paddingLeft, zero.left)
	};
}

// ---------------------------------------------------------------------------
// Pinned placement
// ---------------------------------------------------------------------------

/**
 * Where an authored `at:` or `place:` puts the bubble, or undefined when the author said
 * nothing and it should hang off the speaker.
 *
 * `at` is the bubble's CENTRE in fractions of the stage box, which is what the editor
 * writes when a bubble is dragged: a centre survives a resize, where a corner would drift.
 * Both are clamped into the box, so a bubble can be parked half off stage in the YAML and
 * still be readable.
 */
export function pinnedRect(
	style: BubbleStyle | undefined,
	box: StageBox,
	w: number,
	h: number,
	margin: number
): {left: number; top: number} | undefined {
	const minLeft = box.left + margin;
	const maxLeft = box.left + box.width - w - margin;
	const minTop = box.top + margin;
	const maxTop = box.top + box.height - h - margin;

	if (style?.at) {
		return {
			left: clamp(box.left + style.at.x * box.width - w / 2, minLeft, maxLeft),
			top: clamp(box.top + style.at.y * box.height - h / 2, minTop, maxTop)
		};
	}

	const place = style?.place;

	if (!place || place === 'auto') {
		return undefined;
	}

	const centreX = box.left + (box.width - w) / 2;
	const centreY = box.top + (box.height - h) / 2;
	const left = place.includes('left')
		? minLeft
		: place.includes('right')
		? maxLeft
		: centreX;
	const top = place.startsWith('top')
		? minTop
		: place.startsWith('bottom')
		? maxTop
		: centreY;

	return {left: clamp(left, minLeft, maxLeft), top: clamp(top, minTop, maxTop)};
}

/**
 * The point an authored `tail:` names, in mount px — or nothing when the author named none.
 *
 * Unclamped, unlike `pinnedRect`: a tail is allowed to reach for something off the side of
 * the frame, and that is most of what naming one is for. The bubble itself still gets
 * clamped into the box, so the worst an out-of-range tail can do is lean hard.
 */
export function tailPoint(
	style: BubbleStyle | undefined,
	box: StageBox
): Vec2 | undefined {
	if (!style?.tail) {
		return undefined;
	}

	return {
		x: box.left + style.tail.x * box.width,
		y: box.top + style.tail.y * box.height
	};
}

/** A point in mount px, expressed from a bubble's own top left. */
function localPoint(point: Vec2, rect: {left: number; top: number}): Vec2 {
	return {x: point.x - rect.left, y: point.y - rect.top};
}

/**
 * Publish where the tail is reaching, from the bubble's own top left, as data attributes.
 *
 * The editor needs this point to draw a draggable anchor cross, and it is the only place
 * that knows it: it may come from the speaker's manifest anchor, from an authored `tail:`,
 * or from nowhere at all. Expressed from the bubble rather than from the stage so a reader
 * of it needs no way to convert mount pixels into its own — the bubble's rectangle is
 * something anyone can measure. Rounded, because it is re-written on every reposition and
 * a sub-pixel churn would invalidate the editor's own change check sixty times a second.
 */
function setAnchorData(el: HTMLElement, point: Vec2 | null): void {
	if (!point) {
		delete el.dataset.anchorX;
		delete el.dataset.anchorY;

		return;
	}

	el.dataset.anchorX = String(Math.round(point.x));
	el.dataset.anchorY = String(Math.round(point.y));
}

/**
 * Where a DETACHED bubble goes when the author named no place at all.
 *
 * Dead centre, because a detached bubble has nothing to be beside: the alternatives all
 * imply a relationship (over the speaker, along the bottom like narration) that
 * `anchor: scene` is the author saying they do not want.
 */
function centreRect(
	box: StageBox,
	w: number,
	h: number,
	margin: number
): {left: number; top: number} {
	return {
		left: clamp(
			box.left + (box.width - w) / 2,
			box.left + margin,
			box.left + box.width - w - margin
		),
		top: clamp(
			box.top + (box.height - h) / 2,
			box.top + margin,
			box.top + box.height - h - margin
		)
	};
}

/**
 * Which edge of a pinned bubble faces the speaker, and where along it the tail goes.
 *
 * Returns nothing when the anchor is inside the bubble: a tail pointing at something the
 * bubble is already covering is noise, and drawing it would put a spike over the text.
 */
export function tailToward(
	anchor: Vec2,
	rect: {left: number; top: number},
	w: number,
	h: number
): {side: BubbleSide; offset: number} | undefined {
	const dx = anchor.x - (rect.left + w / 2);
	const dy = anchor.y - (rect.top + h / 2);

	if (Math.abs(dx) < w / 2 && Math.abs(dy) < h / 2) {
		return undefined;
	}

	// `side` names where the BUBBLE sits relative to the anchor, so an anchor below the
	// bubble means the bubble is 'above' and the tail hangs off its bottom edge.
	const side: BubbleSide =
		Math.abs(dy) >= Math.abs(dx)
			? dy > 0
				? 'above'
				: 'below'
			: dx > 0
			? 'left'
			: 'right';
	const horizontal = side === 'above' || side === 'below';
	const span = horizontal ? w : h;
	const lo = TAIL_HALF + TAIL_INSET;
	const offset = clamp(
		horizontal ? anchor.x - rect.left : anchor.y - rect.top,
		lo,
		Math.max(lo, span - lo)
	);

	return {offset, side};
}

// ---------------------------------------------------------------------------
// Placement
// ---------------------------------------------------------------------------

export interface PlaceBubbleInput {
	/** The bubble anchor, in MOUNT px. */
	anchor: Vec2;
	/** The mouth anchor, in MOUNT px. `null` falls back to the old above/below rule. */
	mouth: Vec2 | null;
	box: StageBox;
	w: number;
	h: number;
	gap: number;
	margin: number;
}

export interface BubblePlacement {
	side: BubbleSide;
	left: number;
	top: number;
	/** Tail tip offset along the edge it sits on, from the bubble's left (or top) edge. */
	tail: number;
}

/**
 * The side the author asked for: whichever way the anchor lies from the mouth, taking the
 * dominant axis. A `bubble` anchor over the head reads as `above`, one off the shoulder as
 * `left`/`right`. No mouth to compare against means no direction, so keep the old default.
 */
export function preferredSide(mouth: Vec2 | null, anchor: Vec2): BubbleSide {
	if (!mouth) {
		return 'above';
	}

	const dx = anchor.x - mouth.x;
	const dy = anchor.y - mouth.y;

	if (Math.abs(dx) > Math.abs(dy)) {
		return dx >= 0 ? 'right' : 'left';
	}

	// y is screen-down: an anchor above the mouth has the smaller y.
	return dy <= 0 ? 'above' : 'below';
}

/**
 * Where the bubble box lands. The preferred side wins whenever it fits; otherwise the opposite
 * side, then the cross axis, roomier half first. The last resort is the preferred side clamped,
 * because a clamped bubble in the right direction still reads better than a stray one.
 */
export function placeBubble(input: PlaceBubbleInput): BubblePlacement {
	const {anchor, mouth, box, w, h, gap, margin} = input;
	const first = preferredSide(mouth, anchor);
	const side =
		candidateSides(first, anchor, box).find(s => fitsOn(s, input)) ?? first;
	const raw = rectFor(side, anchor, w, h, gap);
	const left = clamp(raw.left, box.left + margin, box.left + box.width - w - margin);
	const top = clamp(raw.top, box.top + margin, box.top + box.height - h - margin);

	// The bubble moves when clamped; the tail slides along its edge to keep pointing home.
	const horizontal = side === 'above' || side === 'below';
	const span = horizontal ? w : h;
	const lo = TAIL_HALF + TAIL_INSET;
	const tail = clamp(
		horizontal ? anchor.x - left : anchor.y - top,
		lo,
		Math.max(lo, span - lo)
	);

	return {side, left, top, tail};
}

const OPPOSITE: Record<BubbleSide, BubbleSide> = {
	above: 'below',
	below: 'above',
	left: 'right',
	right: 'left'
};

function candidateSides(
	first: BubbleSide,
	anchor: Vec2,
	box: StageBox
): BubbleSide[] {
	const vertical = first === 'above' || first === 'below';
	const cross: BubbleSide[] = vertical ? ['right', 'left'] : ['below', 'above'];
	const roomFirst = vertical
		? box.left + box.width - anchor.x >= anchor.x - box.left
		: box.top + box.height - anchor.y >= anchor.y - box.top;

	return [
		first,
		OPPOSITE[first],
		...(roomFirst ? cross : [cross[1], cross[0]])
	];
}

function rectFor(
	side: BubbleSide,
	anchor: Vec2,
	w: number,
	h: number,
	gap: number
): {left: number; top: number} {
	switch (side) {
		case 'above':
			return {left: anchor.x - w / 2, top: anchor.y - h - gap};
		case 'below':
			return {left: anchor.x - w / 2, top: anchor.y + gap};
		case 'left':
			return {left: anchor.x - w - gap, top: anchor.y - h / 2};
		default:
			return {left: anchor.x + gap, top: anchor.y - h / 2};
	}
}

/** Only the tail's own axis has to fit — the cross axis is always clamped. */
function fitsOn(side: BubbleSide, input: PlaceBubbleInput): boolean {
	const {anchor, box, w, h, gap, margin} = input;
	const r = rectFor(side, anchor, w, h, gap);

	switch (side) {
		case 'above':
			return r.top >= box.top + margin;
		case 'below':
			return r.top + h <= box.top + box.height - margin;
		case 'left':
			return r.left >= box.left + margin;
		default:
			return r.left + w <= box.left + box.width - margin;
	}
}

// ---------------------------------------------------------------------------
// Link parsing
// ---------------------------------------------------------------------------

export type LinkToken =
	| {kind: 'text'; value: string}
	| {kind: 'link'; name: string; target?: string};

const LINK_RE = /\[\[([^\]]*?)\]\]/g;

/**
 * Split text on wiki links. Supports the three Twine spellings so link text in a bubble
 * behaves the way an author expects (spec 02, D3):
 *
 *   [[stay]]                 name = stay, target = stay
 *   [[stay -> Tavern Fight]] name = stay, target = Tavern Fight
 *   [[Tavern Fight <- stay]] name = stay, target = Tavern Fight
 *   [[stay | Tavern Fight]]  name = stay, target = Tavern Fight
 */
export function parseLinkText(text: string): LinkToken[] {
	const out: LinkToken[] = [];
	let last = 0;

	LINK_RE.lastIndex = 0;

	for (let m = LINK_RE.exec(text); m; m = LINK_RE.exec(text)) {
		if (m.index > last) {
			out.push({kind: 'text', value: text.slice(last, m.index)});
		}

		out.push(parseLink(m[1]));
		last = m.index + m[0].length;
	}

	if (last < text.length) {
		out.push({kind: 'text', value: text.slice(last)});
	}

	return out;
}

function parseLink(inner: string): LinkToken {
	const right = inner.split('->');

	if (right.length === 2) {
		return {kind: 'link', name: right[0].trim(), target: right[1].trim()};
	}

	const left = inner.split('<-');

	if (left.length === 2) {
		return {kind: 'link', name: left[1].trim(), target: left[0].trim()};
	}

	const pipe = inner.split('|');

	if (pipe.length === 2) {
		return {kind: 'link', name: pipe[0].trim(), target: pipe[1].trim()};
	}

	const name = inner.trim();

	return {kind: 'link', name, target: name};
}

function clamp(n: number, min: number, max: number): number {
	// A bubble wider than the stage would invert the range; pinning to `min` keeps its left
	// edge visible, which is the readable half.
	return max < min ? min : Math.min(max, Math.max(min, n));
}
