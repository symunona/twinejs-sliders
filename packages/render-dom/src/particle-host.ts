/**
 * Draws a `ParticleSim` into a canvas. WebGL point sprites (GPU, one draw call per
 * emitter); a 2D canvas when WebGL is not there or its context was taken away.
 *
 * The canvas covers the emitter box plus `PAD` box sizes on every side: particles leave
 * the box (smoke rises out of the top of its own box), and the box is what the editor
 * selects and drags, so it cannot simply be made bigger.
 *
 * One `requestAnimationFrame` loop for every host on the page.
 */

import type {EmitParams, Frac2} from '@sliders/scene-types';
import {PARTICLE_STRIDE, ParticleSim} from './particles';

/** Canvas margin around the box, in box sizes per side. */
export const PARTICLE_PAD = 0.5;

const VERT = `
attribute vec2 a_pos;
attribute float a_size;
attribute float a_rot;
attribute vec4 a_color;
uniform vec2 u_res;
varying vec4 v_color;
varying float v_rot;
void main() {
	vec2 clip = a_pos / u_res * 2.0 - 1.0;
	gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
	// sqrt(2) bigger, so the sprite still fits the point square when turned.
	gl_PointSize = a_size * 1.4142;
	v_color = a_color;
	v_rot = a_rot;
}`;

const FRAG = `
precision mediump float;
uniform sampler2D u_tex;
varying vec4 v_color;
varying float v_rot;
void main() {
	vec2 p = (gl_PointCoord - 0.5) * 1.4142;
	float c = cos(v_rot);
	float s = sin(v_rot);
	vec2 uv = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
	if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) discard;
	gl_FragColor = texture2D(u_tex, uv) * v_color;
}`;

interface Painter {
	draw(
		data: Float32Array,
		count: number,
		w: number,
		h: number,
		blend: EmitParams['blend']
	): void;
	texture(img: HTMLImageElement | undefined): void;
	destroy(): void;
}

class GlPainter implements Painter {
	private buffer: WebGLBuffer;
	private program: WebGLProgram;
	private tex: WebGLTexture;
	private loc: {
		pos: number;
		size: number;
		rot: number;
		color: number;
		res: WebGLUniformLocation | null;
	};

	constructor(private gl: WebGLRenderingContext) {
		const compile = (type: number, src: string) => {
			const shader = gl.createShader(type)!;

			gl.shaderSource(shader, src);
			gl.compileShader(shader);

			if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
				throw new Error(gl.getShaderInfoLog(shader) ?? 'shader');
			}

			return shader;
		};
		const program = gl.createProgram()!;

		gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
		gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
		gl.linkProgram(program);

		if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
			throw new Error(gl.getProgramInfoLog(program) ?? 'link');
		}

		this.program = program;
		this.buffer = gl.createBuffer()!;
		this.tex = gl.createTexture()!;
		this.loc = {
			color: gl.getAttribLocation(program, 'a_color'),
			pos: gl.getAttribLocation(program, 'a_pos'),
			res: gl.getUniformLocation(program, 'u_res'),
			rot: gl.getAttribLocation(program, 'a_rot'),
			size: gl.getAttribLocation(program, 'a_size')
		};
		this.texture(undefined);
	}

	texture(img: HTMLImageElement | undefined): void {
		const gl = this.gl;

		gl.bindTexture(gl.TEXTURE_2D, this.tex);
		gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

		if (img) {
			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img);
		} else {
			// No sprite yet: a soft white dot, so an emitter is never invisible.
			const n = 32;
			const px = new Uint8Array(n * n * 4);

			for (let y = 0; y < n; y++) {
				for (let x = 0; x < n; x++) {
					const d = Math.hypot(x - n / 2 + 0.5, y - n / 2 + 0.5) / (n / 2);
					const a = Math.max(0, 1 - d) ** 2 * 255;
					const o = (y * n + x) * 4;

					px[o] = px[o + 1] = px[o + 2] = px[o + 3] = a;
				}
			}

			gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, n, n, 0, gl.RGBA, gl.UNSIGNED_BYTE, px);
		}

		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
	}

	draw(
		data: Float32Array,
		count: number,
		w: number,
		h: number,
		blend: EmitParams['blend']
	): void {
		const gl = this.gl;
		const stride = PARTICLE_STRIDE * 4;

		gl.viewport(0, 0, w, h);
		gl.clearColor(0, 0, 0, 0);
		gl.clear(gl.COLOR_BUFFER_BIT);

		if (count === 0) {
			return;
		}

		gl.useProgram(this.program);
		gl.uniform2f(this.loc.res, w, h);
		gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
		gl.bufferData(
			gl.ARRAY_BUFFER,
			data.subarray(0, count * PARTICLE_STRIDE),
			gl.DYNAMIC_DRAW
		);
		gl.enableVertexAttribArray(this.loc.pos);
		gl.vertexAttribPointer(this.loc.pos, 2, gl.FLOAT, false, stride, 0);
		gl.enableVertexAttribArray(this.loc.size);
		gl.vertexAttribPointer(this.loc.size, 1, gl.FLOAT, false, stride, 8);
		gl.enableVertexAttribArray(this.loc.rot);
		gl.vertexAttribPointer(this.loc.rot, 1, gl.FLOAT, false, stride, 12);
		gl.enableVertexAttribArray(this.loc.color);
		gl.vertexAttribPointer(this.loc.color, 4, gl.FLOAT, false, stride, 16);
		gl.bindTexture(gl.TEXTURE_2D, this.tex);
		gl.enable(gl.BLEND);
		// Premultiplied throughout: the texture is uploaded premultiplied, the colour is
		// premultiplied by `fill`, and the canvas composites premultiplied.
		gl.blendFunc(gl.ONE, blend === 'add' ? gl.ONE : gl.ONE_MINUS_SRC_ALPHA);
		gl.drawArrays(gl.POINTS, 0, count);
	}

	destroy(): void {
		this.gl.getExtension('WEBGL_lose_context')?.loseContext();
	}
}

/** No WebGL: plain drawImage. No tint — colour is the sprite's own. */
class CanvasPainter implements Painter {
	private img?: HTMLImageElement;

	constructor(private ctx: CanvasRenderingContext2D) {}

	texture(img: HTMLImageElement | undefined): void {
		this.img = img;
	}

	draw(
		data: Float32Array,
		count: number,
		w: number,
		h: number,
		blend: EmitParams['blend']
	): void {
		const ctx = this.ctx;

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.clearRect(0, 0, w, h);
		ctx.globalCompositeOperation = blend === 'add' ? 'lighter' : 'source-over';

		for (let i = 0; i < count; i++) {
			const o = i * PARTICLE_STRIDE;
			const size = data[o + 2];

			ctx.globalAlpha = data[o + 7];

			if (this.img) {
				ctx.setTransform(1, 0, 0, 1, data[o], data[o + 1]);
				ctx.rotate(data[o + 3]);
				ctx.drawImage(this.img, -size / 2, -size / 2, size, size);
			} else {
				ctx.setTransform(1, 0, 0, 1, 0, 0);
				ctx.fillStyle = '#fff';
				ctx.fillRect(data[o] - size / 4, data[o + 1] - size / 4, size / 2, size / 2);
			}
		}

		ctx.setTransform(1, 0, 0, 1, 0, 0);
		ctx.globalAlpha = 1;
	}

	destroy(): void {}
}

// ---------------------------------------------------------------------------
// One frame loop for every host
// ---------------------------------------------------------------------------

const live = new Set<ParticleHost>();
let frame: number | undefined;
let last: number | undefined;

function loop(now: number) {
	const dt = last === undefined ? 0 : (now - last) / 1000;

	last = now;

	for (const host of live) {
		host.frame(dt);
	}

	frame = live.size ? requestAnimationFrame(loop) : undefined;

	if (frame === undefined) {
		last = undefined;
	}
}

function start() {
	if (frame === undefined && typeof requestAnimationFrame === 'function') {
		frame = requestAnimationFrame(loop);
	}
}

/**
 * Inline, not in the renderer's stylesheet: the particle editor hosts one with no
 * renderer on the page. Box + PARTICLE_PAD each side.
 */
function place(el: HTMLCanvasElement): void {
	const pad = `${-PARTICLE_PAD * 100}%`;
	const span = `${(1 + PARTICLE_PAD * 2) * 100}%`;

	el.className = 'sliders-particles';
	el.setAttribute('aria-hidden', 'true');
	Object.assign(el.style, {
		height: span,
		left: pad,
		pointerEvents: 'none',
		position: 'absolute',
		top: pad,
		width: span
	});
}

export interface ParticleHostOptions {
	/** Emission point inside the box, fraction. Default bottom centre. */
	origin?: Frac2;
	/** Seed for the simulation. */
	seed?: number;
	/** Skip WebGL (tests, or a page that already holds too many contexts). */
	noGl?: boolean;
}

export class ParticleHost {
	/** Put this inside the element sized to the emitter box. */
	readonly el: HTMLCanvasElement;
	private painter?: Painter;
	private sim: ParticleSim;
	private params?: EmitParams;
	private url?: string;
	private img?: HTMLImageElement;
	private data?: Float32Array;
	private origin: Frac2;
	private warmed = false;

	constructor(
		private doc: Document,
		options: ParticleHostOptions = {}
	) {
		this.origin = options.origin ?? {x: 0.5, y: 1};
		this.sim = new ParticleSim(options.seed ?? 1);
		this.el = doc.createElement('canvas');
		place(this.el);
		this.painter = this.makePainter(!!options.noGl);
	}

	/** New numbers, sprite or origin. Particles in flight keep going. */
	set(params: EmitParams, url: string | undefined, origin?: Frac2): void {
		this.params = params;

		if (origin) {
			this.origin = origin;
		}

		if (!this.warmed) {
			this.warmed = true;
			this.sim.prewarm(params);
		}

		if (url !== this.url) {
			this.url = url;
			this.loadTexture(url);
		}

		live.add(this);
		start();
	}

	/** Start over from an empty field, prewarmed. */
	restart(): void {
		this.sim.clear();
		this.warmed = false;

		if (this.params) {
			this.set(this.params, this.url);
		}
	}

	get count(): number {
		return this.sim.count;
	}

	destroy(): void {
		live.delete(this);
		this.painter?.destroy();
		this.painter = undefined;
		this.el.remove();
	}

	/** One frame. Called by the shared loop. */
	frame(dt: number): void {
		const params = this.params;

		if (!params || !this.painter) {
			return;
		}

		this.sim.step(dt, params);

		// Not on the page (yet, or any more): simulate, draw nothing.
		if (!this.el.isConnected) {
			return;
		}

		const cssW = this.el.clientWidth;
		const cssH = this.el.clientHeight;

		if (cssW === 0 || cssH === 0) {
			return;
		}

		const dpr = (this.doc.defaultView?.devicePixelRatio ?? 1) || 1;
		const w = Math.round(cssW * dpr);
		const h = Math.round(cssH * dpr);

		if (this.el.width !== w || this.el.height !== h) {
			this.el.width = w;
			this.el.height = h;
		}

		// The canvas is the box plus PAD per side, so the box is its middle part.
		const span = 1 + PARTICLE_PAD * 2;
		const boxW = w / span;
		const boxH = h / span;
		const ox = boxW * (PARTICLE_PAD + this.origin.x);
		const oy = boxH * (PARTICLE_PAD + this.origin.y);

		this.data = this.sim.fill(params, boxW, ox, oy, this.data);
		this.painter.draw(this.data, this.sim.count, w, h, params.blend);
	}

	private makePainter(noGl: boolean): Painter | undefined {
		if (!noGl) {
			try {
				const gl = this.el.getContext('webgl', {
					alpha: true,
					premultipliedAlpha: true
				}) as WebGLRenderingContext | null;

				if (gl) {
					this.el.addEventListener('webglcontextlost', this.onLost);
					this.el.dataset.painter = 'webgl';

					return new GlPainter(gl);
				}
			} catch {
				// Fall through to 2D.
			}
		}

		const ctx = this.el.getContext('2d');

		if (ctx) {
			this.el.dataset.painter = '2d';

			return new CanvasPainter(ctx);
		}

		return undefined;
	}

	/**
	 * The browser took the context back — too many on the page. A canvas that held WebGL
	 * cannot become 2D, so the 2D painter goes on a fresh canvas in the same place.
	 */
	private onLost = (event: Event) => {
		event.preventDefault();

		if (!this.painter) {
			return;
		}

		const fresh = this.doc.createElement('canvas');

		place(fresh);

		const ctx = fresh.getContext('2d');

		this.el.replaceWith(fresh);
		(this as {el: HTMLCanvasElement}).el = fresh;
		this.painter = ctx ? new CanvasPainter(ctx) : undefined;
		fresh.dataset.painter = '2d';
		this.painter?.texture(this.img);
	};

	private loadTexture(url: string | undefined): void {
		if (!url) {
			this.img = undefined;
			this.painter?.texture(undefined);
			return;
		}

		const img = this.doc.createElement('img');

		img.decoding = 'async';
		img.onload = () => {
			if (this.url === url) {
				this.img = img;
				this.painter?.texture(img);
			}
		};
		img.src = url;
	}
}
