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

export {DialogueLayer, parseLinkText} from './dialogue';
export type {
	BubbleSpec,
	DialogueLayerOptions,
	LinkToken,
	MeasuringRenderer
} from './dialogue';

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
	propMetrics,
	resolveZ,
	safeZoom,
	sceneToBox,
	sortByZ,
	spriteRect
} from './coords';
export type {Rect, SpriteMetrics, StageBox} from './coords';

export {DIALOGUE_CSS, RENDER_DOM_CSS, injectStyles} from './styles';
