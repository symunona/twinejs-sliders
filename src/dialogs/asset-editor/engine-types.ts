/**
 * The contract between the asset editor and whatever actually cuts backgrounds
 * out. Engines only ever produce a mask; upsampling, edge refinement and
 * compositing all live above them, so every engine gets the same quality work
 * for free and can be swapped without touching the editor.
 */

/** A soft mask, 0 to 1, at whatever resolution the engine reasons at. */
export interface BackgroundMask {
	data: Float32Array;
	width: number;
	height: number;
}

export interface EngineSupport {
	supported: boolean;
	/** Locale key explaining why not, for the UI to show. */
	reasonKey?: string;
}

export interface EngineProgress {
	stage: 'download' | 'start' | 'run' | 'refine';
	/** 0 to 1. Only meaningful while downloading. */
	progress?: number;
	/**
	 * Set on the second, closer look at the subject. The model runs twice on
	 * most images, and two identical status lines in a row read like a hang.
	 */
	pass?: number;
}

export interface MaskOptions {
	onProgress?: (progress: EngineProgress) => void;
	signal?: AbortSignal;
}

/** What an engine module has to export. */
export type MaskFunction = (
	source: HTMLCanvasElement,
	options?: MaskOptions
) => Promise<BackgroundMask>;

interface GpuAdapter {
	features?: {has(name: string): boolean};
	info?: {
		architecture?: string;
		description?: string;
		device?: string;
		vendor?: string;
	};
	limits?: Record<string, number>;
}

interface NavigatorGpu {
	gpu?: {requestAdapter(options?: unknown): Promise<GpuAdapter | null>};
}

let webGpuProbe: Promise<boolean> | undefined;
let adapterSummary: string | undefined;

/**
 * What the browser says it's about to run on, for error messages. Worth
 * printing: "WebGPU is present" and "WebGPU works" are different claims, and
 * when a cutout goes wrong this is the first thing anyone needs to know.
 */
export function webGpuDescription(): string | undefined {
	return adapterSummary;
}

/**
 * WebGPU is a hard requirement for the models worth running. There's no CPU
 * fallback on purpose: the wasm path can't allocate a 1024² transformer's
 * activations, so pretending otherwise would only produce a hang.
 *
 * Asking for an adapter rather than just looking for `navigator.gpu` is the
 * whole point. Plenty of browsers expose the object and then hand back no
 * adapter at all--headless Chromium, blocklisted drivers, a Linux box with no
 * Vulkan. Those have to end up disabled-and-explained, not enabled-then-broken.
 */
export function hasWebGpu(): Promise<boolean> {
	if (!webGpuProbe) {
		webGpuProbe = (async () => {
			const {gpu} = navigator as NavigatorGpu;

			if (!gpu) {
				return false;
			}

			try {
				const adapter = await gpu.requestAdapter({
					powerPreference: 'high-performance'
				});

				if (!adapter) {
					return false;
				}

				const {architecture, description, device, vendor} = adapter.info ?? {};

				adapterSummary =
					[vendor, architecture, device, description]
						.filter(Boolean)
						.join(' ')
						.trim() || 'an unnamed adapter';
				return true;
			} catch (error) {
				return false;
			}
		})();
	}

	return webGpuProbe;
}

/**
 * Raised when the model loaded but is plainly not running on the GPU.
 *
 * Having an adapter is not the same as ORT using it. When its WebGPU backend
 * can't take a graph it quietly runs the whole thing on the CPU instead, where
 * a 1024² segmentation model takes 40 to 90 seconds *per pass* -- so a cutout
 * that should take a second sits there for ten minutes and finishes eventually,
 * which is worse than failing.
 */
export class BackgroundOnCpuError extends Error {
	constructor(readonly seconds: number, readonly gpu?: string) {
		super(
			`The model took ${seconds}s for one pass, so it is running on the CPU, not ${
				gpu ?? 'the GPU'
			}.`
		);
		this.name = 'BackgroundOnCpuError';
	}
}

/**
 * Asks the browser to keep our storage rather than evict it under pressure.
 * The weights are 168 MB of best-effort storage otherwise, and re-downloading
 * them is the slowest thing this feature does.
 */
export async function keepStorage(): Promise<boolean> {
	try {
		return (await navigator.storage?.persist?.()) ?? false;
	} catch (error) {
		return false;
	}
}

/** Throws if the caller has given up on us. */
export function checkAborted(signal?: AbortSignal) {
	if (signal?.aborted) {
		throw new DOMException('Background removal was cancelled.', 'AbortError');
	}
}
