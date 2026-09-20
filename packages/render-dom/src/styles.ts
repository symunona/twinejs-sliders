/**
 * Renderer styles, injected once as a <style> tag.
 *
 * Kept as a TS string rather than a .css import so the package works identically under vite,
 * jest and a plain <script type="module"> harness with no bundler plugin in the way.
 */

const STYLE_ID = 'sliders-render-dom-styles';

export const RENDER_DOM_CSS = `
.sliders-root {
	position: absolute;
	inset: 0;
	overflow: hidden;
	/* Letterbox bars. */
	background: #05070c;
}

.sliders-stage-box {
	position: absolute;
	overflow: hidden;
	background: #11151f;
	contain: layout paint;
}

.sliders-camera {
	position: absolute;
	inset: 0;
	transform-origin: 50% 50%;
	transition-property: transform;
	transition-duration: 0s;
	transition-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
	will-change: transform;
}

.sliders-layer {
	position: absolute;
	inset: 0;
}

.sliders-layer[data-layer='bg'] { z-index: 0; }
.sliders-layer[data-layer='entities'] { z-index: 10; }

.sliders-bg {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
	object-fit: cover;
	opacity: 1;
	transition-property: opacity;
	transition-duration: 0s;
	transition-timing-function: ease;
}

/*
 * Backdrop motion — bg: {id: cellar, fx: parallax_left, speed: 20}.
 *
 * Keyed on the token the author wrote, so a story's own stylesheet can define its own the
 * same way it defines a bubble style. Each preset carries its OWN duration, because there
 * is no one sane number for both a twenty-second drift and a half-second shudder;
 * --sliders-bg-speed is set only when the author names one, and an empty custom property
 * falls back to the preset's number.
 *
 * A pan needs somewhere to pan to, so the parallax presets oversize the image and offset it
 * by half the overshoot — the backdrop is object-fit: cover, so it stays covered
 * throughout. alternate is what makes a loop seamless: a drift that jumped back to its
 * start would read as a cut, and the price is that a full there-and-back cycle takes twice
 * speed, which is the honest meaning of "one cycle of the motion".
 */
.sliders-bg[data-bg-fx] {
	will-change: transform;
	/* The player's own stylesheet caps every img at max-width: 100%, which silently
	   undid the oversize a pan needs and let the stage edge show through. Measured in
	   the player: 116% computed back to 100%. */
	max-width: none;
	max-height: none;
	animation-iteration-count: infinite;
	animation-timing-function: ease-in-out;
	animation-direction: alternate;
}

.sliders-bg[data-bg-fx^='parallax_left'],
.sliders-bg[data-bg-fx^='parallax_right'] {
	width: 116%;
	left: -8%;
}

.sliders-bg[data-bg-fx^='parallax_up'],
.sliders-bg[data-bg-fx^='parallax_down'] {
	height: 116%;
	top: -8%;
}

.sliders-bg[data-bg-fx='parallax_left'] {
	animation-name: sliders-bg-parallax-left;
	animation-duration: var(--sliders-bg-speed, 24s);
}

.sliders-bg[data-bg-fx='parallax_right'] {
	animation-name: sliders-bg-parallax-right;
	animation-duration: var(--sliders-bg-speed, 24s);
}

.sliders-bg[data-bg-fx='parallax_up'] {
	animation-name: sliders-bg-parallax-up;
	animation-duration: var(--sliders-bg-speed, 24s);
}

.sliders-bg[data-bg-fx='parallax_down'] {
	animation-name: sliders-bg-parallax-down;
	animation-duration: var(--sliders-bg-speed, 24s);
}

.sliders-bg[data-bg-fx='earthquake'] {
	width: 106%;
	height: 106%;
	left: -3%;
	top: -3%;
	animation-name: sliders-bg-earthquake;
	animation-duration: var(--sliders-bg-speed, 0.5s);
	animation-timing-function: linear;
	animation-direction: normal;
}

.sliders-bg[data-bg-fx='circling'] {
	width: 108%;
	height: 108%;
	left: -4%;
	top: -4%;
	animation-name: sliders-bg-circling;
	animation-duration: var(--sliders-bg-speed, 30s);
	animation-timing-function: linear;
	animation-direction: normal;
}

/*
 * scroll_infinite_* — the picture LOOPS rather than drifting inside the frame.
 *
 * Two copies, one keyframe: each travels a whole frame, and .sliders-bg-tile is parked one
 * frame ahead, so the instant the first copy has left the second is exactly where the first
 * began and the restart is invisible. No oversize here — a copy is a full frame wide, and
 * widening it would break the hand-off by the amount it was widened.
 */
.sliders-bg[data-bg-fx^='scroll_infinite'] {
	animation-direction: normal;
	animation-timing-function: linear;
	animation-duration: var(--sliders-bg-speed, 20s);
}

.sliders-bg[data-bg-fx='scroll_infinite_left'] { animation-name: sliders-bg-scroll-left; }
.sliders-bg[data-bg-fx='scroll_infinite_right'] { animation-name: sliders-bg-scroll-right; }
.sliders-bg[data-bg-fx='scroll_infinite_up'] { animation-name: sliders-bg-scroll-up; }
.sliders-bg[data-bg-fx='scroll_infinite_down'] { animation-name: sliders-bg-scroll-down; }

/* Where the trailing copy waits: the frame the leading one is about to vacate. */
.sliders-bg-tile[data-bg-fx='scroll_infinite_left'] { left: 100%; }
.sliders-bg-tile[data-bg-fx='scroll_infinite_right'] { left: -100%; }
.sliders-bg-tile[data-bg-fx='scroll_infinite_up'] { top: 100%; }
.sliders-bg-tile[data-bg-fx='scroll_infinite_down'] { top: -100%; }

@keyframes sliders-bg-scroll-left {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(-100%, 0, 0); }
}

@keyframes sliders-bg-scroll-right {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(100%, 0, 0); }
}

@keyframes sliders-bg-scroll-up {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(0, -100%, 0); }
}

@keyframes sliders-bg-scroll-down {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(0, 100%, 0); }
}

@keyframes sliders-bg-parallax-left {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(-8%, 0, 0); }
}

@keyframes sliders-bg-parallax-right {
	from { transform: translate3d(-8%, 0, 0); }
	to { transform: translate3d(0, 0, 0); }
}

@keyframes sliders-bg-parallax-up {
	from { transform: translate3d(0, 0, 0); }
	to { transform: translate3d(0, -8%, 0); }
}

@keyframes sliders-bg-parallax-down {
	from { transform: translate3d(0, -8%, 0); }
	to { transform: translate3d(0, 0, 0); }
}

@keyframes sliders-bg-earthquake {
	0% { transform: translate3d(0, 0, 0); }
	10% { transform: translate3d(-1.2%, 0.6%, 0); }
	20% { transform: translate3d(1%, -0.9%, 0); }
	30% { transform: translate3d(-0.8%, -0.5%, 0); }
	40% { transform: translate3d(1.1%, 0.8%, 0); }
	50% { transform: translate3d(-1%, 0.3%, 0); }
	60% { transform: translate3d(0.7%, -1%, 0); }
	70% { transform: translate3d(-0.9%, 0.9%, 0); }
	80% { transform: translate3d(1.2%, -0.4%, 0); }
	90% { transform: translate3d(-0.5%, -0.7%, 0); }
	100% { transform: translate3d(0, 0, 0); }
}

@keyframes sliders-bg-circling {
	0% { transform: translate3d(-2%, 0, 0); }
	25% { transform: translate3d(0, -2%, 0); }
	50% { transform: translate3d(2%, 0, 0); }
	75% { transform: translate3d(0, 2%, 0); }
	100% { transform: translate3d(-2%, 0, 0); }
}

@media (prefers-reduced-motion: reduce) {
	/* A drifting backdrop is decoration; a reader who asked for stillness gets it. */
	.sliders-bg[data-bg-fx] {
		animation: none;
	}

	/* The glow still appears — it is the affordance, not decoration. It just stops easing. */
	.sliders-entity[data-sliders-link] > img {
		transition: none;
	}
}

.sliders-entity {
	position: absolute;
	left: 0;
	top: 0;
	/* Size is width/height, not transform, so scale: has to be listed or a resize snaps
	   while the position glides. */
	transition-property: transform, opacity, width, height;
	transition-duration: 0s;
	transition-timing-function: cubic-bezier(0.22, 0.61, 0.36, 1);
	will-change: transform, opacity;
	pointer-events: none;
}

/* The ONE entity that takes the pointer. The default above is load-bearing: the visual
   editor hit-tests by rectangle through an overlay that covers the whole stage, and a
   sprite that swallowed events would break dragging. The overlay still sits on top, so
   this only ever takes effect in the player, where there is no overlay. */
.sliders-entity[data-sliders-link] {
	pointer-events: auto;
	cursor: pointer;
}

.sliders-entity[data-sliders-link] > img {
	transition: filter 0.18s ease;
}

/* A glow that follows the ART, not the box.

   drop-shadow() is alpha-aware where box-shadow and outline are not, so a PNG cut out with
   transparent edges lights up along its own silhouette. Three of them at zero offset and
   growing blur read as one faded border rather than as three rings; one shadow alone is
   either too tight to notice or too soft to locate.

   Focus is included because the element is a real tab stop: a reader on a keyboard has no
   hover, and the glow is the only thing that says which object is about to be opened. */
.sliders-entity[data-sliders-link]:hover > img,
.sliders-entity[data-sliders-link]:focus > img,
.sliders-entity[data-sliders-link]:focus-visible > img {
	filter:
		drop-shadow(0 0 2px var(--sliders-highlight, #ffd257))
		drop-shadow(0 0 6px var(--sliders-highlight, #ffd257))
		drop-shadow(0 0 14px var(--sliders-highlight, #ffd257));
}

/* The box is the tab stop, so the browser's own focus ring would draw a rectangle around a
   sprite that is not rectangular. The glow above IS the focus indicator. */
.sliders-entity[data-sliders-link]:focus,
.sliders-entity[data-sliders-link]:focus-visible {
	outline: none;
}

/* Tokens the renderer ships a colour for. Any other token still reaches the DOM as
   data-highlight and is the story stylesheet's to paint — the same extension point
   bubble: {as:} and bg: {fx:} have. */
.sliders-entity[data-highlight='gold'] { --sliders-highlight: #ffd257; }
.sliders-entity[data-highlight='danger'] { --sliders-highlight: #ff6b5e; }
.sliders-entity[data-highlight='cold'] { --sliders-highlight: #6fd2ff; }
.sliders-entity[data-highlight='warm'] { --sliders-highlight: #ff9a3c; }

.sliders-entity > img,
.sliders-entity > .sliders-placeholder {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.sliders-entity > img {
	/* Box fit, not stretch: a frame whose aspect differs from the character's manifest
	   size keeps its own shape inside the sprite box. Pinned by object-position, which
	   the renderer overwrites with the entity's own origin (feet, by default) so a frame
	   that ends up shorter than the box still stands on the floor instead of floating. */
	object-fit: contain;
	object-position: 50% 100%;
	image-rendering: auto;
	user-select: none;
	-webkit-user-drag: none;
}

.sliders-entity > .sliders-ghost {
	transition-property: opacity;
	transition-timing-function: ease;
}

.sliders-placeholder {
	box-sizing: border-box;
	display: flex;
	align-items: center;
	justify-content: center;
	padding: 4px;
	border: 2px dashed #ff7ab6;
	border-radius: 6px;
	background: repeating-linear-gradient(
		45deg,
		rgba(255, 122, 182, 0.14) 0 8px,
		rgba(255, 122, 182, 0.04) 8px 16px
	);
	color: #ffd9ea;
	font: 500 13px/1.25 system-ui, sans-serif;
	text-align: center;
	overflow: hidden;
	word-break: break-word;
}

.sliders-fx-stack {
	position: absolute;
	inset: 0;
	z-index: 40;
	pointer-events: none;
}

.sliders-fx {
	position: absolute;
	inset: 0;
	transition: opacity 0.25s ease;
}

.sliders-fx[data-fx='dark'] { background: #000; }
.sliders-fx[data-fx='flash'] { background: #fff; }
.sliders-fx[data-fx='rain'] {
	background: repeating-linear-gradient(
		100deg,
		rgba(190, 220, 255, 0.35) 0 1px,
		transparent 1px 7px
	);
}
.sliders-fx[data-fx='warm'] { background: #ff9a3c; mix-blend-mode: overlay; }
.sliders-fx[data-fx='cold'] { background: #3c8cff; mix-blend-mode: overlay; }

.sliders-guides {
	position: absolute;
	inset: 0;
	z-index: 45;
	pointer-events: none;
	display: none;
}

.sliders-root[data-guides='true'] .sliders-guides { display: block; }

.sliders-guides::before,
.sliders-guides::after {
	content: '';
	position: absolute;
	background: rgba(120, 220, 255, 0.45);
}

/* Vertical centre line. */
.sliders-guides::before {
	left: 50%;
	top: 0;
	bottom: 0;
	width: 1px;
}

/* Horizontal centre line = the y = 0 floor. */
.sliders-guides::after {
	top: 50%;
	left: 0;
	right: 0;
	height: 1px;
}
`;

export const DIALOGUE_CSS = `
.sliders-dialogue {
	position: absolute;
	inset: 0;
	z-index: 50;
	pointer-events: none;
	font: 16px/1.4 system-ui, -apple-system, 'Segoe UI', sans-serif;
}

.sliders-bubble {
	position: absolute;
	left: 0;
	top: 0;
	box-sizing: border-box;
	max-width: 42%;
	min-width: 64px;
	padding: 10px 14px;
	border-radius: 14px;
	background: var(--sliders-bubble-bg, #fdfdfb);
	color: var(--sliders-bubble-color, #14161c);
	font-family: var(--sliders-bubble-font, inherit);
	font-size: var(--sliders-bubble-size, 1em);
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
	pointer-events: auto;
	white-space: pre-wrap;
	opacity: 1;
	/* Follows the speaker when a move transition slides them across the stage. */
	transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.sliders-bubble[data-entering='true'] { opacity: 0; }

/* A drawn shape REPLACES the box: no fill, no rounding, no shadow, no CSS tail. The
   padding it needs is written inline by the dialogue layer, because only the shape knows
   how much of its own rectangle is outline, scallop or slab. */
.sliders-bubble[data-shape] {
	background: none;
	border-radius: 0;
	box-shadow: none;
}

.sliders-bubble[data-shape] .sliders-bubble-tail { display: none !important; }

/* sizing: absolute and sizing: manual both state the rectangle, so the width the layout
   writes inline is the whole truth and the stylesheet's cap must not argue with it. The
   clip is on the BODY, never on the bubble: clipping the bubble would cut off the very
   drawing that reaches outside it. */
.sliders-bubble[data-sizing='absolute'],
.sliders-bubble[data-sizing='manual'] {
	max-width: none;
	min-width: 0;
	/* Written by the layout, in stage fractions — see PAD_Y/PAD_X. A drawn shape's own
	   inline padding still wins over this. */
	padding: var(--sliders-bubble-pad-y, 10px) var(--sliders-bubble-pad-x, 14px);
}

/* The box has no inner body to clip — its text is its own children — so the clip goes on
   the bar itself. Safe where it would not be on a bubble: nothing draws outside a box. */
.sliders-box[data-sizing='absolute'],
.sliders-box[data-sizing='manual'] {
	overflow: hidden;
}

.sliders-bubble[data-sizing='absolute'] .sliders-bubble-body,
.sliders-bubble[data-sizing='manual'] .sliders-bubble-body {
	height: 100%;
	overflow: hidden;
}

/* Sized and offset by the SVG's own inline left/top, so the drawing may reach outside the
   bubble box without moving the text inside it. */
.sliders-bubble-shape {
	position: absolute;
	left: 0;
	top: 0;
	width: 0;
	height: 0;
	pointer-events: none;
}

.sliders-bubble-shape-svg {
	position: absolute;
	overflow: visible;
}

/* The text has to sit above the drawing, and a positioned child is what makes that true
   without giving every bubble a z-index of its own. */
.sliders-bubble-body {
	position: relative;
	z-index: 1;
}

.sliders-bubble-name {
	display: block;
	margin-bottom: 2px;
	font-size: 0.75em;
	font-weight: 700;
	letter-spacing: 0.06em;
	text-transform: uppercase;
	color: #7a6cff;
}

/* data-side names where the BUBBLE sits, so the tail hangs off the opposite edge. */
.sliders-bubble-tail {
	position: absolute;
	width: 0;
	height: 0;
}

.sliders-bubble[data-side='above'] .sliders-bubble-tail {
	bottom: -11px;
	border-left: 9px solid transparent;
	border-right: 9px solid transparent;
	border-top: 12px solid var(--sliders-bubble-bg, #fdfdfb);
}

.sliders-bubble[data-side='below'] .sliders-bubble-tail {
	top: -11px;
	border-left: 9px solid transparent;
	border-right: 9px solid transparent;
	border-bottom: 12px solid var(--sliders-bubble-bg, #fdfdfb);
}

.sliders-bubble[data-side='left'] .sliders-bubble-tail {
	right: -11px;
	border-top: 9px solid transparent;
	border-bottom: 9px solid transparent;
	border-left: 12px solid var(--sliders-bubble-bg, #fdfdfb);
}

.sliders-bubble[data-side='right'] .sliders-bubble-tail {
	left: -11px;
	border-top: 9px solid transparent;
	border-bottom: 9px solid transparent;
	border-right: 12px solid var(--sliders-bubble-bg, #fdfdfb);
}

.sliders-box {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	box-sizing: border-box;
	padding: 16px 22px;
	background: var(
		--sliders-bubble-bg,
		linear-gradient(to top, rgba(4, 6, 12, 0.94), rgba(4, 6, 12, 0.72))
	);
	color: var(--sliders-bubble-color, #eef1f7);
	font-family: var(--sliders-bubble-font, inherit);
	font-size: var(--sliders-bubble-size, 1em);
	pointer-events: auto;
	white-space: pre-wrap;
	opacity: 1;
	transition: opacity 0.18s ease;
}

.sliders-box[data-entering='true'] { opacity: 0; }

/* -------------------------------------------------------------------------
   Presets — what \`as:\` names. A token with no rule here is not an error: it
   lands on the element as data-style and the story's own stylesheet paints it.
   ------------------------------------------------------------------------- */

.sliders-bubble[data-style='bold'],
.sliders-box[data-style='bold'] { font-weight: 700; }

.sliders-bubble[data-style='italic'],
.sliders-box[data-style='italic'] { font-style: italic; }

.sliders-bubble[data-style='bold-italic'],
.sliders-box[data-style='bold-italic'] {
	font-style: italic;
	font-weight: 700;
}

.sliders-bubble[data-style='whisper'],
.sliders-box[data-style='whisper'] {
	font-size: calc(var(--sliders-bubble-size, 1em) * 0.85);
	font-style: italic;
	opacity: 0.8;
}

/* The shout. A spiky outline needs a real polygon, so the burst is a clip-path on a
   pseudo-element behind the text: clipping the bubble itself would cut the text off at
   the spikes, and the padding here is what keeps words inside the star's body. */
.sliders-bubble[data-style='yell'] {
	background: none;
	box-shadow: none;
	font-weight: 700;
	letter-spacing: 0.02em;
	padding: 22px 30px;
	text-transform: uppercase;
}

.sliders-bubble[data-style='yell']:before {
	background: var(--sliders-bubble-bg, #fff6e8);
	clip-path: polygon(
		50% 0%, 58% 9%, 66% 3%, 70% 13%, 80% 9%, 81% 19%, 92% 18%, 88% 27%,
		99% 30%, 91% 38%, 100% 46%, 90% 51%, 98% 60%, 87% 62%, 92% 72%, 81% 71%,
		82% 81%, 71% 78%, 68% 88%, 59% 83%, 51% 92%, 44% 83%, 35% 89%, 31% 79%,
		20% 82%, 21% 71%, 10% 72%, 15% 62%, 4% 60%, 12% 51%, 2% 46%, 11% 38%,
		3% 30%, 14% 27%, 10% 18%, 21% 19%, 22% 9%, 32% 13%, 36% 3%, 44% 9%
	);
	content: '';
	filter: drop-shadow(0 6px 20px rgba(0, 0, 0, 0.35));
	inset: -14px -18px;
	position: absolute;
	z-index: -1;
}

/* The spikes ARE the outline, so a tail pointing out of one reads as a stray triangle. */
.sliders-bubble[data-style='yell'] .sliders-bubble-tail { display: none !important; }

/* A narrator is not a speaker: a wide plate, no tail, no shoulder to hang off. */
.sliders-bubble[data-style='narrator'] {
	background: var(--sliders-bubble-bg, rgba(6, 8, 14, 0.88));
	color: var(--sliders-bubble-color, #eef1f7);
	font-style: italic;
	max-width: 70%;
	text-align: center;
}

.sliders-bubble[data-style='narrator'] .sliders-bubble-tail { display: none !important; }

.sliders-box[data-style='narrator'] { text-align: center; }

/* Pinned by at:/place:, so the bar is a plate rather than a full-width band. */
.sliders-box[data-pinned='true'] {
	border-radius: 12px;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
	right: auto;
}

.sliders-link {
	color: #4a3bd6;
	text-decoration: underline;
	text-underline-offset: 2px;
	cursor: pointer;
	border-radius: 3px;
}

.sliders-box .sliders-link { color: #9fd0ff; }

.sliders-link:hover { text-decoration-thickness: 2px; }

.sliders-link:focus-visible {
	outline: 2px solid #7a6cff;
	outline-offset: 2px;
}
`;

/** Idempotent. Safe to call from every mount. */
export function injectStyles(doc: Document | undefined = globalThis.document): void {
	if (!doc || doc.getElementById(STYLE_ID)) {
		return;
	}

	const style = doc.createElement('style');

	style.id = STYLE_ID;
	style.textContent = RENDER_DOM_CSS + DIALOGUE_CSS;
	(doc.head ?? doc.documentElement)?.appendChild(style);
}
