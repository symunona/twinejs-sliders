/**
 * `render-dom` — renderer #1. CSS transforms + <img>.
 *
 * Two rules drive the whole design:
 *
 *  1. RECONCILE, NEVER REBUILD. `apply()` diffs its element map against the incoming stage.
 *     Remounting an <img> restarts animated webp/gif playback and flashes, and the twinejs
 *     preview calls `apply()` on every debounced keystroke (spec 06).
 *  2. `measure()` IS THE CONTRACT. Bubbles are DOM in every renderer (D2), so they ask the
 *     renderer where an anchor landed. Everything positional here is derived from the same
 *     pure functions `measure()` uses, so the two can never disagree.
 */

import type {
	AssetMeta,
	AssetResolver,
	Camera,
	Character,
	EntityId,
	Frac2,
	FrameFit,
	Layer,
	Renderer,
	Stage,
	StageEntity,
	Transition,
	TransitionKind,
	Vec2
} from '@sliders/scene-types';
import {LAYERS} from '@sliders/scene-types';
import {
	DEFAULT_ANCHORS,
	DEFAULT_ORIGIN,
	PLACEHOLDER_FRAME,
	PLACEHOLDER_PROP,
	Rect,
	SpriteMetrics,
	StageBox,
	anchorPointInRect,
	applyCamera,
	boxToMount,
	cameraOffsetPx,
	characterMetrics,
	computeStageBox,
	propMetrics,
	safeZoom,
	sortByZ,
	spriteRect
} from './coords';
import {injectStyles} from './styles';

/** How far, as a fraction of stage height, an entering entity rises into place. */
export const ENTER_RISE = 0.03;

/** Fallback when an entity has no `frame` and the manifest has no `idle`. */
const DEFAULT_FRAME_NAME = 'idle';

export interface DomRendererOptions {
	/** Draw the centre + floor guides. Makes `at: 0` and the feet origin legible (spec 06). */
	guides?: boolean;
	/** Stage aspect ratio. 16:9 unless you have a very good reason. */
	aspect?: number;
	/** Injected for tests; defaults to the mount element's document. */
	document?: Document;
}

/** Everything the renderer remembers about one on-screen entity. */
interface EntityRecord {
	id: EntityId;
	el: HTMLDivElement;
	entity: StageEntity;
	/** Resolved manifest for cast entities. Undefined for props and unknown characters. */
	character?: Character;
	/** Which of that character's frames is on screen. The rig hangs off it, not off the
	    character: anchors are per frame, so a pose change moves the bubble with it. */
	frameName?: string;
	metrics: SpriteMetrics;
	/** Target rect in BOX pixels. */
	rect: Rect;
	img?: HTMLImageElement;
	/** Asset currently shown, so we only touch `src` when it actually changes. */
	assetId?: string;
	url?: string;
	placeholderLabel?: string;
	placeholderId?: string;
	exiting: boolean;
	exitTimer?: ReturnType<typeof setTimeout>;
}

/** What one entity needs before any DOM is touched. Resolved off the critical path. */
interface ResolvedEntity {
	entity: StageEntity;
	character?: Character;
	assetId?: string;
	url?: string;
	meta?: AssetMeta;
	/** The cast frame's registration transform, if it has one. */
	fit?: FrameFit;
	/** The frame being drawn, so its anchors are the ones `measure` reports. */
	frameName?: string;
	/** Set when we cannot draw the real thing — render a labelled placeholder instead. */
	placeholderLabel?: string;
	/** The id that failed to resolve. Exposed as `data-asset-id` for tests to assert on. */
	placeholderId?: string;
}

export class DomRenderer implements Renderer {
	private mountEl?: HTMLElement;
	private doc?: Document;
	private assets?: AssetResolver;
	private opts: DomRendererOptions;

	private rootEl?: HTMLDivElement;
	private boxEl?: HTMLDivElement;
	private cameraEl?: HTMLDivElement;
	private fxStackEl?: HTMLDivElement;
	private layerEls = new Map<Layer | 'bg', HTMLDivElement>();

	private entities = new Map<EntityId, EntityRecord>();
	private fxEls = new Map<string, HTMLDivElement>();
	private bgEl?: HTMLElement;
	private bgId?: string;

	private box: StageBox = {left: 0, top: 0, width: 0, height: 0};
	private camera: Camera = {at: {x: 0, y: 0}, zoom: 1};

	private observer?: ResizeObserver;
	private windowResize?: () => void;
	private resizeWindow?: Window & typeof globalThis;
	private listeners = new Set<() => void>();

	/** Guards against an in-flight `apply()` writing DOM after a newer one started. */
	private applyGen = 0;

	private charCache = new Map<string, Character | undefined>();
	private urlCache = new Map<string, string | undefined>();
	private metaCache = new Map<string, AssetMeta | undefined>();

	constructor(options: DomRendererOptions = {}) {
		this.opts = options;
	}

	// -----------------------------------------------------------------------
	// Renderer contract
	// -----------------------------------------------------------------------

	async mount(el: HTMLElement, assets: AssetResolver): Promise<void> {
		this.destroy();

		this.mountEl = el;
		this.doc = this.opts.document ?? el.ownerDocument ?? globalThis.document;
		this.assets = assets;

		injectStyles(this.doc);

		// The mount is the coordinate space `measure()` reports in, so it has to be a
		// containing block.
		if (!el.style.position) {
			el.style.position = 'relative';
		}

		const root = this.el('div', 'sliders-root');

		root.dataset.guides = String(!!this.opts.guides);

		const box = this.el('div', 'sliders-stage-box');
		const camera = this.el('div', 'sliders-camera');

		for (const layer of ['bg', ...LAYERS] as const) {
			const layerEl = this.el('div', 'sliders-layer');

			layerEl.dataset.layer = layer;
			this.layerEls.set(layer, layerEl);
			camera.appendChild(layerEl);
		}

		const fxStack = this.el('div', 'sliders-fx-stack');
		const guides = this.el('div', 'sliders-guides');

		box.append(camera, fxStack, guides);
		root.appendChild(box);
		el.appendChild(root);

		this.rootEl = root;
		this.boxEl = box;
		this.cameraEl = camera;
		this.fxStackEl = fxStack;

		this.observeResize(el);
		this.relayout();
	}

	async apply(stage: Stage, transitions: Transition[] = []): Promise<void> {
		if (!this.mountEl || !this.doc) {
			return;
		}

		const gen = ++this.applyGen;
		const durations = indexTransitions(transitions);

		// Resolve everything async FIRST. After this awaits, `measure()` must be correct
		// immediately, so nothing below may await.
		const resolved = await this.resolveAll(stage);

		if (gen !== this.applyGen || !this.mountEl) {
			return; // A newer apply() overtook us.
		}

		this.camera = normalizeCamera(stage.camera);

		this.syncBg(stage.bg, durations.duration('bg'), stage.bgImplicit === true);
		this.syncEntities(resolved, durations);
		this.syncFx(stage.fx ?? []);
		this.syncCamera(durations.duration('camera'));

		this.notify();
	}

	measure(entityId: EntityId, anchor: string): Vec2 | null {
		const rec = this.entities.get(entityId);

		if (!rec) {
			return null;
		}

		const frac = this.anchorFraction(rec, anchor);

		if (!frac) {
			return null;
		}

		// Sprite frame -> BOX px, mirrored about the origin when flipped...
		const inBox = anchorPointInRect(
			rec.rect,
			rec.metrics.origin,
			frac,
			!!rec.entity.flip
		);

		// ...then through the camera, then out of the box into MOUNT px.
		return boxToMount(this.box, applyCamera(this.box, this.camera, inBox));
	}

	destroy(): void {
		this.applyGen++;
		this.observer?.disconnect();
		this.observer = undefined;

		if (this.windowResize) {
			// Whichever window the listener went onto--see `observeResize`.
			(this.resizeWindow ?? globalThis).removeEventListener?.(
				'resize',
				this.windowResize
			);
			this.windowResize = undefined;
			this.resizeWindow = undefined;
		}

		for (const rec of this.entities.values()) {
			if (rec.exitTimer !== undefined) {
				clearTimeout(rec.exitTimer);
			}
		}

		this.rootEl?.remove();
		this.rootEl = undefined;
		this.boxEl = undefined;
		this.cameraEl = undefined;
		this.fxStackEl = undefined;
		this.layerEls.clear();
		this.entities.clear();
		this.fxEls.clear();
		this.bgEl = undefined;
		this.bgId = undefined;
		this.mountEl = undefined;
		this.listeners.clear();
	}

	// -----------------------------------------------------------------------
	// Extras beyond the Renderer contract, used by DialogueLayer and the preview
	// -----------------------------------------------------------------------

	/** The letterboxed stage rect, in MOUNT px. Bubbles clamp themselves to this. */
	stageBox(): StageBox {
		return {...this.box};
	}

	/**
	 * An entity's on-screen rect in MOUNT px, camera applied. null when it is not on stage.
	 *
	 * The visual editor hit-tests by rectangle rather than by DOM event — `.sliders-entity` is
	 * `pointer-events: none` and the overlay sits above the stage anyway. Built from the same
	 * pure functions `measure()` uses, so a handle can never drift away from the sprite.
	 *
	 * A flip does NOT move this rect: `scaleX(-1)` mirrors the sprite about its own
	 * transform-origin, which is the origin fraction, so the box it occupies is unchanged for
	 * a centred origin and only its CONTENT mirrors for an off-centre one.
	 */
	rectOf(entityId: EntityId): Rect | null {
		const rec = this.entities.get(entityId);

		if (!rec) {
			return null;
		}

		const topLeft = boxToMount(
			this.box,
			applyCamera(this.box, this.camera, {x: rec.rect.left, y: rec.rect.top})
		);
		// The camera zoom scales size as well as position — the layer stack is one
		// `scale(zoom)` transform, so the sprite inside it grows with it.
		const zoom = safeZoom(this.camera.zoom);

		return {
			left: topLeft.x,
			top: topLeft.y,
			width: rec.rect.width * zoom,
			height: rec.rect.height * zoom
		};
	}

	/** Fired after every apply() and every resize relayout. Returns an unsubscribe. */
	subscribe(fn: () => void): () => void {
		this.listeners.add(fn);

		return () => this.listeners.delete(fn);
	}

	setGuides(on: boolean): void {
		this.opts.guides = on;

		if (this.rootEl) {
			this.rootEl.dataset.guides = String(on);
		}
	}

	/**
	 * Drop cached resolver answers. The editor asset store is mutable — a character edited or
	 * an asset added after we cached a miss would otherwise never appear.
	 */
	invalidate(id?: string): void {
		if (id === undefined) {
			this.charCache.clear();
			this.urlCache.clear();
			this.metaCache.clear();

			return;
		}

		this.charCache.delete(id);
		this.urlCache.delete(id);
		this.metaCache.delete(id);
	}

	// -----------------------------------------------------------------------
	// Asset resolution
	// -----------------------------------------------------------------------

	private async resolveAll(stage: Stage): Promise<Map<EntityId, ResolvedEntity>> {
		const out = new Map<EntityId, ResolvedEntity>();
		const list = Object.values(stage.entities ?? {}).filter(Boolean);

		await Promise.all([
			// The background rides along so syncBg() never has to await, and so a whole stage
			// arrives on screen in one frame instead of two.
			stage.bg ? this.url(stage.bg) : Promise.resolve(undefined),
			...list.map(async entity => {
				out.set(entity.id, await this.resolveEntity(entity));
			})
		]);

		return out;
	}

	private async resolveEntity(entity: StageEntity): Promise<ResolvedEntity> {
		if (entity.kind === 'cast') {
			const character = await this.character(entity.ref);

			if (!character) {
				return {
					entity,
					placeholderId: entity.ref,
					placeholderLabel: `? character\n${entity.ref}`
				};
			}

			const frameName = pickFrameName(character, entity.frame);
			const frame = frameName ? character.frames?.[frameName] : undefined;

			if (!frame) {
				const missingFrame = `${entity.ref}/${entity.frame ?? DEFAULT_FRAME_NAME}`;

				return {
					entity,
					character,
					placeholderId: missingFrame,
					placeholderLabel: `? frame\n${missingFrame}`
				};
			}

			const url = await this.url(frame.asset);

			return {
				entity,
				character,
				assetId: frame.asset,
				url,
				fit: frame.fit,
				frameName,
				placeholderId: url ? undefined : frame.asset,
				placeholderLabel: url ? undefined : `? asset\n${frame.asset}`
			};
		}

		const url = await this.url(entity.ref);
		const meta = await this.meta(entity.ref);

		return {
			entity,
			assetId: entity.ref,
			url,
			meta,
			placeholderId: url ? undefined : entity.ref,
			placeholderLabel: url ? undefined : `? asset\n${entity.ref}`
		};
	}

	/** Every resolver call is wrapped: a throwing resolver must degrade, never blank. */
	private async character(id: string): Promise<Character | undefined> {
		if (this.charCache.has(id)) {
			return this.charCache.get(id);
		}

		let value: Character | undefined;

		try {
			value = await this.assets?.character(id);
		} catch {
			value = undefined;
		}

		this.charCache.set(id, value);

		return value;
	}

	private async url(id: string): Promise<string | undefined> {
		if (this.urlCache.has(id)) {
			return this.urlCache.get(id);
		}

		let value: string | undefined;

		try {
			value = await this.assets?.url(id);
		} catch {
			value = undefined;
		}

		this.urlCache.set(id, value);

		return value;
	}

	private async meta(id: string): Promise<AssetMeta | undefined> {
		if (this.metaCache.has(id)) {
			return this.metaCache.get(id);
		}

		let value: AssetMeta | undefined;

		try {
			value = await this.assets?.meta(id);
		} catch {
			value = undefined;
		}

		this.metaCache.set(id, value);

		return value;
	}

	// -----------------------------------------------------------------------
	// Reconciliation
	// -----------------------------------------------------------------------

	private syncEntities(
		resolved: Map<EntityId, ResolvedEntity>,
		durations: TransitionIndex
	): void {
		// Depart: anything we hold that the new stage does not.
		for (const [id, rec] of this.entities) {
			if (!resolved.has(id) && !rec.exiting) {
				this.exitEntity(rec, durations.duration('exit', id));
			}
		}

		for (const [id, res] of resolved) {
			const existing = this.entities.get(id);

			if (existing) {
				this.updateEntity(existing, res, durations);
			} else {
				this.createEntity(id, res, durations.duration('enter', id));
			}
		}

		this.assignZ();
	}

	private createEntity(id: EntityId, res: ResolvedEntity, duration: number): void {
		const el = this.el('div', 'sliders-entity');

		// Stable hooks the e2e suite selects on. Do not rename.
		el.dataset.entityId = id;
		el.dataset.kind = res.entity.kind;
		el.dataset.layer = res.entity.layer;

		const rec: EntityRecord = {
			id,
			el,
			entity: res.entity,
			character: res.character,
			frameName: res.frameName,
			metrics: this.metricsFor(res),
			rect: {left: 0, top: 0, width: 0, height: 0},
			exiting: false
		};

		this.entities.set(id, rec);
		this.setContent(rec, res);
		this.applyFit(rec, res);
		this.layerFor(res.entity.layer).appendChild(el);

		// Enter: fade + slight rise. Snap into the start pose with transitions off, force a
		// reflow so the browser has something to animate FROM, then transition to the target.
		this.layout(rec, 0, {rise: ENTER_RISE * this.box.height, opacity: 0});
		void el.offsetWidth;
		this.layout(rec, duration);
	}

	private updateEntity(
		rec: EntityRecord,
		res: ResolvedEntity,
		durations: TransitionIndex
	): void {
		// Re-entering before its exit finished: cancel the removal, keep the element.
		if (rec.exiting) {
			if (rec.exitTimer !== undefined) {
				clearTimeout(rec.exitTimer);
				rec.exitTimer = undefined;
			}

			rec.exiting = false;
		}

		const prev = rec.entity;

		rec.entity = res.entity;
		rec.character = res.character;
		rec.frameName = res.frameName;
		rec.metrics = this.metricsFor(res);

		if (prev.layer !== res.entity.layer) {
			rec.el.dataset.layer = res.entity.layer;
			this.layerFor(res.entity.layer).appendChild(rec.el);
		}

		this.setContent(rec, res, durations.duration('frame', rec.id));
		this.applyFit(rec, res);

		// One element carries position, mirror and size, and CSS gives it one
		// transition-duration, so the longest of the three wins. A scale left out here would
		// snap while the move glides, which is exactly what listing width/height in the CSS
		// transition is there to prevent.
		const duration = Math.max(
			durations.duration('move', rec.id),
			durations.duration('flip', rec.id),
			durations.duration('scale', rec.id)
		);

		this.layout(rec, duration);
	}

	private exitEntity(rec: EntityRecord, duration: number): void {
		rec.exiting = true;
		rec.el.style.transitionDuration = `${duration}s`;
		rec.el.style.opacity = '0';

		const finish = () => {
			// Guard: updateEntity() may have revived it while we waited.
			if (!rec.exiting) {
				return;
			}

			rec.el.remove();
			this.entities.delete(rec.id);
		};

		if (duration <= 0) {
			finish();
		} else {
			rec.exitTimer = setTimeout(finish, duration * 1000);
		}
	}

	/**
	 * Point the element at the right image, or at a labelled placeholder. Only touches `src`
	 * when the asset actually changed — reassigning it restarts an animated webp.
	 */
	private setContent(rec: EntityRecord, res: ResolvedEntity, duration = 0): void {
		const wantsPlaceholder = !!res.placeholderLabel;

		if (wantsPlaceholder) {
			if (rec.placeholderLabel === res.placeholderLabel) {
				return;
			}

			rec.el.replaceChildren();
			rec.img = undefined;
			rec.assetId = undefined;
			rec.url = undefined;
			rec.placeholderLabel = res.placeholderLabel;
			rec.placeholderId = res.placeholderId;

			const ph = this.el('div', 'sliders-placeholder');

			ph.dataset.assetId = res.placeholderId ?? res.entity.ref;
			ph.textContent = res.placeholderLabel ?? '?';
			rec.el.appendChild(ph);

			return;
		}

		if (rec.img && rec.assetId === res.assetId && rec.url === res.url) {
			return;
		}

		const previous = rec.img;

		rec.placeholderLabel = undefined;
		rec.placeholderId = undefined;

		const img = this.doc!.createElement('img');

		img.alt = '';
		img.draggable = false;
		img.decoding = 'async';
		img.src = res.url!;
		rec.el.replaceChildren();

		// Cross-fade frame swaps: the outgoing frame rides along on top, fading out.
		if (previous && duration > 0) {
			previous.classList.add('sliders-ghost');
			previous.style.transitionDuration = `${duration}s`;
			rec.el.appendChild(img);
			rec.el.appendChild(previous);
			void previous.offsetWidth;
			previous.style.opacity = '0';
			setTimeout(() => previous.remove(), duration * 1000);
		} else {
			rec.el.appendChild(img);
		}

		rec.img = img;
		rec.assetId = res.assetId;
		rec.url = res.url;
	}

	/**
	 * The frame's registration transform, written on the <img> rather than the sprite box.
	 * The box's own `transform` is fully occupied by position and the mirror, and its
	 * `transform-origin` has to stay the entity origin for `scaleX(-1)` to mirror about the
	 * feet — so this gets its own element, and the two never fight.
	 *
	 * Scaling about that same origin keeps the feet planted when a frame is resized, and
	 * `translate` reads as a fraction of the sprite box, which is the <img> element's own
	 * size — `object-fit: contain` letterboxes the pixels inside it, it does not resize it.
	 * Written outside `setContent`, which bails early when the asset is unchanged: two
	 * frames can share one asset and differ only in fit.
	 *
	 * `object-position` is the box fit's anchor: the frame's origin point lands on the
	 * sprite box's origin point, so a frame with a wider aspect than the manifest size
	 * sits bottom centre (feet on the floor) rather than floating mid-box.
	 */
	private applyFit(rec: EntityRecord, res: ResolvedEntity): void {
		if (!rec.img) {
			return;
		}

		const style = rec.img.style;
		const originCss = `${rec.metrics.origin.x * 100}% ${
			rec.metrics.origin.y * 100
		}%`;

		style.objectPosition = originCss;

		if (!res.fit) {
			style.transform = '';
			style.transformOrigin = '';
			return;
		}

		const {offset, scale} = res.fit;

		style.transformOrigin = originCss;
		style.transform = `translate(${offset.x * 100}%, ${
			offset.y * 100
		}%) scale(${scale})`;
	}

	private metricsFor(res: ResolvedEntity): SpriteMetrics {
		if (res.entity.kind === 'cast') {
			return characterMetrics(
				this.box,
				res.character ?? {size: PLACEHOLDER_FRAME, origin: DEFAULT_ORIGIN},
				res.entity.scale
			);
		}

		return propMetrics(
			this.box,
			res.meta && res.meta.w > 0 && res.meta.h > 0 ? res.meta : PLACEHOLDER_PROP,
			DEFAULT_ORIGIN,
			res.entity.scale
		);
	}

	/**
	 * Write the sprite's geometry. Position lives entirely in `transform` so it is cheap to
	 * animate; `transform-origin` is the entity's own origin so `scaleX(-1)` mirrors about the
	 * feet rather than about the frame's corner.
	 */
	private layout(
		rec: EntityRecord,
		duration: number,
		from?: {rise: number; opacity: number}
	): void {
		const {entity, metrics} = rec;

		rec.rect = spriteRect(this.box, entity.at ?? {x: 0, y: 0}, metrics);

		const style = rec.el.style;
		const y = rec.rect.top + (from?.rise ?? 0);

		style.width = `${metrics.width}px`;
		style.height = `${metrics.height}px`;
		style.transformOrigin = `${metrics.origin.x * 100}% ${metrics.origin.y * 100}%`;
		style.transitionDuration = `${Math.max(0, duration)}s`;
		style.transform = `translate3d(${rec.rect.left}px, ${y}px, 0) scaleX(${
			entity.flip ? -1 : 1
		})`;
		style.opacity = String(
			from ? from.opacity : clamp01(entity.opacity ?? 1)
		);
	}

	/**
	 * Draw order inside each layer. Explicit z wins, otherwise it derives from y — lower on
	 * screen is nearer, so it paints later.
	 */
	private assignZ(): void {
		for (const layer of LAYERS) {
			const inLayer = [...this.entities.values()]
				.filter(rec => rec.entity.layer === layer)
				.map(rec => ({id: rec.id, at: rec.entity.at ?? {x: 0, y: 0}, z: rec.entity.z, rec}));

			sortByZ(inLayer).forEach((item, i) => {
				item.rec.el.style.zIndex = String(i + 1);
			});
		}
	}

	private layerFor(layer: Layer | 'bg'): HTMLDivElement {
		return this.layerEls.get(layer) ?? this.layerEls.get('mid')!;
	}

	// -----------------------------------------------------------------------
	// Background, fx, camera
	// -----------------------------------------------------------------------

	private syncBg(
		bg: string | undefined,
		duration: number,
		implicit: boolean
	): void {
		if (bg === this.bgId) {
			return;
		}

		this.bgId = bg;

		const previous = this.bgEl;
		const layer = this.layerFor('bg');

		const drop = () => {
			if (!previous) {
				return;
			}

			if (duration > 0) {
				previous.style.transitionDuration = `${duration}s`;
				previous.style.opacity = '0';
				setTimeout(() => previous.remove(), duration * 1000);
			} else {
				previous.remove();
			}
		};

		if (!bg) {
			this.bgEl = undefined;
			drop();

			return;
		}

		// resolveAll() primed the cache before we were called, so this is a hit unless the
		// asset genuinely does not resolve.
		const url = this.urlCache.get(bg);

		if (url) {
			this.bgEl = this.makeBgImage(url, layer, duration);
		} else if (implicit) {
			// An `id:`-derived backdrop is a guess, not a request. No art by that name just
			// means the scene has none — placeholding it would nag about every scene id.
			this.bgEl = undefined;
		} else {
			// Missing backdrop: a labelled placeholder, never a blank stage (spec 06).
			const ph = this.el('div', 'sliders-bg sliders-placeholder');

			ph.dataset.assetId = bg;
			ph.textContent = `? bg\n${bg}`;
			layer.appendChild(ph);
			this.bgEl = undefined;
		}

		drop();
	}

	private makeBgImage(
		url: string,
		layer: HTMLElement,
		duration: number
	): HTMLImageElement {
		const img = this.doc!.createElement('img');

		img.className = 'sliders-bg';
		img.alt = '';
		img.draggable = false;
		img.src = url;

		if (duration > 0) {
			img.style.opacity = '0';
			layer.appendChild(img);
			void img.offsetWidth;
			img.style.transitionDuration = `${duration}s`;
			img.style.opacity = '1';
		} else {
			layer.appendChild(img);
		}

		return img;
	}

	private syncFx(fx: {id: string; amount: number}[]): void {
		const seen = new Set<string>();

		for (const entry of fx) {
			if (!entry?.id) {
				continue;
			}

			seen.add(entry.id);

			let el = this.fxEls.get(entry.id);

			if (!el) {
				el = this.el('div', 'sliders-fx');
				el.dataset.fx = entry.id;
				this.fxEls.set(entry.id, el);
				this.fxStackEl?.appendChild(el);
			}

			el.style.opacity = String(clamp01(entry.amount ?? 1));
		}

		for (const [id, el] of this.fxEls) {
			if (!seen.has(id)) {
				el.remove();
				this.fxEls.delete(id);
			}
		}
	}

	private syncCamera(duration: number): void {
		if (!this.cameraEl) {
			return;
		}

		const offset = cameraOffsetPx(this.box, this.camera);
		const zoom = safeZoom(this.camera.zoom);

		this.cameraEl.style.transitionDuration = `${Math.max(0, duration)}s`;
		this.cameraEl.style.transform = `scale(${zoom}) translate(${-offset.x}px, ${-offset.y}px)`;
	}

	// -----------------------------------------------------------------------
	// Layout / resize
	// -----------------------------------------------------------------------

	private observeResize(el: HTMLElement): void {
		// The mount can live in another window entirely (the editor's popped-out
		// scene preview), and an observer built from this realm's constructor does
		// not reliably deliver for elements in a different document. Build it from
		// the mount's own window instead, falling back to ours when there isn't one
		// (detached nodes, jsdom).
		const ownerWindow = el.ownerDocument?.defaultView ?? globalThis;
		const Observer = (ownerWindow as typeof globalThis).ResizeObserver;

		if (typeof Observer !== 'undefined') {
			this.observer = new Observer(() => this.relayout());
			this.observer.observe(el);

			return;
		}

		// jsdom and very old browsers.
		this.resizeWindow = ownerWindow as Window & typeof globalThis;
		this.windowResize = () => this.relayout();
		ownerWindow.addEventListener?.('resize', this.windowResize);
	}

	/** Recompute the letterbox and re-place everything. Never animates — a resize is not a beat. */
	private relayout(): void {
		if (!this.mountEl || !this.boxEl) {
			return;
		}

		const width = this.mountEl.clientWidth || this.mountEl.getBoundingClientRect().width;
		const height = this.mountEl.clientHeight || this.mountEl.getBoundingClientRect().height;

		this.box = computeStageBox(width, height, this.opts.aspect);

		this.boxEl.style.left = `${this.box.left}px`;
		this.boxEl.style.top = `${this.box.top}px`;
		this.boxEl.style.width = `${this.box.width}px`;
		this.boxEl.style.height = `${this.box.height}px`;

		for (const rec of this.entities.values()) {
			rec.metrics = this.metricsFor({
				entity: rec.entity,
				character: rec.character,
				meta: rec.entity.kind === 'prop' ? this.metaCache.get(rec.entity.ref) : undefined
			});
			this.layout(rec, 0);
		}

		this.syncCamera(0);
		this.notify();
	}

	/**
	 * Where an anchor sits on the frame currently drawn.
	 *
	 * Read off the FRAME, because that is where the pose is: a character who turns away has
	 * their mouth somewhere else, and a rig shared by every frame would leave the bubble
	 * pointing at the back of their head. A frame that was never rigged falls through to
	 * `DEFAULT_ANCHORS`, so a bubble is never homeless.
	 */
	private anchorFraction(rec: EntityRecord, anchor: string): Frac2 | undefined {
		const frame = rec.frameName
			? rec.character?.frames?.[rec.frameName]
			: undefined;

		return frame?.anchors?.[anchor] ?? DEFAULT_ANCHORS[anchor];
	}

	private notify(): void {
		for (const fn of [...this.listeners]) {
			try {
				fn();
			} catch {
				// A misbehaving listener must not break rendering.
			}
		}
	}

	private el(tag: 'div', className: string): HTMLDivElement {
		const node = this.doc!.createElement(tag);

		node.className = className;

		return node;
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface TransitionIndex {
	duration(kind: TransitionKind, entityId?: EntityId): number;
}

/**
 * Transitions arrive as a flat list from the differ. Index them so lookups are O(1) and an
 * absent transition means "snap", which is what the preview wants while typing (spec 06).
 */
function indexTransitions(transitions: Transition[]): TransitionIndex {
	const byKey = new Map<string, number>();

	for (const t of transitions ?? []) {
		if (!t) {
			continue;
		}

		const key = `${t.kind}:${t.entityId ?? ''}`;
		const seconds = Number.isFinite(t.duration) ? Math.max(0, t.duration) : 0;

		byKey.set(key, Math.max(byKey.get(key) ?? 0, seconds));
	}

	return {
		duration(kind, entityId) {
			return byKey.get(`${kind}:${entityId ?? ''}`) ?? byKey.get(`${kind}:`) ?? 0;
		}
	};
}

function pickFrameName(
	character: Character,
	requested: string | undefined
): string | undefined {
	const frames = character.frames ?? {};

	if (requested) {
		return requested in frames ? requested : undefined;
	}

	if (DEFAULT_FRAME_NAME in frames) {
		return DEFAULT_FRAME_NAME;
	}

	return Object.keys(frames)[0];
}

function normalizeCamera(camera: Camera | undefined): Camera {
	return {
		at: {x: camera?.at?.x ?? 0, y: camera?.at?.y ?? 0},
		zoom: safeZoom(camera?.zoom)
	};
}

function clamp01(n: number): number {
	return Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 1;
}
