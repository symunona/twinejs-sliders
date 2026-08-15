import {
	BackgroundMask,
	BackgroundOnCpuError,
	MaskOptions,
	checkAborted,
	webGpuDescription
} from '../engine-types';

/**
 * How long one 1024² pass may take before we call it a CPU fallback. Measured
 * either side of the line: under a second on this repo's GTX 1050 Ti, 40 to 90
 * seconds on wasm. Nothing lands in between, so the threshold has room to be
 * generous--a weak integrated GPU is still an order of magnitude clear of it.
 */
const CPU_FALLBACK_SECONDS = 25;

/**
 * ORMBG ("open remove background model") run through onnxruntime-web on
 * WebGPU. It reasons at 1024x1024 and emits a single-channel map at that size,
 * which is exactly the `BackgroundMask` contract: no resizing, no compositing,
 * no alpha work here.
 *
 * The runtime is only ever pulled in by the dynamic import inside `load()`.
 * This module is small enough to sit in the main graph, but a megabyte of ONNX
 * runtime glue plus a ~168 MB weight download is not, so nothing may import
 * `onnxruntime-web` at module scope.
 *
 * WHY THIS MODEL. It replaces RMBG-1.4, which was the same ISNet architecture
 * at the same resolution but is *not* open weights -- Bria's own agreement,
 * free for non-commercial use only. ORMBG is Apache-2.0, declared by its
 * author on both the Hugging Face card and the upstream GitHub repo, and
 * scores the same on this repo's fixture. See `background-engine.ts` for the
 * licence string the UI shows.
 *
 * WHY NOT BIREFNET. BiRefNet_lite is the better model on paper and is tagged
 * MIT, but it cannot run on onnxruntime-web's WebGPU backend on any GPU today:
 * its widest `Concat` has 16 inputs, so ORT builds a shader binding 16 inputs
 * plus the output -- 17 storage buffers -- and WebGPU in Chrome caps
 * `maxStorageBuffersPerShaderStage` at 16 even on a discrete NVIDIA card.
 * Measured on this repo's dev box (GTX 1050 Ti, Chromium 151/Dawn Vulkan):
 * `The number of storage buffers (17) in the Compute stage exceeds the maximum
 * per-stage limit`. Its licence is also muddier than it looks: the MIT tag is
 * applied by the re-exporter, the upstream weights repo declares no licence at
 * all, and BiRefNet is trained on DIS5K, whose terms of use are
 * non-commercial.
 */

/**
 * Pinned to a commit rather than `main`. The weights are 168 MB and get cached
 * under this URL, so the key has to mean exactly one file forever: if the repo
 * ever re-exports, a `main` URL would quietly serve different weights to fresh
 * visitors than to everyone holding a cache entry, and the ceil_mode patch
 * below would be reasoning about a graph nobody had checked.
 */
const MODEL_COMMIT = '034e2d884afbab897e10e78fc5bb566b29533fd6';
const MODEL_BASE = `https://huggingface.co/onnx-community/ormbg-ONNX/resolve/${MODEL_COMMIT}/onnx/`;

/** The ONNX exports, in the two dtypes we're willing to run. */
const MODEL_URLS = {
	fp16: `${MODEL_BASE}model_fp16.onnx`,
	fp32: `${MODEL_BASE}model.onnx`
} as const;

/**
 * Where downloaded weights live between visits.
 *
 * They have to be cached by hand: Hugging Face answers the resolve URL with
 * `cache-control: no-store` and a *signed* CDN redirect whose URL changes on
 * every request, and the blob at the end of it carries no caching directives at
 * all. So the browser's HTTP cache never reuses it, and without this every
 * single page load re-downloads 168 MB before the first cutout can start.
 *
 * Cache Storage also survives a hard refresh, which the HTTP cache does not.
 */
const MODEL_CACHE = 'sliders-models';

/**
 * The ONNX runtime, fetched at run time instead of bundled.
 *
 * This is not squeamishness about bundle size, it's a hard constraint: ORT's
 * WebGPU build needs `ort-wasm-simd-threaded.jsep.wasm`, which is 25.6 MiB,
 * and Cloudflare Pages -- where this deploys -- rejects any single file over
 * 25 MiB. Importing the package normally makes Vite emit that binary into
 * `dist/web/assets`, which breaks the deploy. Since the wasm has to come off a
 * CDN either way, the glue JS may as well come from the same place: bundling
 * it would leave 26 MiB of dead weight in the build that nothing ever fetches.
 *
 * This is also not a new dependency in kind. transformers.js, which this
 * replaced, defaulted to fetching the very same binaries off jsdelivr, and the
 * weights have always been a runtime download.
 *
 * `onnxruntime-web` stays in devDependencies purely for these types. The
 * version here MUST match it: the API is read from one and the code from the
 * other.
 */
export const ORT_VERSION = '1.27.0';
const ORT_CDN = `https://cdn.jsdelivr.net/npm/onnxruntime-web@${ORT_VERSION}/dist/`;

type OrtModule = typeof import('onnxruntime-web');

/** What the model reasons at, and what the mask comes back as. */
const RESOLUTION = 1024;

/**
 * ORMBG's ONNX export ends in a sigmoid -- `ormbg.py`'s `forward()` returns
 * `F.sigmoid(d1)` and the exporter adds no activation -- so its output is
 * already 0 to 1. Measured min 0.000, max 1.000 on this repo's fixture.
 * BiRefNet's export does *not*, so if the model is ever swapped again, check
 * this first: a mask that's uniformly grey means logits went out unsquashed.
 *
 * The reference `inference.py` additionally min-max stretches the result. We
 * deliberately don't: the engine contract is a raw mask, and the values are
 * already saturated (0.996 over the subject, 0.001 over background), so
 * stretching would only amplify noise.
 */
const OUTPUT_IS_LOGITS = false;

/**
 * ORMBG normalizes by nothing but a rescale: `preprocess_image()` divides by
 * 255 and stops, and the published `preprocessor_config.json` agrees
 * (`do_normalize: false`, `do_rescale: true`). This is the one thing that
 * differs from the ImageNet mean/std that most of this model family wants --
 * get it wrong and the mask degrades quietly rather than failing.
 */
const RESCALE = 1 / 255;

/**
 * Both ORMBG exports declare `ceil_mode=1` on all 33 of their MaxPool nodes,
 * and neither of onnxruntime-web's WebGPU backends implements it: the session
 * builds and then the first run throws `using ceil() in shape computation is
 * not yet supported for MaxPool`. The wasm backend does implement it, but a
 * 1024x1024 ISNet on the CPU takes 40 to 90 seconds a pass, which is not a
 * feature anyone would use.
 *
 * At this model's input size the attribute cannot matter. Every pooled extent
 * is a power of two -- 1024, 512, 256, ... 4, 2 -- so every division by the
 * stride is exact and `ceil` and `floor` agree at every layer. So we flip the
 * attribute to 0 in the downloaded bytes and hand ORT a graph it can run.
 *
 * This is not a guess. Both variants were run end to end on the wasm backend,
 * which honours `ceil_mode` faithfully, and the outputs are identical: the
 * mask sums agree to the last printed digit (292546.297) and every sampled
 * value matches. The patched model on WebGPU then reproduces the same
 * per-region means as the unpatched model on wasm.
 *
 * The edit is length-preserving -- one varint byte, 1 to 0, inside a
 * fixed-shape AttributeProto -- so no protobuf lengths shift and the rest of
 * the file is untouched.
 */
function disableCeilMode(model: Uint8Array): number {
	// AttributeProto for `ceil_mode = 1`, as both exports serialize it:
	//   0a 09 "ceil_mode"   name, 9 bytes
	//   18 01               field 3 (i), varint 1   <-- the byte we flip
	//   a0 01 02            field 20 (type), INT
	const NAME = [0x63, 0x65, 0x69, 0x6c, 0x5f, 0x6d, 0x6f, 0x64, 0x65]; // 'ceil_mode'
	const SUFFIX = [0x18, 0x01, 0xa0, 0x01, 0x02];
	let patched = 0;

	for (let at = 0; at + NAME.length + SUFFIX.length <= model.length; at++) {
		let matches = model[at - 1] === NAME.length && model[at - 2] === 0x0a;

		for (let index = 0; matches && index < NAME.length; index++) {
			matches = model[at + index] === NAME[index];
		}

		for (let index = 0; matches && index < SUFFIX.length; index++) {
			matches = model[at + NAME.length + index] === SUFFIX[index];
		}

		if (matches) {
			// The `01` of the `18 01` pair -- ceil_mode true becomes false.
			model[at + NAME.length + 1] = 0x00;
			patched++;
		}
	}

	return patched;
}

/**
 * fp16 halves the download (84 MB against 168 MB) and the VRAM with no visible
 * difference in the mask, but it needs the WebGPU `shader-f16` feature, which
 * pre-Turing cards don't have -- a GTX 1050 Ti reports WebGPU fine and then
 * refuses fp16, and ORT's shaders fail to compile with `'f16' type used
 * without 'f16' extension enabled`. So ask the adapter instead of guessing,
 * and drop to the fp32 weights when it says no. WebGPU itself is not
 * negotiable; see `hasWebGpu()` in the engine contract for why there's no wasm
 * fallback.
 */
async function hasShaderF16(): Promise<boolean> {
	const gpu = (
		navigator as {
			gpu?: {
				requestAdapter: () => Promise<{features: Set<string>} | null>;
			};
		}
	).gpu;

	try {
		const adapter = await gpu?.requestAdapter();

		return adapter?.features.has('shader-f16') ?? false;
	} catch {
		return false;
	}
}

/** The weight cache, or undefined where Cache Storage isn't available. */
async function modelCache(): Promise<Cache | undefined> {
	try {
		return await caches.open(MODEL_CACHE);
	} catch (error) {
		// Cache Storage needs a secure context. Without one every visit
		// re-downloads, which is slow but still correct.
		console.warn('Could not open the model cache', error);
		return undefined;
	}
}

/**
 * The weights, from the cache if they're there and from the network if not.
 * What gets cached is the untouched download, keyed by the stable resolve URL
 * rather than the signed CDN one it redirects to.
 */
async function weights(
	url: string,
	options?: MaskOptions
): Promise<Uint8Array> {
	const cache = await modelCache();
	const hit = await cache?.match(url);

	if (hit) {
		options?.onProgress?.({stage: 'download', progress: 1});
		return new Uint8Array(await hit.arrayBuffer());
	}

	const model = await download(url, options);

	try {
		await cache?.put(url, new Response(model));
	} catch (error) {
		// Out of quota, most likely. Not a reason to fail the cutout--it just
		// means the next visit pays for the download again.
		console.warn('Could not cache the background removal model', error);
	}

	return model;
}

/** Downloads the weights, reporting progress as they arrive. */
async function download(
	url: string,
	options?: MaskOptions
): Promise<Uint8Array> {
	const response = await fetch(url, {signal: options?.signal});

	if (!response.ok || !response.body) {
		throw new Error(
			`Could not download the background removal model (${response.status}).`
		);
	}

	// `Content-Length` is the compressed length if the CDN is encoding, but
	// these are already-compressed weights served verbatim, so it's the real
	// total. Fall back to an indeterminate bar if it's missing rather than
	// reporting a nonsense percentage.
	const total = Number(response.headers.get('Content-Length') ?? 0);
	const reader = response.body.getReader();
	const chunks: Uint8Array[] = [];
	let loaded = 0;

	for (;;) {
		const {done, value} = await reader.read();

		if (done) {
			break;
		}

		chunks.push(value);
		loaded += value.length;

		if (total > 0) {
			options?.onProgress?.({stage: 'download', progress: loaded / total});
		}
	}

	const model = new Uint8Array(loaded);
	let at = 0;

	for (const chunk of chunks) {
		model.set(chunk, at);
		at += chunk.length;
	}

	return model;
}

/** Just enough of an ORT session to run one image through. */
interface LoadedEngine {
	inputName: string;
	outputName: string;
	run: (input: Float32Array) => Promise<{data: ArrayLike<number>; dims: readonly number[]}>;
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
	// `ort.bundle.min.mjs` is the package's default entry, and the build that
	// carries the WebGPU execution provider: it loads
	// `ort-wasm-simd-threaded.jsep.wasm`, which is where ORT's native WebGPU EP
	// lives. (`ort.webgpu.bundle.min.mjs`, despite the name, is a different
	// asyncify-based build, and `ort.all` drags in WebGL and training we have
	// no use for.) The `@vite-ignore` keeps the bundler from trying to resolve
	// and inline a URL that is deliberately remote.
	const ort: OrtModule = await import(
		/* @vite-ignore */ `${ORT_CDN}ort.bundle.min.mjs`
	);

	// The bundle would derive this from its own `import.meta.url` anyway, but
	// say it out loud so a future move off the CDN can't half-happen.
	ort.env.wasm.wasmPaths = ORT_CDN;
	// The GPU does the work; ORT's CPU pool would only cost us a
	// cross-origin-isolation requirement we can't meet on Pages, because
	// SharedArrayBuffer needs COOP/COEP headers this app doesn't send.
	ort.env.wasm.numThreads = 1;
	// Run the session in a worker.
	//
	// Building a session is synchronous wasm work, and on the main thread it
	// blocks everything: no repaint, no timers, so the elapsed clock freezes,
	// Cancel stops responding and the watchdog can't fire--the tab just looks
	// dead. That is exactly how this fails on a machine where the GPU backend
	// isn't really available and ORT drops to the CPU. Measured with a 100ms
	// heartbeat across a build-plus-inference: 25 of 26 expected ticks still
	// arrived, and the timings were unchanged.
	ort.env.wasm.proxy = true;

	onProgress?.({stage: 'download', progress: 0});

	const dtype = (await hasShaderF16()) ? 'fp16' : 'fp32';
	const build = async (which: 'fp16' | 'fp32') => {
		const model = await weights(MODEL_URLS[which], options);

		checkAborted(options?.signal);

		// Both published exports carry exactly 33 of these. If a re-export ever
		// changes that, say so here rather than letting ORT fail several seconds
		// later with a shape-inference error that names nothing useful.
		if (disableCeilMode(model) === 0) {
			throw new Error(
				'The ORMBG export no longer declares ceil_mode on its MaxPool nodes; ' +
					'check whether the WebGPU backend still needs the patch before removing it.'
			);
		}

		// The weights are in hand; what's left is compiling shaders and
		// allocating buffers on the GPU, which is the 'start' stage.
		onProgress?.({stage: 'start'});

		return ort.InferenceSession.create(model, {
			executionProviders: ['webgpu'],
			graphOptimizationLevel: 'all'
		});
	};

	let session: Awaited<ReturnType<typeof build>>;

	try {
		session = await build(dtype);
	} catch (error) {
		if (dtype === 'fp32') {
			throw error;
		}

		// An adapter can advertise `shader-f16` and still fail to build the
		// session; the fp32 export is the same model and always compiles, so
		// take the bigger download over no background removal at all.
		session = await build('fp32');
	}

	// Read the tensor names off the session rather than hard-coding this
	// export's spelling: onnx-community's ORMBG calls them
	// `pixel_values`/`alphas`, while the author's own export uses
	// `input`/`output` plus ten deep-supervision side outputs.
	const inputName = session.inputNames[0];
	const outputName = session.outputNames[0];

	// One throwaway pass, to find out whether we actually got the GPU.
	//
	// ORT gives no way to ask which execution provider ended up running the
	// graph, and when its WebGPU backend can't take one it falls back to the
	// CPU silently. The difference is not subtle -- under a second against a
	// minute and a half -- so timing it is a reliable test, and it costs
	// nothing: this is the pass that compiles the pipelines, which the first
	// real cutout would otherwise have paid for.
	const warmedAt = performance.now();

	await session.run({
		[inputName]: new ort.Tensor(
			'float32',
			new Float32Array(3 * RESOLUTION * RESOLUTION),
			[1, 3, RESOLUTION, RESOLUTION]
		)
	});

	const warmSeconds = Math.round((performance.now() - warmedAt) / 1000);

	if (warmSeconds > CPU_FALLBACK_SECONDS) {
		throw new BackgroundOnCpuError(warmSeconds, webGpuDescription());
	}

	return {
		inputName,
		outputName,
		run: async input => {
			const feeds = {
				[inputName]: new ort.Tensor('float32', input, [1, 3, RESOLUTION, RESOLUTION])
			};
			const output = (await session.run(feeds))[outputName];

			if (!output) {
				throw new Error(
					`ORMBG produced no "${outputName}" tensor; the ONNX export may have changed.`
				);
			}

			return output as unknown as {
				data: ArrayLike<number>;
				dims: readonly number[];
			};
		}
	};
}

/**
 * Resizes to the model's square input and rescales to 0 to 1, planar RGB.
 * Squashing a non-square image to a square is what this model family was
 * trained on, so it's not a bug -- the caller maps the mask back.
 */
function preprocess(source: HTMLCanvasElement): Float32Array {
	const square = document.createElement('canvas');

	square.width = RESOLUTION;
	square.height = RESOLUTION;

	const context = square.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to prepare the image.');
	}

	context.drawImage(source, 0, 0, RESOLUTION, RESOLUTION);

	const {data} = context.getImageData(0, 0, RESOLUTION, RESOLUTION);
	const plane = RESOLUTION * RESOLUTION;
	const input = new Float32Array(3 * plane);

	for (let pixel = 0; pixel < plane; pixel++) {
		input[pixel] = data[pixel * 4] * RESCALE;
		input[plane + pixel] = data[pixel * 4 + 1] * RESCALE;
		input[2 * plane + pixel] = data[pixel * 4 + 2] * RESCALE;
	}

	return input;
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

	const {run} = await engine;

	checkAborted(options?.signal);
	options?.onProgress?.({stage: 'run'});

	const input = preprocess(source);

	checkAborted(options?.signal);

	const tensor = await run(input);

	checkAborted(options?.signal);

	// Dims are [batch, channel, height, width] and both leading axes are 1.
	const {dims} = tensor;
	const width = dims[dims.length - 1];
	const height = dims[dims.length - 2];
	const raw = tensor.data;
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
