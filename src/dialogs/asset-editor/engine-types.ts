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
	/**
	 * 0 to 1. Real while downloading, where the byte count is known. On the CPU
	 * backend the run stage reports one too, but it is a clock against a
	 * remembered pass time rather than anything the runtime told us -- see
	 * `estimated`.
	 */
	progress?: number;
	/**
	 * Set when `progress` is a guess from elapsed time, so the UI can say so
	 * rather than implying the model is counting its own work.
	 */
	estimated?: boolean;
	/**
	 * Set on the second, closer look at the subject. The model runs twice on
	 * most images, and two identical status lines in a row read like a hang.
	 */
	pass?: number;
}

/**
 * Which execution provider an engine should ask onnxruntime-web for.
 *
 * `webgpu` is the one anybody wants; `wasm` is the fallback for machines
 * without a usable GPU, where the same model produces the same mask about a
 * hundred times more slowly. They are separate sessions, so a machine that has
 * both can hold both without either reloading the other.
 */
export type MaskBackend = 'webgpu' | 'wasm';

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
let adapterIsSoftware = false;

/**
 * Adapters that are really a CPU renderer wearing a GPU's clothes.
 *
 * A browser with hardware acceleration off, or a blocklisted driver, still
 * hands out a perfectly valid WebGPU adapter -- Chrome's is SwiftShader, and
 * Mesa's are lavapipe and llvmpipe. Everything works, just a hundred times too
 * slowly: measured on this repo's own model, 146 seconds for a pass that takes
 * 0.65 on real hardware. Letting that start is worse than refusing it, because
 * the author waits two and a half minutes to be told it didn't work.
 */
const SOFTWARE_ADAPTERS = /swiftshader|lavapipe|llvmpipe|软件|software|warp|basic render/i;

/** Whether an adapter's reported name is one of the CPU renderers. */
export function isSoftwareAdapter(name: string): boolean {
	return SOFTWARE_ADAPTERS.test(name);
}

/** True when WebGPU exists but is being emulated on the CPU. */
export function webGpuIsSoftware(): boolean {
	return adapterIsSoftware;
}

/**
 * What the browser says it's about to run on, for error messages. Worth
 * printing: "WebGPU is present" and "WebGPU works" are different claims, and
 * when a cutout goes wrong this is the first thing anyone needs to know.
 */
export function webGpuDescription(): string | undefined {
	return adapterSummary;
}

/**
 * WebGPU is what the models worth running want. The wasm fallback below exists
 * and is honest about itself, but it is one to two minutes a pass against well
 * under a second here, so this is always asked first.
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
				// Deliberately a name match and nothing cleverer. Guessing from
				// limits would be wrong in the expensive direction: a real GTX 1050
				// Ti reports no `shader-f16` and only 10 storage buffers under an
				// older Chromium, which is indistinguishable from SwiftShader's
				// numbers. Refusing a working GPU is worse than the timing check
				// below catching a slow one late.
				adapterIsSoftware = isSoftwareAdapter(adapterSummary);
				return true;
			} catch (error) {
				return false;
			}
		})();
	}

	return webGpuProbe;
}

/**
 * Whether the CPU fallback can run at all.
 *
 * onnxruntime-web's wasm backend needs WebAssembly itself and, to fetch the
 * runtime, `fetch`. Both are present everywhere this app runs, so this is
 * really a guard for jsdom and for browsers where a policy has switched wasm
 * off -- but "the button is disabled and won't say why" is the failure this
 * feature already has too much of.
 */
export function hasWasm(): boolean {
	return typeof WebAssembly === 'object' && typeof fetch === 'function';
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
