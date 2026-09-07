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
import type {StageBox} from './coords';
import {injectStyles} from './styles';

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

/** Which side of the anchor the bubble hangs off. The tail sits on the opposite edge. */
export type BubbleSide = 'above' | 'below' | 'left' | 'right';

/** The anchor every character defines for "where the words come out". */
const MOUTH_ANCHOR = 'mouth';

interface BubbleRecord {
	el: HTMLDivElement;
	body: HTMLDivElement;
	tail: HTMLDivElement;
	spec: BubbleSpec;
	/** Last text rendered, so unchanged text is never re-parsed or re-created. */
	rendered?: string;
}

export class DialogueLayer {
	/** Assignable after construction, matching the `onLink(name)` requirement. */
	onLink?: LinkHandler;

	private opts: DialogueLayerOptions;
	private doc?: Document;
	private mountEl?: HTMLElement;
	private rootEl?: HTMLDivElement;
	private boxEl?: HTMLDivElement;
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
			this.boxStyle = undefined;

			return;
		}

		if (!this.boxEl) {
			this.boxEl = this.doc.createElement('div');
			this.boxEl.className = 'sliders-box';
			this.rootEl.appendChild(this.boxEl);
			this.fadeIn(this.boxEl);
		}

		this.boxStyle = style;
		applyStyleAttributes(this.boxEl, style);

		if (this.boxEl.dataset.text !== text) {
			this.boxEl.dataset.text = text;
			this.renderRichText(this.boxEl, text);
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
		const anchor = this.renderer?.measure(rec.spec.who, anchorName) ?? null;
		const el = rec.el;
		const margin = this.opts.margin ?? 12;
		const gap = this.opts.tailGap ?? 12;

		// Width first: it decides how tall the text wraps, and both are read below.
		el.style.width = style?.w ? `${style.w * box.width}px` : '';

		const w = el.offsetWidth;
		const h = el.offsetHeight;
		const pinned = pinnedRect(style, box, w, h, margin);

		if (pinned) {
			// The author said where this goes. The tail still points home when the speaker is
			// on stage — a bubble parked on the left with a tail reaching right reads as
			// theirs — and simply disappears for a narrator with nobody to point at.
			el.dataset.anchored = anchor ? 'true' : 'false';
			el.style.transform = `translate(${pinned.left}px, ${pinned.top}px)`;

			const tail = anchor ? tailToward(anchor, pinned, w, h) : undefined;

			if (!tail) {
				el.dataset.side = 'above';
				rec.tail.style.display = 'none';

				return;
			}

			el.dataset.side = tail.side;
			rec.tail.style.display = '';
			this.placeTail(rec, tail.side, tail.offset);

			return;
		}

		if (!anchor) {
			// Speaker is not on stage (bad `who`, or an exit already finished). Still show the
			// line — losing dialogue is worse than a mispositioned bubble.
			el.dataset.anchored = 'false';
			el.dataset.side = 'above';
			rec.tail.style.display = 'none';
			el.style.transform = `translate(${box.left + (box.width - w) / 2}px, ${
				box.top + margin
			}px)`;

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
		this.placeTail(rec, place.side, place.tail);
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

		el.style.width = `${(style?.w ?? 1) * box.width}px`;

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

		el.append(body, tail);
		this.rootEl!.appendChild(el);
		this.fadeIn(el);

		return {el, body, tail, spec};
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
