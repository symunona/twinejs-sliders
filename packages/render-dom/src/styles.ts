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
.sliders-layer[data-layer='back'] { z-index: 10; }
.sliders-layer[data-layer='mid'] { z-index: 20; }
.sliders-layer[data-layer='front'] { z-index: 30; }

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

.sliders-entity > img,
.sliders-entity > .sliders-placeholder {
	position: absolute;
	inset: 0;
	width: 100%;
	height: 100%;
}

.sliders-entity > img {
	object-fit: fill;
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
	background: #fdfdfb;
	color: #14161c;
	box-shadow: 0 6px 20px rgba(0, 0, 0, 0.35);
	pointer-events: auto;
	white-space: pre-wrap;
	opacity: 1;
	/* Follows the speaker when a move transition slides them across the stage. */
	transition: opacity 0.18s ease, transform 0.25s cubic-bezier(0.22, 0.61, 0.36, 1);
}

.sliders-bubble[data-entering='true'] { opacity: 0; }

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
	border-top: 12px solid #fdfdfb;
}

.sliders-bubble[data-side='below'] .sliders-bubble-tail {
	top: -11px;
	border-left: 9px solid transparent;
	border-right: 9px solid transparent;
	border-bottom: 12px solid #fdfdfb;
}

.sliders-bubble[data-side='left'] .sliders-bubble-tail {
	right: -11px;
	border-top: 9px solid transparent;
	border-bottom: 9px solid transparent;
	border-left: 12px solid #fdfdfb;
}

.sliders-bubble[data-side='right'] .sliders-bubble-tail {
	left: -11px;
	border-top: 9px solid transparent;
	border-bottom: 9px solid transparent;
	border-right: 12px solid #fdfdfb;
}

.sliders-box {
	position: absolute;
	left: 0;
	right: 0;
	bottom: 0;
	box-sizing: border-box;
	padding: 16px 22px;
	background: linear-gradient(to top, rgba(4, 6, 12, 0.94), rgba(4, 6, 12, 0.72));
	color: #eef1f7;
	pointer-events: auto;
	white-space: pre-wrap;
	opacity: 1;
	transition: opacity 0.18s ease;
}

.sliders-box[data-entering='true'] { opacity: 0; }

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
