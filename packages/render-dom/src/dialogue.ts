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

import type {EntityId, Vec2} from '@sliders/scene-types';
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
}

export interface DialogueLayerOptions {
	/** Fired when a `[[link]]` in bubble or box text is activated. */
	onLink?: (name: string, target?: string) => void;
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
	onLink?: (name: string, target?: string) => void;

	private opts: DialogueLayerOptions;
	private doc?: Document;
	private mountEl?: HTMLElement;
	private rootEl?: HTMLDivElement;
	private boxEl?: HTMLDivElement;
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

	/** The narration bottom bar. `null` hides it. */
	setBox(text: string | null): void {
		if (!this.rootEl || !this.doc) {
			return;
		}

		if (text === null || text === undefined) {
			this.boxEl?.remove();
			this.boxEl = undefined;

			return;
		}

		if (!this.boxEl) {
			this.boxEl = this.doc.createElement('div');
			this.boxEl.className = 'sliders-box';
			this.rootEl.appendChild(this.boxEl);
			this.fadeIn(this.boxEl);
		}

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
		const anchorName = rec.spec.anchor ?? 'bubble';
		const anchor = this.renderer?.measure(rec.spec.who, anchorName) ?? null;
		const el = rec.el;
		const margin = this.opts.margin ?? 12;
		const gap = this.opts.tailGap ?? 12;
		const w = el.offsetWidth;
		const h = el.offsetHeight;

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

		// Prefer above the anchor; drop below only when there is genuinely no room.
		let side: 'above' | 'below' = 'above';
		let top = anchor.y - h - gap;

		if (top < box.top + margin) {
			side = 'below';
			top = anchor.y + gap;
		}

		let left = anchor.x - w / 2;

		// Clamp inside the stage box. The bubble moves; the tail does not — it slides along
		// the bubble's edge so it keeps pointing at the anchor.
		left = clamp(left, box.left + margin, box.left + box.width - w - margin);
		top = clamp(top, box.top + margin, box.top + box.height - h - margin);

		const tailX = clamp(
			anchor.x - left,
			TAIL_HALF + TAIL_INSET,
			Math.max(TAIL_HALF + TAIL_INSET, w - TAIL_HALF - TAIL_INSET)
		);

		el.dataset.side = side;
		el.style.transform = `translate(${left}px, ${top}px)`;
		rec.tail.style.left = `${tailX - TAIL_HALF}px`;
	}

	private positionBox(): void {
		if (!this.boxEl || !this.renderer) {
			return;
		}

		// The narration bar spans the stage box, not the letterbox bars.
		const box = this.renderer.stageBox();

		this.boxEl.style.left = `${box.left}px`;
		this.boxEl.style.right = 'auto';
		this.boxEl.style.width = `${box.width}px`;
		this.boxEl.style.bottom = `${
			Math.max(0, (this.mountEl?.clientHeight ?? 0) - (box.top + box.height))
		}px`;
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
			link.dataset.slidersTarget || undefined
		);
	};
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
