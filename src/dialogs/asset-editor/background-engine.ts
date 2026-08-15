import {maskBounds, refineMask, upsampleMask} from './alpha-refine';
import {
	BackgroundMask,
	checkAborted,
	EngineProgress,
	EngineSupport,
	hasWebGpu,
	webGpuIsSoftware,
	MaskFunction,
	MaskOptions
} from './engine-types';

/**
 * Picks an engine, runs it, and does everything that isn't the model: the
 * closer second pass, the edge refinement, and the compositing. Engines stay
 * dumb--hand back a mask--so swapping one out can't regress cutout quality.
 */

export interface EngineDescriptor {
	/** One-off model download, in bytes. */
	bytes: number;
	id: string;
	label: string;
	license: string;
	/** Longest edge the model reasons at, whatever it's fed. */
	resolution: number;
	load(): Promise<MaskFunction>;
	support(): Promise<EngineSupport>;
}

/** In preference order. The first supported one wins. */
const ENGINES: EngineDescriptor[] = [
	{
		// fp16 weights. GPUs without WebGPU's `shader-f16` feature fall back to
		// the fp32 export and pull 168 MB instead; see the engine module.
		bytes: 88117930,
		id: 'ormbg',
		label: 'Open Remove Background Model',
		// Genuinely open weights, unlike the RMBG-1.4 this replaced, which was
		// non-commercial under Bria's own agreement. BiRefNet Lite was the
		// intended model and still can't run on onnxruntime-web's WebGPU
		// backend--the engine module has the detail.
		license: 'Apache-2.0',
		load: async () => (await import('./engines/ormbg-engine')).mask,
		resolution: 1024,
		support: async () => {
			if (!(await hasWebGpu())) {
				return {reasonKey: 'dialogs.assetEditor.needsWebGpu', supported: false};
			}

			// A software adapter is WebGPU in name only--measured at 146 seconds
			// a pass against 0.65 on real hardware. Refuse up front rather than
			// let someone wait two and a half minutes to be told.
			return webGpuIsSoftware()
				? {reasonKey: 'dialogs.assetEditor.needsRealGpu', supported: false}
				: {supported: true};
		}
	}
];

export class BackgroundUnsupportedError extends Error {
	constructor(readonly reasonKey: string) {
		super(`Background removal is unavailable: ${reasonKey}`);
		this.name = 'BackgroundUnsupportedError';
	}
}

/**
 * Raised when a stage runs far past any plausible time.
 *
 * This is not paranoia. Having a WebGPU adapter is not the same as ORT
 * managing to use it: when the GPU backend fails to initialize, it silently
 * falls back to wasm and tries to run a 1024² model on the CPU, which doesn't
 * raise anything--it simply never finishes. Left alone, the UI sits on one
 * status line forever and the author has no idea whether to keep waiting.
 *
 * Rejecting does not stop the work underneath--nothing can interrupt a wasm
 * call in flight--but it does hand the author back a truthful answer and a
 * usable dialog.
 */
export class BackgroundTimeoutError extends Error {
	constructor(readonly stage: string, readonly seconds: number) {
		super(`Background removal gave up during "${stage}" after ${seconds}s.`);
		this.name = 'BackgroundTimeoutError';
	}
}

/**
 * Per-stage patience. Setting up the model is the slow one--a cold download
 * plus shader compilation--and it's also where a CPU fallback shows itself, so
 * it gets the longest leash and still has one.
 */
const STAGE_LIMITS: Record<EngineProgress['stage'], number> = {
	download: 300,
	refine: 60,
	run: 120,
	start: 180
};

/**
 * Fails the promise if a stage overstays its limit. The clock restarts on
 * every progress event, so slow-but-moving work is never cut off; only
 * genuinely stalled work is.
 */
export function withStageWatchdog<T>(
	work: (report: (stage: EngineProgress['stage']) => void) => Promise<T>
): Promise<T> {
	let timer: number | undefined;
	let settled = false;

	return new Promise<T>((resolve, reject) => {
		let stage: EngineProgress['stage'] = 'download';

		const arm = () => {
			window.clearTimeout(timer);
			timer = window.setTimeout(() => {
				if (!settled) {
					settled = true;
					reject(new BackgroundTimeoutError(stage, STAGE_LIMITS[stage]));
				}
			}, STAGE_LIMITS[stage] * 1000);
		};

		arm();
		work(next => {
			stage = next;
			arm();
		}).then(
			value => {
				if (!settled) {
					settled = true;
					resolve(value);
				}
			},
			error => {
				if (!settled) {
					settled = true;
					reject(error);
				}
			}
		);
	}).finally(() => window.clearTimeout(timer));
}

export interface BackgroundSupport {
	engine?: EngineDescriptor;
	support: EngineSupport;
}

/**
 * The engine this machine can run, if any. There is deliberately no CPU
 * fallback: the models worth running need a GPU, and a wasm path that takes
 * minutes or dies allocating is worse than an honest "not here".
 */
export async function backgroundSupport(): Promise<BackgroundSupport> {
	let first: EngineSupport | undefined;

	for (const engine of ENGINES) {
		const support = await engine.support();

		first ??= support;

		if (support.supported) {
			return {engine, support};
		}
	}

	return {
		support: first ?? {
			reasonKey: 'dialogs.assetEditor.needsWebGpu',
			supported: false
		}
	};
}

export interface RemoveBackgroundOptions extends MaskOptions {
	/**
	 * Run a second pass framed on the subject. Roughly doubles the time and
	 * buys real mask resolution when the subject doesn't fill the frame.
	 */
	detail?: boolean;
}

/** How much of the frame the subject may fill before a closer pass is pointless. */
const CLOSER_PASS_MAX_AREA = 0.6;
/** Below this it's noise, not a subject. */
const CLOSER_PASS_MIN_AREA = 0.01;

/**
 * Re-runs the model framed on the subject and pastes that mask over the coarse
 * one. A subject filling a third of the frame comes back about three times
 * denser, which no amount of upsampling could have given us.
 */
async function closerPass(
	source: HTMLCanvasElement,
	mask: MaskFunction,
	base: BackgroundMask,
	options: MaskOptions
): Promise<BackgroundMask | undefined> {
	const bounds = maskBounds(base);

	if (!bounds) {
		return undefined;
	}

	const area = (bounds.right - bounds.left) * (bounds.bottom - bounds.top);

	if (area > CLOSER_PASS_MAX_AREA || area < CLOSER_PASS_MIN_AREA) {
		return undefined;
	}

	const left = Math.floor(bounds.left * source.width);
	const top = Math.floor(bounds.top * source.height);
	const width = Math.max(1, Math.round((bounds.right - bounds.left) * source.width));
	const height = Math.max(
		1,
		Math.round((bounds.bottom - bounds.top) * source.height)
	);
	const crop = document.createElement('canvas');

	crop.width = width;
	crop.height = height;

	const context = crop.getContext('2d');

	if (!context) {
		return undefined;
	}

	context.drawImage(source, left, top, width, height, 0, 0, width, height);

	const closer = await mask(crop, options);
	const merged = upsampleMask(base, source.width, source.height);
	const inside = upsampleMask(closer, width, height);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			merged[(top + y) * source.width + left + x] = inside[y * width + x];
		}
	}

	return {data: merged, height: source.height, width: source.width};
}

/**
 * Fills transparent areas with mid grey before the model ever sees them.
 *
 * Canvas hands back black for a fully transparent pixel, and black is not a
 * neutral thing to show a segmenter: measured on a sprite whose legs are dark
 * navy, the mask over those legs came back at 0.003 against a transparent
 * background and 0.995 against grey. Same model, same image--the legs were
 * simply invisible against black. Grey is the least-committal filler; it costs
 * nothing on an image that has no transparency, because the fill is painted
 * over.
 */
function flattenTransparency(source: HTMLCanvasElement): HTMLCanvasElement {
	const flat = document.createElement('canvas');

	flat.width = source.width;
	flat.height = source.height;

	const context = flat.getContext('2d');

	if (!context) {
		return source;
	}

	context.fillStyle = '#808080';
	context.fillRect(0, 0, flat.width, flat.height);
	context.drawImage(source, 0, 0);
	return flat;
}

/** Multiplies the image's alpha by the mask, leaving what was already transparent alone. */
function composite(
	source: HTMLCanvasElement,
	alpha: Float32Array
): HTMLCanvasElement {
	const result = document.createElement('canvas');

	result.width = source.width;
	result.height = source.height;

	const context = result.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to cut the background out.');
	}

	context.drawImage(source, 0, 0);

	const image = context.getImageData(0, 0, result.width, result.height);

	for (let index = 0; index < alpha.length; index++) {
		image.data[index * 4 + 3] = image.data[index * 4 + 3] * alpha[index];
	}

	context.putImageData(image, 0, 0);
	return result;
}

/**
 * Cuts the background out, start to finish on this machine. Returns a new
 * canvas--the source is left alone so the author can undo.
 */
export async function removeBackground(
	source: HTMLCanvasElement,
	options: RemoveBackgroundOptions = {}
): Promise<HTMLCanvasElement> {
	const {engine, support} = await backgroundSupport();

	if (!engine) {
		throw new BackgroundUnsupportedError(
			support.reasonKey ?? 'dialogs.assetEditor.needsWebGpu'
		);
	}

	const {detail, onProgress, signal} = options;

	return await withStageWatchdog(report =>
		cutOut(source, engine, {detail, onProgress, report, signal})
	);
}

interface CutOutOptions extends RemoveBackgroundOptions {
	report: (stage: EngineProgress['stage']) => void;
}

async function cutOut(
	source: HTMLCanvasElement,
	engine: EngineDescriptor,
	options: CutOutOptions
): Promise<HTMLCanvasElement> {
	const {detail, report, signal} = options;
	// Every progress event both reaches the UI and resets the watchdog.
	const onProgress = (event: EngineProgress) => {
		report(event.stage);
		options.onProgress?.(event);
	};
	const run = await engine.load();
	// Everything the model and the edge refinement look at works on the
	// flattened copy; only the compositing touches the original, so whatever
	// was already transparent stays that way.
	const flat = flattenTransparency(source);
	const base = await run(flat, {onProgress, signal});

	checkAborted(signal);

	let mask = base;

	if (detail !== false) {
		// Same stages again, tagged as the second pass--otherwise the status
		// line repeats itself and looks stuck.
		const closer = await closerPass(flat, run, base, {
			onProgress: event => onProgress({...event, pass: 2}),
			signal
		});

		if (closer) {
			mask = closer;
		}
	}

	checkAborted(signal);
	onProgress({stage: 'refine'});

	// The refinement blocks the thread, so let the UI paint the stage change
	// before it starts.
	await new Promise(resolve => setTimeout(resolve, 0));

	return composite(source, refineMask(flat, mask));
}
