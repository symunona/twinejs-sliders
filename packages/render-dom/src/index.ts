/**
 * `@sliders/render-dom` — renderer #1 for the Sliders scene system.
 *
 * ```ts
 * const renderer = new DomRenderer({guides: true});
 * const dialogue = new DialogueLayer({onLink: name => goTo(name)});
 *
 * await renderer.mount(hostEl, createStubResolver());
 * dialogue.mount(hostEl, renderer);
 *
 * await renderer.apply(stage, transitions);
 * dialogue.say('mira', 'Will you [[stay]] or [[go]]?');
 * ```
 */

export {DomRenderer, ENTER_RISE} from './dom-renderer';
export type {DomRendererOptions} from './dom-renderer';

export {
	DialogueLayer,
	applyStyleAttributes,
	mergeBubbleStyle,
	parseLinkText,
	pinnedRect,
	placeBubble,
	preferredSide,
	tailToward
} from './dialogue';
export type {
	BubblePlacement,
	BubbleSide,
	BubbleSpec,
	DialogueLayerOptions,
	LinkHandler,
	LinkToken,
	MeasuringRenderer,
	PlaceBubbleInput
} from './dialogue';

export {LinkListLayer} from './link-list';
export type {LinkListEntry, LinkListLayerOptions} from './link-list';

export {
	BUBBLE_SHAPE_FNS,
	bubbleShape,
	cssColour,
	hashSeed,
	isBubbleShape,
	spliceTail
} from './bubble-shapes';
export type {
	BubblePadding,
	BubbleShapeFn,
	BubbleShapeInput,
	BubbleShapeResult,
	SplicedOutline
} from './bubble-shapes';

export {createStubResolver, defaultStubCast, colorFor} from './stub-resolver';
export type {
	StubAssetSpec,
	StubResolver,
	StubResolverOptions
} from './stub-resolver';

export {
	CHARACTER_STAGE_HEIGHT,
	DEFAULT_ANCHORS,
	DEFAULT_ORIGIN,
	PLACEHOLDER_FRAME,
	PLACEHOLDER_PROP,
	PROP_DESIGN_HEIGHT,
	STAGE_ASPECT,
	anchorPointInRect,
	applyCamera,
	boxToMount,
	boxToScene,
	cameraOffsetPx,
	characterMetrics,
	computeStageBox,
	originPointInRect,
	propMetrics,
	resolveZ,
	rotatePoint,
	safeOrigin,
	safeZoom,
	sceneToBox,
	sortByZ,
	spriteRect
} from './coords';
export type {Rect, SpriteMetrics, StageBox} from './coords';

export {
	DIALOGUE_CSS,
	LINK_LIST_CSS,
	RENDER_DOM_CSS,
	injectBubbleFonts,
	injectStyles
} from './styles';
export {SoundDeck} from './sound-deck';
export type {SoundDeckOptions} from './sound-deck';

export {
	GLITCH_DEFAULTS,
	GLITCH_RANGES,
	effectClass,
	effectCss,
	effectIsIdle,
	effectLayers,
	normalizeEffect,
	normalizeGlitch,
	sameEffect
} from './effects';
export type {EffectLayer} from './effects';
export {
	FX_CSS,
	injectEffectCss,
	injectEffectSupport,
	pruneEffectCss,
	syncEffect
} from './effect-host';
export type {SyncEffectOptions} from './effect-host';
