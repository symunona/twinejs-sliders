import {BackgroundMask, MaskOptions, checkAborted} from '../engine-types';

/**
 * A salient-object segmenter run through transformers.js on WebGPU. It reasons
 * at 1024x1024 and emits a single-channel map at that size, which is exactly
 * the `BackgroundMask` contract: no resizing, no compositing, no alpha work
 * here.
 *
 * The library is only ever pulled in by the dynamic import inside `load()`.
 * This module is small enough to sit in the main graph, but a megabyte of ONNX
 * runtime glue plus a ~90 MB weight download is not, so nothing may import
 * `@huggingface/transformers` at module scope.
 */

/**
 * BiRefNet_lite (`onnx-community/BiRefNet_lite-ONNX`, MIT) was the first
 * choice and is the better model, but it cannot run on onnxruntime-web's
 * WebGPU backend on every GPU: its widest `Concat` has more inputs than some
 * devices allow bindings for, and ORT's chunking is off by one -- it packs
 * `maxStorageBuffersPerShaderStage` inputs plus the output into a single
 * shader, so it always asks for one binding more than the device permits.
 * Measured on this repo's dev box (GTX 1050 Ti, Chrome 151/Dawn Vulkan, limit
 * 16): `Too many storage buffers in shader. Current: 17, Max is 16`. The same
 * run against an older Chromium with a limit of 10 asked for 11, which is what
 * pins the blame on ORT rather than the export.
 *
 * So this ships RMBG-1.4 instead, which is the same transformers.js code path
 * and runs cleanly here. NOTE THE LICENCE: RMBG-1.4 is *not* open weights.
 * It's under Bria's own agreement -- free for non-commercial use, paid for
 * commercial -- while BiRefNet_lite is MIT. If Twine is ever sold or bundled
 * commercially this has to change.
 *
 * Switching back to BiRefNet is these two constants plus the matching entry in
 * `background-engine.ts`; input and output tensor names are read off the
 * session, so nothing else in this file cares which model is loaded.
 */
const MODEL_ID = 'briaai/RMBG-1.4';

/**
 * RMBG-1.4's export ends in a sigmoid, so its output is already 0 to 1 --
 * measured min 0.000, max 0.99999 on a real photo. BiRefNet's export does
 * *not*: it returns logits and needs squashing, so flip this if you swap the
 * model back. Getting this wrong is the classic failure here; a mask that's
 * uniformly grey means logits went out unsquashed.
 */
const OUTPUT_IS_LOGITS = false;

/**
 * fp16 halves the download (88 MB against 176 MB) and the VRAM with no visible
 * difference in the mask, but it needs the WebGPU `shader-f16` feature, which
 * pre-Turing cards don't have -- a GTX 1050 Ti reports WebGPU fine and then
 * refuses fp16. So ask the adapter instead of guessing, and drop to the fp32
 * weights when it says no. WebGPU itself is not negotiable; see `hasWebGpu()`
 * in the engine contract for why there's no wasm fallback.
 */
async function pickDtype(): Promise<'fp16' | 'fp32'> {
	const gpu = (
		navigator as {
			gpu?: {
				requestAdapter: () => Promise<{features: Set<string>} | null>;
			};
		}
	).gpu;

	try {
		const adapter = await gpu?.requestAdapter();

		return adapter?.features.has('shader-f16') ? 'fp16' : 'fp32';
	} catch {
		return 'fp32';
	}
}

/** The subset of transformers.js progress events we actually act on. */
interface HubProgress {
	status: string;
	file?: string;
	progress?: number;
	loaded?: number;
	total?: number;
}

/** Just enough of a transformers.js tensor to read a mask out of it. */
interface OutputTensor {
	dims: number[];
	to: (type: string) => {data: ArrayLike<number>};
}

interface LoadedEngine {
	run: (pixelValues: unknown) => Promise<OutputTensor>;
	preprocess: (canvas: HTMLCanvasElement) => Promise<unknown>;
}

/**
 * Kept across calls so the second background removal skips the download and
 * the session build. Holds the in-flight promise rather than the result, so
 * overlapping calls share one load; it's cleared on failure so a retry can
 * start over.
 */
let engine: Promise<LoadedEngine> | null = null;

function clamp01(value: number) {
	return value < 0 ? 0 : value > 1 ? 1 : value;
}

async function load(options?: MaskOptions): Promise<LoadedEngine> {
	const {onProgress} = options ?? {};
	const {AutoModel, AutoProcessor, RawImage, env} =
		await import('@huggingface/transformers');

	// Weights are fetched from the Hugging Face CDN at runtime -- Twine ships
	// none of its own, so don't let the library probe our origin for them.
	env.allowLocalModels = false;
	env.allowRemoteModels = true;

	onProgress?.({stage: 'download', progress: 0});

	// Newer transformers.js emits a rolled-up `progress_total`; older releases
	// only report per file, so add those up ourselves as a fallback. Skip the
	// JSON configs while doing it: they're a few kilobytes each and they finish
	// first, so counting them would send the bar to 100% and back to 0% before
	// the weights have transferred a single byte.
	const WEIGHT_FILE_MIN_BYTES = 1_000_000;
	const files = new Map<string, {loaded: number; total: number}>();
	let sawTotal = false;

	const progress_callback = (info: HubProgress) => {
		switch (info.status) {
			case 'progress_total':
				sawTotal = true;
				onProgress?.({
					stage: 'download',
					progress: clamp01((info.progress ?? 0) / 100)
				});
				break;

			case 'progress': {
				if (sawTotal || (info.total ?? 0) < WEIGHT_FILE_MIN_BYTES) {
					break;
				}

				files.set(info.file ?? '', {
					loaded: info.loaded ?? 0,
					total: info.total ?? 0
				});

				let loaded = 0;
				let total = 0;

				files.forEach(file => {
					loaded += file.loaded;
					total += file.total;
				});

				if (total > 0) {
					onProgress?.({stage: 'download', progress: clamp01(loaded / total)});
				}
				break;
			}

			case 'done':
				// The weights are in hand; what's left is compiling shaders and
				// allocating buffers on the GPU, which is the 'start' stage.
				if (info.file?.endsWith('.onnx')) {
					onProgress?.({stage: 'start'});
				}
				break;
		}
	};

	const dtype = await pickDtype();
	const [model, processor] = await Promise.all([
		AutoModel.from_pretrained(MODEL_ID, {
			device: 'webgpu',
			dtype,
			progress_callback
		}),
		AutoProcessor.from_pretrained(MODEL_ID, {progress_callback})
	]);

	// These exports don't agree on names -- RMBG calls them `input`/`output`,
	// BiRefNet `input_image`/`output_image` -- and transformers.js feeds the
	// session by matching keys, so read the real names off the session rather
	// than hard-coding one model's spelling.
	const session = (
		model as unknown as {
			sessions?: {model?: {inputNames?: string[]; outputNames?: string[]}};
		}
	).sessions?.model;
	const inputName = session?.inputNames?.[0] ?? 'input';
	const outputName = session?.outputNames?.[0] ?? 'output';

	return {
		// The processor handles the 1024x1024 resize and whichever mean/std
		// normalization this model was trained with.
		preprocess: async canvas => {
			const {pixel_values} = await processor(RawImage.fromCanvas(canvas));

			return pixel_values;
		},
		run: async pixelValues => {
			const output = await model({[inputName]: pixelValues});
			// Some exports return the deep-supervision side outputs as an array;
			// the first one is always the full-resolution prediction.
			const tensor = Array.isArray(output[outputName])
				? output[outputName][0]
				: output[outputName];

			if (!tensor) {
				throw new Error(
					`${MODEL_ID} produced no "${outputName}" tensor; the ONNX export may have changed.`
				);
			}

			return tensor as OutputTensor;
		}
	};
}

export async function mask(
	source: HTMLCanvasElement,
	options?: MaskOptions
): Promise<BackgroundMask> {
	checkAborted(options?.signal);

	if (!engine) {
		engine = load(options).catch(error => {
			// Let the next attempt start from scratch -- a half-built session is
			// worse than none, and load failures here are usually transient
			// network ones.
			engine = null;
			throw error;
		});
	}

	const {preprocess, run} = await engine;

	checkAborted(options?.signal);
	options?.onProgress?.({stage: 'run'});

	const pixelValues = await preprocess(source);

	checkAborted(options?.signal);

	const tensor = await run(pixelValues);

	checkAborted(options?.signal);

	// Dims are [batch, channel, height, width] and both leading axes are 1.
	const {dims} = tensor;
	const width = dims[dims.length - 1];
	const height = dims[dims.length - 2];

	// fp16 weights can hand back a float16 tensor; `to` normalizes that.
	const raw = tensor.to('float32').data;
	const data = new Float32Array(width * height);

	for (let index = 0; index < data.length; index++) {
		data[index] = OUTPUT_IS_LOGITS
			? 1 / (1 + Math.exp(-raw[index]))
			: clamp01(raw[index]);
	}

	// 1 is foreground, which is what a salient-object head already predicts --
	// no inversion needed.
	return {data, width, height};
}
