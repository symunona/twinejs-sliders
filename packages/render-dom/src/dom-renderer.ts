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
	FrameLoop,
	FrameStep,
	Renderer,
	Stage,
	StageEntity,
	StageSound,
	Transition,
	TransitionKind,
	Vec2
} from '@sliders/scene-types';
import {
	DEFAULT_FRAME_STEP_SECONDS,
	FIT_Z,
	bgMotionTiles,
	cssEase
} from '@sliders/scene-types';
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
	originPointInRect,
	propMetrics,
	rotatePoint,
	safeZoom,
	sortByZ,
	spriteRect
} from './coords';
import type {LinkHandler} from './dialogue';
import {SoundDeck} from './sound-deck';
import {injectStyles} from './styles';

/** How far, as a fraction of stage height, an entering entity rises into place. */
export const ENTER_RISE = 0.03;

/**
 * The kinds that all land on the sprite box's one `transform`, longest first in a tie.
 *
 * `move` leads because when two of these change over the same span it is the travel the
 * reader is watching, and the curve should be the one describing it.
 */
const ENTITY_TRANSFORM_KINDS = ['move', 'scale', 'rot', 'flip'] as const;

/** Fallback when an entity has no `frame` and the manifest has no `idle`. */
const DEFAULT_FRAME_NAME = 'idle';

/**
 * Floor on a frame step's hold.
 *
 * A `dur: 0` step is legal YAML and means "as fast as possible"; without a floor it is a
 * `setTimeout(0)` loop that never yields a painted frame, so the cycle would burn the main
 * thread and show nothing. One screen frame is as fast as possible.
 */
const MIN_FRAME_STEP_SECONDS = 1 / 60;

export interface DomRendererOptions {
	/** Draw the centre + floor guides. Makes `at: 0` and the feet origin legible (spec 06). */
	guides?: boolean;
	/** Stage aspect ratio. 16:9 unless you have a very good reason. */
	aspect?: number;
	/** Injected for tests; defaults to the mount element's document. */
	document?: Document;
	/**
	 * Called when the reader clicks an entity carrying a `link:`.
	 *
	 * Deliberately the SAME `LinkHandler` the dialogue layer takes, with the same
	 * `(name, target, event)` arguments and the same `data-sliders-link` /
	 * `data-sliders-target` attribute contract — a link in a speech bubble and a link on a
	 * door are one thing to a host, and giving them two shapes would mean two ways to
	 * navigate that could drift apart.
	 */
	onLink?: LinkHandler;
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
	/**
	 * What the stage last resolved for this entity, so a frame cycle's tick can re-run the
	 * same code an update runs without resolving anything again.
	 */
	res?: ResolvedEntity;
	/** The running frame cycle, if the entity has one. */
	anim?: AnimState;
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
	/** The resolved frame cycle, when the entity declared one. */
	steps?: ResolvedStep[];
	loop?: FrameLoop;
}

/** One step of a resolved cycle. `res.entity` is the entity as this step stages it. */
interface ResolvedStep {
	res: ResolvedEntity;
	seconds: number;
	moves: boolean;
	/** The step's own curve, already CSS. Only meaningful where `moves` is true. */
	ease?: string;
}

interface AnimState {
	/**
	 * The cycle this state is playing, as written. Compared on every apply: a cycle that did
	 * not change keeps playing, because restarting it on each keystroke would make the
	 * editor's preview stutter and never reach step 2.
	 */
	key: string;
	steps: ResolvedStep[];
	loop: FrameLoop;
	index: number;
	timer?: ReturnType<typeof setTimeout>;
}

/** The entity a step effectively stages: the base, with the step's own keys over it. */
function applyFrameStep(entity: StageEntity, step: FrameStep): StageEntity {
	return {
		...entity,
		at: step.at ?? entity.at,
		flip: step.flip ?? entity.flip,
		frame: step.name,
		opacity: step.opacity ?? entity.opacity,
		rot: step.rot ?? entity.rot,
		scale: step.scale ?? entity.scale
	};
}

/** `#rgb`, `#rrggbb`, `rgb()`, `hsl()` and friends — the spellings that cannot be a token. */
const HIGHLIGHT_COLOUR = /^(?:#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})|(?:rgb|rgba|hsl|hsla)\(\s*[0-9a-z%.,\s/-]+\))$/i;

/**
 * The glow colour a `highlight:` token asks for, or undefined when it is a story token.
 *
 * The question is genuinely hard to answer with a regexp, because `gold` is both a CSS
 * colour and a plausible name for a look a story paints itself — so the browser is asked.
 * Where `CSS.supports` is missing (jsdom) only the unambiguous spellings are taken, which
 * errs the safe way: an unrecognised token still reaches `data-highlight` and the default
 * glow still draws, whereas writing a non-colour into the custom property would invalidate
 * the whole `filter` and draw NOTHING.
 */
function highlightColour(token: string): string | undefined {
	const value = token.trim();

	if (!value) {
		return undefined;
	}

	const supports = (globalThis as {CSS?: {supports?(p: string, v: string): boolean}})
		.CSS?.supports;

	if (typeof supports === 'function') {
		return supports.call(globalThis.CSS, 'color', value) ? value : undefined;
	}

	return HIGHLIGHT_COLOUR.test(value) ? value : undefined;
}

/** Identity of a cycle. Changes only when the author's own list does. */
function animKey(entity: StageEntity): string {
	return entity.frames
		? `${entity.frameLoop ?? 'all'}\u0000${JSON.stringify(entity.frames)}`
		: '';
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
	/** Two containers, drawn in order: the backdrop, then every entity in one z space. */
	private bgLayerEl?: HTMLDivElement;
	private entityLayerEl?: HTMLDivElement;

	private entities = new Map<EntityId, EntityRecord>();
	/** Entity id -> its index in the CURRENT stage's `entities` record. Ties break on it. */
	private keyOrder = new Map<EntityId, number>();
	private fxEls = new Map<string, HTMLDivElement>();
	private bgEl?: HTMLElement;
	/**
	 * The trailing copy a `scroll_infinite_*` motion needs.
	 *
	 * An <img> does not tile, so a seamless loop is two copies a whole frame apart, sliding
	 * together: as one leaves, the other is exactly where it started. Built only for those
	 * motions — every other one is a single element and a transform.
	 */
	private bgTwinEl?: HTMLImageElement;
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

	/**
	 * Built lazily: a renderer mounted in jsdom, or one that never meets a scene with sound,
	 * should not create audio machinery to hold nothing.
	 */
	private deck?: SoundDeck;
	private mutedWanted = true;
	private blockedSound = false;
	private cues = 0;

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

		// The backdrop is not an entity and must never be sorted with them, so it keeps a
		// container of its own. Everything else shares ONE, which is what lets z decide the
		// whole stage instead of only a slice of it.
		const bgLayer = this.el('div', 'sliders-layer');
		const entityLayer = this.el('div', 'sliders-layer');

		bgLayer.dataset.layer = 'bg';
		entityLayer.dataset.layer = 'entities';
		this.bgLayerEl = bgLayer;
		this.entityLayerEl = entityLayer;
		camera.append(bgLayer, entityLayer);

		const fxStack = this.el('div', 'sliders-fx-stack');
		const guides = this.el('div', 'sliders-guides');

		box.append(camera, fxStack, guides);
		root.appendChild(box);
		el.appendChild(root);

		this.rootEl = root;
		// Stated from the start, not only once something flips it: "no attribute" would be
		// indistinguishable from "not muted" to anything reading this from outside.
		root.dataset.muted = String(this.mutedWanted);
		this.boxEl = box;
		this.cameraEl = camera;
		this.fxStackEl = fxStack;

		// One delegated listener on the root, the way the dialogue layer has one on its own
		// root: entities come and go on every beat, and a listener per sprite would have to
		// be torn down in three places that can each be missed.
		root.addEventListener('click', this.handleLinkClick);
		root.addEventListener('keydown', this.handleLinkKey);

		this.observeResize(el);
		this.relayout();
	}

	/**
	 * A click on an entity carrying a `link:`.
	 *
	 * `preventDefault` + the same `[data-sliders-link]` lookup the dialogue layer uses, so a
	 * host binds ONE handler and gets bubble links and stage links alike. The host decides
	 * what a click means — the player navigates, the editor opens the passage on ctrl-click
	 * and otherwise does nothing, because following a link there would throw away the beat
	 * being staged.
	 */
	private handleLinkClick = (event: MouseEvent) => {
		if (!this.opts.onLink) {
			return;
		}

		const el = (event.target as HTMLElement | null)?.closest?.(
			'[data-sliders-link]'
		) as HTMLElement | null;

		if (!el) {
			return;
		}

		event.preventDefault();
		this.opts.onLink(
			el.dataset.slidersLink ?? '',
			el.dataset.slidersTarget,
			event
		);
	};

	/**
	 * Enter or Space on a focused entity link.
	 *
	 * The handler wants a MouseEvent (a host reads its modifier keys), and a KeyboardEvent
	 * is not one — so the key press is turned into a real click on the element, which then
	 * arrives through `handleLinkClick` carrying the modifiers the reader actually held.
	 * One path to navigation rather than two that can disagree.
	 */
	private handleLinkKey = (event: KeyboardEvent) => {
		if (event.key !== 'Enter' && event.key !== ' ') {
			return;
		}

		const el = (event.target as HTMLElement | null)?.closest?.(
			'[data-sliders-link]'
		) as HTMLElement | null;

		if (!el) {
			return;
		}

		event.preventDefault();
		el.click();
	};

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

		// Recorded here, not in syncEntities: assignZ() needs the order the author wrote in
		// THIS scene, and the entity Map is keyed by first appearance.
		this.keyOrder = new Map(
			Object.keys(stage.entities ?? {}).map((id, index) => [id, index])
		);

		this.syncBg(
			stage.bg,
			durations.duration('bg'),
			stage.bgImplicit === true,
			durations.ease('bg')
		);
		// After syncBg, always: the motion rides on whatever element that just decided on,
		// and a backdrop swap builds a new <img> with no animation on it.
		this.syncBgFx(stage.bgFx);
		this.syncEntities(resolved, durations);
		this.syncFx(stage.fx ?? []);
		this.syncMusic(stage.music, durations.duration('music'));
		this.syncCamera(durations.duration('camera'), durations.ease('camera'));

		this.notify();
	}

	/**
	 * The character an entity is drawing, if it is drawing one.
	 *
	 * Exposed for the dialogue layer's benefit: a character carries its own `bubble:`
	 * defaults, and whoever builds a bubble spec has to merge those under the beat's own
	 * style. The renderer is the only thing that has already resolved the manifest, so
	 * asking it is cheaper than every caller resolving the cast a second time.
	 */
	characterOf(entityId: EntityId): Character | undefined {
		return this.entities.get(entityId)?.character;
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

		// ...turned about the origin the way the element's own `rotate()` turns it, so a
		// bubble stays on the shoulder of a character who is leaning...
		const turned = rotatePoint(
			inBox,
			originPointInRect(rec.rect, rec.metrics.origin),
			rec.entity.rot ?? 0
		);

		// ...then through the camera, then out of the box into MOUNT px.
		return boxToMount(this.box, applyCamera(this.box, this.camera, turned));
	}

	destroy(): void {
		this.applyGen++;
		// Before anything else: a stage that is going away must not be heard from again, and
		// an <audio> element is not attached to the DOM this tears down, so removing the
		// root would not stop it.
		this.deck?.stop();
		this.deck = undefined;
		this.blockedSound = false;
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

			this.stopAnim(rec);
		}

		this.rootEl?.removeEventListener('click', this.handleLinkClick);
		this.rootEl?.removeEventListener('keydown', this.handleLinkKey);
		this.rootEl?.remove();
		this.rootEl = undefined;
		this.boxEl = undefined;
		this.cameraEl = undefined;
		this.fxStackEl = undefined;
		this.bgLayerEl = undefined;
		this.entityLayerEl = undefined;
		this.entities.clear();
		this.fxEls.clear();
		this.bgEl = undefined;
		this.bgTwinEl = undefined;
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

	/**
	 * Cast first, asset second — which is the order an `auto` entity (an `entities:` entry,
	 * kind unknown to the parser) has to be tried in. A declared `cast:` still fails loudly
	 * when the character is missing; `auto` only falls through.
	 */
	private async resolveEntity(entity: StageEntity): Promise<ResolvedEntity> {
		if (entity.kind === 'cast' || entity.kind === 'auto') {
			const character = await this.character(entity.ref);

			if (character) {
				return await this.resolveCast(entity, character);
			}

			if (entity.kind === 'cast') {
				return {
					entity,
					placeholderId: entity.ref,
					placeholderLabel: `? character\n${entity.ref}`
				};
			}
		}

		const url = await this.url(entity.ref);
		const meta = await this.meta(entity.ref);
		const what = entity.kind === 'auto' ? 'entity' : 'asset';

		return {
			entity,
			assetId: entity.ref,
			url,
			meta,
			placeholderId: url ? undefined : entity.ref,
			placeholderLabel: url ? undefined : `? ${what}\n${entity.ref}`
		};
	}

	private async resolveCast(
		entity: StageEntity,
		character: Character
	): Promise<ResolvedEntity> {
		const still = await this.resolvePose(entity, character, entity.frame);

		if (!entity.frames?.length) {
			return still;
		}

		// Resolve the whole cycle up front, so a tick is synchronous DOM work. Each step is
		// a ResolvedEntity of its own, carrying the entity the step effectively stages —
		// which makes a tick exactly the same code path as an ordinary update.
		const steps: ResolvedStep[] = [];

		for (const step of entity.frames) {
			steps.push({
				res: await this.resolvePose(
					applyFrameStep(entity, step),
					character,
					step.name
				),
				seconds: Math.max(
					MIN_FRAME_STEP_SECONDS,
					step.dur ?? DEFAULT_FRAME_STEP_SECONDS
				),
				/** A step with no `at` of its own must not glide anywhere. */
				moves: step.at !== undefined,
				// Resolved as a `move`, because that is what a step's glide IS: the sprite
				// travels while its poses swap.
				...(step.ease !== undefined
					? {ease: cssEase(step.ease, 'move')}
					: {})
			});
		}

		return {...still, loop: entity.frameLoop ?? 'all', steps};
	}

	/** One pose of one character, resolved for the entity that is wearing it. */
	private async resolvePose(
		entity: StageEntity,
		character: Character,
		wanted: string | undefined
	): Promise<ResolvedEntity> {
		const frameName = pickFrameName(character, wanted);
		const frame = frameName ? character.frames?.[frameName] : undefined;

		if (!frame) {
			const missingFrame = `${entity.ref}/${wanted ?? DEFAULT_FRAME_NAME}`;

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
				this.exitEntity(
					rec,
					durations.duration('exit', id),
					durations.ease('exit', id)
				);
			}
		}

		for (const [id, res] of resolved) {
			const existing = this.entities.get(id);

			if (existing) {
				this.updateEntity(existing, res, durations);
			} else {
				this.createEntity(
					id,
					res,
					durations.duration('enter', id),
					durations.ease('enter', id)
				);
			}
		}

		this.assignZ();

		// What the stage BELIEVES is clickable, for the same reason `data-music` exists: a
		// link is invisible until somebody hovers it, so without this "is this door a way
		// out" is unanswerable from outside.
		let links = 0;

		for (const res of resolved.values()) {
			if (res.entity.link?.to !== undefined || res.entity.link?.name !== undefined) {
				links++;
			}
		}

		if (this.rootEl) {
			this.rootEl.dataset.linkCount = String(links);
		}
	}

	private createEntity(
		id: EntityId,
		res: ResolvedEntity,
		duration: number,
		ease = cssEase(undefined, 'enter')
	): void {
		const el = this.el('div', 'sliders-entity');

		// Stable hooks the e2e suite selects on. Do not rename.
		el.dataset.entityId = id;
		el.dataset.kind = res.entity.kind;
		this.syncPlane(el, res.entity);
		this.syncLink(el, res.entity);

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
		rec.res = res;
		this.setContent(rec, res);
		this.applyFrameFit(rec, res);
		this.entityLayerEl?.appendChild(el);

		// Enter: fade + slight rise. Snap into the start pose with transitions off, force a
		// reflow so the browser has something to animate FROM, then transition to the target.
		this.layout(rec, 0, {rise: ENTER_RISE * this.box.height, opacity: 0});
		void el.offsetWidth;
		this.layout(rec, duration, undefined, ease);
		this.syncAnim(rec, res, duration, ease);
	}

	/**
	 * `data-fit` — what the stylesheet hangs the full-bleed rules off, and what the editor
	 * and the e2e suite read to tell a plane from a sprite without re-deriving it.
	 *
	 * Removed rather than emptied when an entity stops being a plane: `[data-fit]` matches
	 * an empty value too, so a stale attribute would keep a sprite stretched across the
	 * stage with nothing in the CSS to say why.
	 */
	private syncPlane(el: HTMLElement, entity: StageEntity): void {
		if (entity.fit) {
			el.dataset.fit = entity.fit;
		} else {
			delete el.dataset.fit;
		}
	}

	/**
	 * The clickable half of an entity: `link:` and `highlight:`.
	 *
	 * Attribute names are the dialogue layer's, on purpose (`dialogue.ts` renderRichText) —
	 * a bubble link and a door are one contract, so one `closest('[data-sliders-link]')`
	 * serves both and a host cannot wire up one and forget the other.
	 *
	 * `data-sliders-link` carries the NAME when the author named a `links:` entry, because
	 * that is what the player looks up in its already-`if:`-filtered map; `data-sliders-target`
	 * carries the resolved passage, and wins where it is set. An `<a>` would be the obvious
	 * element for this, but an entity is a positioned box holding an <img> and nesting one
	 * would put a second element between the box and the sprite that every geometry function
	 * here measures.
	 */
	private syncLink(el: HTMLElement, entity: StageEntity): void {
		const link = entity.link;

		if (link?.to === undefined && link?.name === undefined) {
			delete el.dataset.slidersLink;
			delete el.dataset.slidersTarget;
			delete el.dataset.highlight;
			el.removeAttribute('role');
			el.removeAttribute('tabindex');
			return;
		}

		el.dataset.slidersLink = link.name ?? link.to ?? '';

		if (link.to !== undefined) {
			el.dataset.slidersTarget = link.to;
		} else {
			delete el.dataset.slidersTarget;
		}

		// The token ALWAYS reaches the DOM, so a story stylesheet can paint any word it
		// likes; a word that is also a real CSS colour additionally becomes the custom
		// property the default glow reads, so `highlight: gold` needs no stylesheet at all.
		if (entity.highlight) {
			const colour = highlightColour(entity.highlight);

			el.dataset.highlight = entity.highlight;

			if (colour) {
				el.style.setProperty('--sliders-highlight', colour);
			} else {
				el.style.removeProperty('--sliders-highlight');
			}
		} else {
			delete el.dataset.highlight;
			el.style.removeProperty('--sliders-highlight');
		}

		// Reachable by keyboard, and announced as what it is. The stage is a picture to a
		// screen reader otherwise, and a door that only a mouse can open is a dead end.
		el.setAttribute('role', 'link');
		el.setAttribute('tabindex', '0');
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

		// ABOVE the syncAnim bail-out below: an entity running a frame cycle takes the early
		// return, and a link written after it would never update on a walking sprite.
		this.syncPlane(rec.el, res.entity);
		this.syncLink(rec.el, res.entity);

		rec.entity = res.entity;
		rec.character = res.character;
		rec.frameName = res.frameName;
		rec.metrics = this.metricsFor(res);
		rec.res = res;

		// One element carries position, mirror and size, and CSS gives it one
		// transition-duration AND one timing function, so the longest of the four supplies
		// both. A scale left out here would snap while the move glides, which is exactly
		// what listing width/height in the CSS transition is there to prevent.
		const {duration, ease} = durations.longest(ENTITY_TRANSFORM_KINDS, rec.id);

		// A cycle still on its feet keeps the screen: the stage's own `frame` is the cycle's
		// FIRST step, so drawing it here would flash step 1 on every keystroke. `syncAnim`
		// redraws the step the cycle is actually standing on, against the new base.
		if (this.syncAnim(rec, res, duration, ease)) {
			return;
		}

		this.setContent(
			rec,
			res,
			durations.duration('frame', rec.id),
			durations.ease('frame', rec.id)
		);
		this.applyFrameFit(rec, res);
		this.layout(rec, duration, undefined, ease);
	}

	// -----------------------------------------------------------------------
	// Frame cycles
	// -----------------------------------------------------------------------

	/**
	 * Start, keep or stop an entity's frame cycle, and draw the step it stands on.
	 *
	 * Returns true when a cycle is running and has taken over the drawing, so the caller
	 * must not also paint the stage's still pose over it.
	 *
	 * A cycle runs on the renderer's own clock, not on the beat's: `dur:` is how long the
	 * reader looks at a moment, a step's `dur` is how fast the sprite's legs move, and a
	 * walk outlives the line that started it. Which is also why an unchanged cycle is left
	 * alone across applies — the editor re-applies on every keystroke, and a cycle restarted
	 * each time would never reach its second step.
	 */
	private syncAnim(
		rec: EntityRecord,
		res: ResolvedEntity,
		duration: number,
		ease?: string
	): boolean {
		const key = res.steps?.length ? animKey(res.entity) : '';

		if (!key) {
			this.stopAnim(rec);
			return false;
		}

		if (rec.anim?.key === key) {
			// Same cycle, possibly a moved entity: steps are re-resolved against the new
			// base, and the one on screen is redrawn where the base now puts it.
			rec.anim.steps = res.steps!;
			rec.anim.loop = res.loop ?? 'all';
			rec.anim.index = Math.min(rec.anim.index, res.steps!.length - 1);
			this.drawStep(rec, duration, ease);
			return true;
		}

		this.stopAnim(rec);
		rec.anim = {
			index: 0,
			key,
			loop: res.loop ?? 'all',
			steps: res.steps!
		};
		this.drawStep(rec, duration, ease);
		this.scheduleStep(rec);

		return true;
	}

	private stopAnim(rec: EntityRecord): void {
		if (rec.anim?.timer !== undefined) {
			clearTimeout(rec.anim.timer);
		}

		rec.anim = undefined;
	}

	/**
	 * Draw the step the cycle is standing on. Everything an ordinary update does, against
	 * the step's own resolved entity — so a step's `at`/`scale`/`flip` need no second code
	 * path to reach the screen.
	 *
	 * Frames swap HARD (`setContent` duration 0): a cross-fade is for a pose change the
	 * reader is meant to notice, and cross-fading a ten-per-second cycle is a blur.
	 */
	private drawStep(rec: EntityRecord, duration = 0, ease?: string): void {
		const anim = rec.anim;
		const step = anim?.steps[anim.index];

		if (!anim || !step) {
			return;
		}

		rec.entity = step.res.entity;
		rec.character = step.res.character;
		rec.frameName = step.res.frameName;
		rec.metrics = this.metricsFor(step.res);

		this.setContent(rec, step.res, 0);
		this.applyFrameFit(rec, step.res);

		// A step that names an `at` GLIDES over its own hold, so a walk translates smoothly
		// while the poses swap. A step that names none inherits the entity's placement, and
		// must not re-animate a move the beat already finished.
		//
		// The step's own `ease` is the narrowest layer there is, and it applies only to the
		// glide it is about: a step that moves nowhere is still standing in the beat's
		// movement, so the beat's curve is the right one to leave on the element.
		this.layout(
			rec,
			step.moves ? step.seconds : duration,
			undefined,
			step.moves ? step.ease ?? ease : ease
		);

		if (step.moves) {
			// The sprite is travelling, so the y that decides draw order is travelling too.
			this.assignZ();
		}
	}

	private scheduleStep(rec: EntityRecord): void {
		const anim = rec.anim;

		if (!anim) {
			return;
		}

		const current = anim.steps[anim.index];
		const last = anim.index >= anim.steps.length - 1;

		if (!current || (last && anim.loop === 'once')) {
			// `once` holds its final pose. Nothing more to schedule, and the state stays put
			// so a later apply with the same cycle does not restart it.
			return;
		}

		anim.timer = setTimeout(() => {
			if (rec.anim !== anim || rec.exiting) {
				return;
			}

			anim.index = last ? 0 : anim.index + 1;
			this.drawStep(rec);
			this.scheduleStep(rec);
		}, current.seconds * 1000);
	}

	private exitEntity(
		rec: EntityRecord,
		duration: number,
		ease = cssEase(undefined, 'exit')
	): void {
		// A departing sprite fades as it is; nothing is gained by cycling its legs into the
		// void, and the timer would outlive the element it draws to.
		this.stopAnim(rec);
		rec.exiting = true;
		rec.el.style.transitionDuration = `${duration}s`;
		rec.el.style.transitionTimingFunction = ease;
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
	private setContent(
		rec: EntityRecord,
		res: ResolvedEntity,
		duration = 0,
		ease = cssEase(undefined, 'frame')
	): void {
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
			previous.style.transitionTimingFunction = ease;
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
	private applyFrameFit(rec: EntityRecord, res: ResolvedEntity): void {
		if (!rec.img) {
			return;
		}

		const style = rec.img.style;

		// A `fit:` plane's picture fills the stage, so neither of this function's two inputs
		// applies: there is no sprite origin to pin it to and a frame's registration
		// transform would shift a backdrop off the edge. Written inline as well as in the
		// stylesheet because an entity that WAS a sprite still carries that sprite's
		// `object-position`, and a stylesheet cannot outrank it.
		if (res.entity.fit) {
			style.objectFit = res.entity.fit;
			style.objectPosition = '50% 50%';
			style.transform = '';
			style.transformOrigin = '';
			return;
		}

		// Back to the stylesheet's `contain` for an entity that has stopped being a plane.
		style.objectFit = '';

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
		// A resolved character decides this, not the declared kind: an `auto` entity that
		// found a character is a character, whatever the parser was able to say about it.
		if (res.character || res.entity.kind === 'cast') {
			return characterMetrics(
				this.box,
				res.character ?? {size: PLACEHOLDER_FRAME, origin: DEFAULT_ORIGIN},
				res.entity.scale
			);
		}

		// A prop's origin is its asset's, so an author pins the art once in the asset
		// editor rather than in every scene that places it.
		return propMetrics(
			this.box,
			res.meta && res.meta.w > 0 && res.meta.h > 0 ? res.meta : PLACEHOLDER_PROP,
			res.meta?.origin ?? DEFAULT_ORIGIN,
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
		from?: {rise: number; opacity: number},
		ease = cssEase(undefined, 'move')
	): void {
		const {entity, metrics} = rec;

		if (entity.fit) {
			this.layoutPlane(rec, duration, from, ease);
			return;
		}

		rec.rect = spriteRect(this.box, entity.at ?? {x: 0, y: 0}, metrics);

		const style = rec.el.style;
		const y = rec.rect.top + (from?.rise ?? 0);

		style.width = `${metrics.width}px`;
		style.height = `${metrics.height}px`;
		style.transformOrigin = `${metrics.origin.x * 100}% ${metrics.origin.y * 100}%`;
		style.transitionDuration = `${Math.max(0, duration)}s`;
		style.transitionTimingFunction = ease;
		// Order is the renderer's to decide, and this is why `rot` is a key rather than a
		// CSS string the author writes: the mirror has to come LAST so it is applied to the
		// sprite FIRST, and a positive `rot` therefore leans the same way on screen whether
		// the character faces left or right. Written the other way round, flipping a tilted
		// sprite would silently reverse its tilt.
		const rot = entity.rot ?? 0;

		style.transform = `translate3d(${rec.rect.left}px, ${y}px, 0)${
			rot ? ` rotate(${rot}deg)` : ''
		} scaleX(${entity.flip ? -1 : 1})`;
		style.opacity = String(
			from ? from.opacity : clamp01(entity.opacity ?? 1)
		);
	}

	/**
	 * A `fit:` entity: a full-bleed PLANE in the same z space as every sprite.
	 *
	 * None of `spriteRect`'s metrics are consulted, and that is the whole feature — the
	 * element is the stage box, the picture inside it is `object-fit: cover`/`contain`, and
	 * `at`, `of`, `scale` and `rot` have nothing to act on (the parser warns about all
	 * four). What still reaches it is everything that is not geometry: `z` through
	 * `assignZ`, `opacity`, `flip`, and the enter/exit fade.
	 *
	 * `rect` is the stage box rather than nothing, because `rectOf` and `measure` are
	 * contracts other code reads — the honest answer to "where is this plane" is "all of
	 * it". The visual editor skips planes when it hit-tests rather than relying on a rect
	 * that would swallow every click meant for the cast.
	 *
	 * ENTER_RISE is deliberately not applied: a backdrop sliding up 3% shows the stage edge
	 * under it, so a plane's entrance is the fade alone.
	 */
	private layoutPlane(
		rec: EntityRecord,
		duration: number,
		from?: {rise: number; opacity: number},
		ease = cssEase(undefined, 'move')
	): void {
		const {entity} = rec;
		const style = rec.el.style;

		rec.rect = {
			left: 0,
			top: 0,
			width: this.box.width,
			height: this.box.height
		};

		style.width = '100%';
		style.height = '100%';
		style.transformOrigin = '50% 50%';
		style.transitionDuration = `${Math.max(0, duration)}s`;
		style.transitionTimingFunction = ease;
		style.transform = `scaleX(${entity.flip ? -1 : 1})`;
		style.opacity = String(
			from ? from.opacity : clamp01(entity.opacity ?? 1)
		);
	}

	/**
	 * Draw order for the whole stage. Explicit z wins, otherwise it derives from y — lower on
	 * screen is nearer, so it paints later. Ties go to whichever id the CURRENT scene lists
	 * first.
	 *
	 * The order comes from `keyOrder`, not from this Map: entities persist across scenes, so
	 * the Map remembers when each one first appeared rather than where the author put it in
	 * the scene now on screen.
	 */
	private assignZ(): void {
		const items = [...this.entities.values()].map(rec => ({
			id: rec.id,
			at: rec.entity.at ?? {x: 0, y: 0},
			// A plane has no y to derive an order from, so it falls back to the same seed
			// the parser writes rather than to whatever `at` a materialized entity was
			// given — a stage built by hand goes through here too. Explicit `z:` still wins.
			z: rec.entity.fit ? rec.entity.z ?? FIT_Z : rec.entity.z,
			// Anything not in the current stage is exiting. Park it after the live ones so a
			// fading sprite cannot jump in front of the scene it is leaving.
			order: this.keyOrder.get(rec.id) ?? Number.MAX_SAFE_INTEGER,
			rec
		}));

		sortByZ(items).forEach((item, i) => {
			item.rec.el.style.zIndex = String(i + 1);
		});
	}

	// -----------------------------------------------------------------------
	// Background, fx, camera
	// -----------------------------------------------------------------------

	private syncBg(
		bg: string | undefined,
		duration: number,
		implicit: boolean,
		ease = cssEase(undefined, 'bg')
	): void {
		if (bg === this.bgId) {
			return;
		}

		this.bgId = bg;

		const previous = this.bgEl;
		const layer = this.bgLayerEl;

		if (!layer) {
			return;
		}

		// The twin belongs to the image that is going away, and a fade would leave it
		// sliding over the new backdrop. syncBgFx rebuilds it for the new one.
		this.bgTwinEl?.remove();
		this.bgTwinEl = undefined;

		const drop = () => {
			if (!previous) {
				return;
			}

			if (duration > 0) {
				previous.style.transitionDuration = `${duration}s`;
				previous.style.transitionTimingFunction = ease;
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
			this.bgEl = this.makeBgImage(url, layer, duration, ease);
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
			// Held as the current element, not dropped on the floor: `drop()` removes
			// whatever the LAST backdrop left behind, so a placeholder nobody remembers is
			// a placeholder that never leaves. One `? bg` per swap piled up in the layer
			// until the scene ended, which only became visible once a beat could cut the
			// backdrop mid-scene.
			this.bgEl = ph;
		}

		drop();
	}

	/**
	 * The backdrop's own motion — a parallax drift, a shudder — as a data attribute plus a
	 * custom property, never as a class or an inline animation.
	 *
	 * Which means an unknown token is not an error: the preset motions are CSS rules keyed
	 * on `[data-bg-fx='…']`, and a story's own stylesheet can key on its own token exactly
	 * the way `bubble: {as: …}` already works. `speed` is optional for the same reason the
	 * presets differ so much — a parallax drifts for twenty seconds, an earthquake shudders
	 * in half of one — so each preset's CSS carries its own duration and `--sliders-bg-speed`
	 * only overrides it when the author said a number.
	 *
	 * Also on the root, like `data-music`: from outside, an <img>'s running animation is
	 * otherwise unanswerable.
	 */
	private syncBgFx(fx: Stage['bgFx']): void {
		this.syncBgTwin(fx);

		const targets = [this.bgEl, this.bgTwinEl, this.rootEl];

		for (const el of targets) {
			if (!el) {
				continue;
			}

			if (fx) {
				el.dataset.bgFx = fx.id;
			} else {
				delete el.dataset.bgFx;
			}
		}

		for (const el of [this.bgEl, this.bgTwinEl]) {
			el?.style.setProperty(
				'--sliders-bg-speed',
				fx?.speed === undefined ? '' : `${fx.speed}s`
			);
		}
	}

	/**
	 * Build or drop the trailing copy that makes a scroll seamless.
	 *
	 * The pair shares one keyframe — a whole frame's travel — and the twin is parked one
	 * frame ahead by CSS (`left: 100%` and friends), so the loop restarts on the exact
	 * picture it ended on. Doing it with one element would mean tiling, which an <img>
	 * cannot do, and a CSS `background-image` tile cannot keep `object-fit: cover`'s
	 * framing, which is what every still backdrop in the story is composed against.
	 *
	 * Only for a real image: a `? bg` placeholder has nothing to loop, and two copies of it
	 * would just be two labels chasing each other.
	 */
	private syncBgTwin(fx: Stage['bgFx']): void {
		const source = this.bgEl;
		const wanted =
			bgMotionTiles(fx?.id) &&
			!!this.doc &&
			source instanceof (this.doc.defaultView?.HTMLImageElement ??
				HTMLImageElement);

		if (!wanted) {
			this.bgTwinEl?.remove();
			this.bgTwinEl = undefined;

			return;
		}

		const img = source as HTMLImageElement;

		if (!this.bgTwinEl) {
			const twin = this.doc!.createElement('img');

			twin.className = 'sliders-bg sliders-bg-tile';
			twin.alt = '';
			twin.draggable = false;
			// Aria-hidden because it is the same picture twice: a reader being told about a
			// backdrop should not be told about it a second time.
			twin.setAttribute('aria-hidden', 'true');
			img.parentElement?.appendChild(twin);
			this.bgTwinEl = twin;
		}

		if (this.bgTwinEl.src !== img.src) {
			this.bgTwinEl.src = img.src;
		}
	}

	private makeBgImage(
		url: string,
		layer: HTMLElement,
		duration: number,
		ease = cssEase(undefined, 'bg')
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
			img.style.transitionTimingFunction = ease;
			img.style.opacity = '1';
		} else {
			layer.appendChild(img);
		}

		return img;
	}

	// -----------------------------------------------------------------------
	// Sound
	// -----------------------------------------------------------------------

	/**
	 * The deck, built on first use and told who resolves names.
	 *
	 * `undefined` where there is no document to build <audio> in — jsdom without the
	 * element, a server render — so every caller treats sound as best-effort.
	 */
	private soundDeck(): SoundDeck | undefined {
		if (!this.doc || typeof this.doc.createElement !== 'function') {
			return undefined;
		}

		if (!this.deck) {
			this.deck = new SoundDeck({
				doc: this.doc,
				onBlocked: () => {
					this.blockedSound = true;
					this.notify();
				}
			});
			this.deck.setMuted(this.mutedWanted);
		}

		this.deck.setResolver(this.assets);
		return this.deck;
	}

	private syncMusic(music: Stage['music'], duration: number): void {
		// What the stage BELIEVES is playing, on the root element. The deck's <audio>
		// elements are deliberately detached, so this attribute is the only thing a test —
		// or a story's own CSS — can see; without it, "is the bed running" is unanswerable
		// from outside. Set even while muted: it says what the scene asks for, not what a
		// speaker is doing.
		if (this.rootEl) {
			if (music) {
				this.rootEl.dataset.music = music.id;
			} else {
				delete this.rootEl.dataset.music;
			}
		}

		// Nothing playing and nothing asked for is the common case, and building a deck for
		// it would mean every silent scene in the editor carrying audio machinery.
		if (!music && !this.deck) {
			return;
		}

		void this.soundDeck()?.music(music, duration);
	}

	/** Fire a one-shot. See `Renderer.cue` for why this is not part of `apply()`. */
	cue(sound: StageSound): void {
		// Counted, for the same reason `data-music` exists: a one-shot leaves no trace at
		// all otherwise — it is detached, it is brief, and by the time anything looks it has
		// ended. The count is what a test asserts on and what says a cue arrived.
		this.cues++;

		if (this.rootEl) {
			this.rootEl.dataset.sfx = sound.id;
			this.rootEl.dataset.sfxCount = String(this.cues);
		}

		void this.soundDeck()?.cue(sound);
	}

	setMuted(muted: boolean): void {
		this.mutedWanted = muted;

		// On the root so it is visible from outside, like `data-music`. A story that wants
		// to draw "tap for sound" has nothing else to hang it on — the autoplay refusal
		// happens inside a detached element nobody can see.
		if (this.rootEl) {
			this.rootEl.dataset.muted = String(muted);
		}

		if (!muted) {
			// Unmuting is the gesture that lifts an autoplay refusal, so the flag goes with it.
			this.blockedSound = false;
		}

		this.deck?.setMuted(muted);

		// A stage muted before its first apply() has no deck yet; one built later reads
		// `mutedWanted`. Unmuting, though, means the author wants to hear what is already on
		// stage, so the bed has to be started rather than waited for.
		if (!muted && !this.deck) {
			this.soundDeck();
		}
	}

	/** True when a sound was refused for want of a user gesture. */
	soundBlocked(): boolean {
		return this.blockedSound;
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

	private syncCamera(
		duration: number,
		ease = cssEase(undefined, 'camera')
	): void {
		if (!this.cameraEl) {
			return;
		}

		const offset = cameraOffsetPx(this.box, this.camera);
		const zoom = safeZoom(this.camera.zoom);

		this.cameraEl.style.transitionDuration = `${Math.max(0, duration)}s`;
		this.cameraEl.style.transitionTimingFunction = ease;
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
				meta: rec.character ? undefined : this.metaCache.get(rec.entity.ref)
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

/** How long a change takes and what shape it takes, which always travel together. */
interface TransitionTiming {
	duration: number;
	/** Always a CSS timing function — `cssEase` falls back to the kind's default. */
	ease: string;
}

interface TransitionIndex {
	duration(kind: TransitionKind, entityId?: EntityId): number;
	ease(kind: TransitionKind, entityId?: EntityId): string;
	/**
	 * The timing that wins when several kinds land on ONE element, which is the case for
	 * an entity's move, flip and scale: CSS gives that element a single
	 * `transition-duration` and a single `transition-timing-function`, so the longest
	 * change has to supply both. Taking the duration from one kind and the curve from
	 * another would produce a movement neither of them describes. Ties go to the first
	 * kind listed.
	 */
	longest(kinds: readonly TransitionKind[], entityId?: EntityId): TransitionTiming;
}

/**
 * Transitions arrive as a flat list from the differ. Index them so lookups are O(1) and an
 * absent transition means "snap", which is what the preview wants while typing (spec 06).
 */
function indexTransitions(transitions: Transition[]): TransitionIndex {
	const byKey = new Map<string, number>();
	const easeByKey = new Map<string, string>();

	for (const t of transitions ?? []) {
		if (!t) {
			continue;
		}

		const key = `${t.kind}:${t.entityId ?? ''}`;
		const seconds = Number.isFinite(t.duration) ? Math.max(0, t.duration) : 0;

		byKey.set(key, Math.max(byKey.get(key) ?? 0, seconds));

		if (t.ease !== undefined) {
			easeByKey.set(key, t.ease);
		}
	}

	const index: TransitionIndex = {
		duration(kind, entityId) {
			return byKey.get(`${kind}:${entityId ?? ''}`) ?? byKey.get(`${kind}:`) ?? 0;
		},
		ease(kind, entityId) {
			// The entity's own token, then the stage-wide one, then the kind's default.
			const token =
				easeByKey.get(`${kind}:${entityId ?? ''}`) ?? easeByKey.get(`${kind}:`);

			return cssEase(token, kind);
		},
		longest(kinds, entityId) {
			let best: TransitionKind = kinds[0];
			let duration = 0;

			for (const kind of kinds) {
				const seconds = index.duration(kind, entityId);

				if (seconds > duration) {
					duration = seconds;
					best = kind;
				}
			}

			return {duration, ease: index.ease(best, entityId)};
		}
	};

	return index;
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
