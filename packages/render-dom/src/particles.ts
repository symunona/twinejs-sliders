/**
 * Particle simulation. PURE: numbers in, numbers out, no DOM — the testable half, like
 * `effects.ts` is to `effect-host.ts`. `particle-host.ts` draws what this computes.
 *
 * Space is the emitter's own: x right, y DOWN, one unit = one emitter box width, (0, 0) =
 * the emission point (the asset's `origin`). So the same numbers draw the same effect at
 * any size, and an entity's `scale` is the only thing that makes a fire bigger.
 *
 * Seeded (mulberry32), so a test can step it and read exact positions.
 */

import type {EmitParams} from '@sliders/scene-types';

/** Hard cap. A slider at `rate: 400, life: 8` would ask for 3200. */
export const MAX_PARTICLES = 2000;

/** Longest step taken in one go. A tab that slept for a minute must not explode. */
const MAX_DT = 0.1;

/** Share of a particle's life spent fading IN, so nothing pops into existence. */
const FADE_IN = 0.08;

/** Floats per particle in `ParticleSim.fill`'s output: x, y, size, rot, r, g, b, a. */
export const PARTICLE_STRIDE = 8;

export function mulberry32(seed: number): () => number {
	let a = seed >>> 0;

	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;

		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

/** `#rrggbb` → [r, g, b] in 0..1. Anything else is white. */
export function hexRgb(hex: string): [number, number, number] {
	const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);

	return m
		? [parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255]
		: [1, 1, 1];
}

export class ParticleSim {
	count = 0;
	private cap = 0;
	private x = new Float32Array(0);
	private y = new Float32Array(0);
	private vx = new Float32Array(0);
	private vy = new Float32Array(0);
	private age = new Float32Array(0);
	private life = new Float32Array(0);
	private rot = new Float32Array(0);
	private spin = new Float32Array(0);
	/** Fractional particle owed from the last step, so a low rate still emits. */
	private owed = 0;
	private rand: () => number;

	constructor(seed = 1) {
		this.rand = mulberry32(seed);
	}

	/** Advance by `dt` seconds. Long gaps are taken in `MAX_DT` slices. */
	step(dt: number, p: EmitParams): void {
		let left = Math.max(0, dt);

		while (left > 0) {
			const slice = Math.min(left, MAX_DT);

			this.tick(slice, p);
			left -= slice;
		}
	}

	/** Run `seconds` of history at once, so an effect opens already burning. */
	prewarm(p: EmitParams, seconds = Math.min(p.life, 3)): void {
		this.step(seconds, p);
	}

	clear(): void {
		this.count = 0;
		this.owed = 0;
	}

	/**
	 * Pack every live particle for drawing: `PARTICLE_STRIDE` floats each, positions and
	 * size already in PIXELS (`unit` px per box width, `ox`/`oy` = the origin in px),
	 * colour premultiplied by alpha. `place.matrix` turns/mirrors the field about the
	 * origin, `place.alpha` fades all of it. Returns the array (reused when big enough).
	 */
	fill(
		p: EmitParams,
		unit: number,
		ox: number,
		oy: number,
		out?: Float32Array,
		place: {alpha?: number; matrix?: [number, number, number, number]} = {}
	): Float32Array {
		const need = this.count * PARTICLE_STRIDE;
		const buf = out && out.length >= need ? out : new Float32Array(Math.max(need, 64));
		const [r0, g0, b0] = hexRgb(p.color);
		const [r1, g1, b1] = hexRgb(p.colorEnd);
		const [ma, mb, mc, md] = place.matrix ?? [1, 0, 0, 1];
		const fade = place.alpha ?? 1;

		for (let i = 0; i < this.count; i++) {
			const t = Math.min(1, this.age[i] / this.life[i]);
			const fadeIn = Math.min(1, t / FADE_IN);
			const a = Math.max(0, fadeIn * (1 - p.fade * t)) * fade;
			const size = p.size * (1 + (p.grow - 1) * t) * unit;
			const o = i * PARTICLE_STRIDE;

			const x = this.x[i] * unit;
			const y = this.y[i] * unit;

			// Emitter space onto the surface: [a c; b d] times (x, y).
			buf[o] = ox + ma * x + mc * y;
			buf[o + 1] = oy + mb * x + md * y;
			buf[o + 2] = Math.max(0, size);
			buf[o + 3] = this.rot[i];
			buf[o + 4] = (r0 + (r1 - r0) * t) * a;
			buf[o + 5] = (g0 + (g1 - g0) * t) * a;
			buf[o + 6] = (b0 + (b1 - b0) * t) * a;
			buf[o + 7] = a;
		}

		return buf;
	}

	/** Positions in emitter units, for tests. */
	position(i: number): {x: number; y: number} {
		return {x: this.x[i], y: this.y[i]};
	}

	private grow(cap: number): void {
		const next = Math.min(MAX_PARTICLES, Math.max(cap, this.cap * 2, 32));

		if (next <= this.cap) {
			return;
		}

		const copy = (from: Float32Array) => {
			const to = new Float32Array(next);

			to.set(from.subarray(0, this.count));

			return to;
		};

		this.x = copy(this.x);
		this.y = copy(this.y);
		this.vx = copy(this.vx);
		this.vy = copy(this.vy);
		this.age = copy(this.age);
		this.life = copy(this.life);
		this.rot = copy(this.rot);
		this.spin = copy(this.spin);
		this.cap = next;
	}

	private tick(dt: number, p: EmitParams): void {
		// Age and move. Dead ones are swapped with the last, so the array stays packed.
		const spin = (p.spin * Math.PI) / 180;

		for (let i = 0; i < this.count; ) {
			this.age[i] += dt;

			if (this.age[i] >= this.life[i]) {
				this.count--;
				this.move(this.count, i);
				continue;
			}

			this.vy[i] += p.gravity * dt;
			this.x[i] += this.vx[i] * dt;
			this.y[i] += this.vy[i] * dt;
			this.rot[i] += this.spin[i] * spin * dt;
			i++;
		}

		// Spawn.
		this.owed += Math.max(0, p.rate) * dt;

		let born = Math.floor(this.owed);

		this.owed -= born;

		if (this.count + born > this.cap) {
			this.grow(this.count + born);
		}

		born = Math.min(born, this.cap - this.count);

		for (let n = 0; n < born; n++) {
			const i = this.count++;
			const r = p.area * Math.sqrt(this.rand());
			const around = this.rand() * Math.PI * 2;
			const dir = ((p.angle + (this.rand() - 0.5) * p.spread) * Math.PI) / 180;
			const speed = p.speed * (0.8 + this.rand() * 0.4);
			// Born spread over the step, so a burst of 10 in one frame is not one blob.
			const head = this.rand() * dt;

			this.life[i] = p.life * (0.75 + this.rand() * 0.5);
			this.vx[i] = Math.sin(dir) * speed;
			this.vy[i] = -Math.cos(dir) * speed;
			this.x[i] = Math.cos(around) * r + this.vx[i] * head;
			this.y[i] = Math.sin(around) * r + this.vy[i] * head;
			this.age[i] = head;
			// Upright unless it spins: a flame tongue has to point up.
			this.rot[i] = p.spin ? this.rand() * Math.PI * 2 : 0;
			// -1..1 per particle, times `spin`: some turn each way.
			this.spin[i] = this.rand() * 2 - 1;
		}
	}

	private move(from: number, to: number): void {
		this.x[to] = this.x[from];
		this.y[to] = this.y[from];
		this.vx[to] = this.vx[from];
		this.vy[to] = this.vy[from];
		this.age[to] = this.age[from];
		this.life[to] = this.life[from];
		this.rot[to] = this.rot[from];
		this.spin[to] = this.spin[from];
	}
}
