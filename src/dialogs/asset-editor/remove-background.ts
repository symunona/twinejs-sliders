import type {InferenceSession} from 'onnxruntime-web';
// Self-hosted so the runtime keeps working offline and inside Electron. Only
// the model itself comes from the network, once.
import ortWasmUrl from 'onnxruntime-web/ort-wasm-simd-threaded.wasm?url';
import {
	BACKGROUND_MODEL,
	BackgroundProgressHandler
} from './background-model';

/** What the model wants: 320×320, ImageNet normalization. */
const INPUT_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Cache Storage bucket, so the download only ever happens once. */
const MODEL_CACHE = 'sliders-models';

let session: Promise<InferenceSession> | undefined;

/** True once the model is cached, so the UI can drop its download warning. */
export async function backgroundModelReady(): Promise<boolean> {
	if (session) {
		return true;
	}

	try {
		const cache = await caches.open(MODEL_CACHE);

		return (await cache.match(BACKGROUND_MODEL.url)) !== undefined;
	} catch (error) {
		return false;
	}
}

async function fetchModel(
	onProgress?: BackgroundProgressHandler
): Promise<Uint8Array> {
	let cache: Cache | undefined;

	try {
		cache = await caches.open(MODEL_CACHE);
	} catch (error) {
		// Cache Storage needs a secure context. Without one the model is fetched
		// every time--slow, but still correct.
		console.warn('Could not open the model cache', error);
	}

	const cached = await cache?.match(BACKGROUND_MODEL.url);
	const response = cached ?? (await fetch(BACKGROUND_MODEL.url));

	if (!response.ok) {
		throw new Error(
			`Could not download the background model (${response.status}).`
		);
	}

	const total =
		Number(response.headers.get('content-length')) || BACKGROUND_MODEL.bytes;
	const reader = response.body?.getReader();
	let bytes: Uint8Array;

	if (reader) {
		const chunks: Uint8Array[] = [];
		let received = 0;

		for (;;) {
			const {done, value} = await reader.read();

			if (done || !value) {
				break;
			}

			chunks.push(value);
			received += value.length;
			onProgress?.({
				progress: Math.min(1, received / total),
				stage: 'download'
			});
		}

		bytes = new Uint8Array(received);

		let at = 0;

		for (const chunk of chunks) {
			bytes.set(chunk, at);
			at += chunk.length;
		}
	} else {
		bytes = new Uint8Array(await response.arrayBuffer());
	}

	if (!cached) {
		try {
			await cache?.put(BACKGROUND_MODEL.url, new Response(bytes));
		} catch (error) {
			console.warn('Could not cache the background model', error);
		}
	}

	return bytes;
}

async function loadSession(
	onProgress?: BackgroundProgressHandler
): Promise<InferenceSession> {
	if (!session) {
		session = (async () => {
			const ort = await import('onnxruntime-web/wasm');

			// Worker threads need cross-origin isolation, which Twine isn't served
			// with. One thread is slower, but works everywhere.
			ort.env.wasm.numThreads = 1;
			ort.env.wasm.wasmPaths = {wasm: ortWasmUrl};

			const bytes = await fetchModel(onProgress);

			onProgress?.({stage: 'start'});
			return await ort.InferenceSession.create(bytes, {
				executionProviders: ['wasm'],
				graphOptimizationLevel: 'all'
			});
		})();

		// A failed download must not poison every later attempt.
		session.catch(() => {
			session = undefined;
		});
	}

	return await session;
}

/** Scales the source down into the square the model expects. */
function inputTensorData(source: CanvasImageSource): Float32Array {
	const canvas = document.createElement('canvas');

	canvas.width = INPUT_SIZE;
	canvas.height = INPUT_SIZE;

	const context = canvas.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to read this image.');
	}

	// An already-transparent source would otherwise read as black, which the
	// model is happy to call foreground.
	context.fillStyle = '#fff';
	context.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);
	context.drawImage(source, 0, 0, INPUT_SIZE, INPUT_SIZE);

	const {data} = context.getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
	const pixels = INPUT_SIZE * INPUT_SIZE;
	const tensor = new Float32Array(3 * pixels);

	for (let index = 0; index < pixels; index++) {
		for (let channel = 0; channel < 3; channel++) {
			tensor[channel * pixels + index] =
				(data[index * 4 + channel] / 255 - MEAN[channel]) / STD[channel];
		}
	}

	return tensor;
}

/** Turns the model's saliency map into a mask canvas, white where the subject is. */
function maskCanvas(mask: Float32Array): HTMLCanvasElement {
	let low = Infinity;
	let high = -Infinity;

	for (const value of mask) {
		low = Math.min(low, value);
		high = Math.max(high, value);
	}

	const span = high - low || 1;
	const canvas = document.createElement('canvas');

	canvas.width = INPUT_SIZE;
	canvas.height = INPUT_SIZE;

	const context = canvas.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to build the mask.');
	}

	const image = context.createImageData(INPUT_SIZE, INPUT_SIZE);

	for (let index = 0; index < mask.length; index++) {
		image.data[index * 4] = 255;
		image.data[index * 4 + 1] = 255;
		image.data[index * 4 + 2] = 255;
		image.data[index * 4 + 3] = ((mask[index] - low) / span) * 255;
	}

	context.putImageData(image, 0, 0);
	return canvas;
}

/**
 * Cuts the background out of an image, start to finish on this machine.
 * Returns a new canvas--the source is left alone so the author can undo.
 */
export async function removeBackground(
	source: HTMLCanvasElement,
	onProgress?: BackgroundProgressHandler
): Promise<HTMLCanvasElement> {
	const ready = await loadSession(onProgress);

	onProgress?.({stage: 'run'});

	const ort = await import('onnxruntime-web/wasm');
	const input = new ort.Tensor('float32', inputTensorData(source), [
		1,
		3,
		INPUT_SIZE,
		INPUT_SIZE
	]);
	const output = await ready.run({[ready.inputNames[0]]: input});
	const mask = output[ready.outputNames[0]].data as Float32Array;
	const result = document.createElement('canvas');

	result.width = source.width;
	result.height = source.height;

	const context = result.getContext('2d');

	if (!context) {
		throw new Error('Could not get a 2D context to cut the background out.');
	}

	// The mask comes back 320×320 whatever the source was, so it's scaled back
	// up--the smoothing feathers the edges for free.
	context.drawImage(source, 0, 0);
	context.imageSmoothingQuality = 'high';
	context.globalCompositeOperation = 'destination-in';
	context.drawImage(maskCanvas(mask), 0, 0, result.width, result.height);
	context.globalCompositeOperation = 'source-over';

	return result;
}
