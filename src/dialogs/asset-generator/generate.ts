import {AspectRatio, GeneratorModel} from './models';

/**
 * Calls the image APIs directly from the browser. The key goes to Google or OpenAI
 * and nowhere else--there is no Twine server involved, which is the only reason it is
 * acceptable to keep a key in preferences at all.
 */

export interface GenerateRequest {
	aspect: AspectRatio | string;
	/** Reference images, already read out of the asset library. */
	attachments: {blob: Blob; name: string}[];
	key: string;
	model: GeneratorModel;
	prompt: string;
	signal?: AbortSignal;
}

export interface GeneratedImage {
	blob: Blob;
	/** Any commentary the model returned alongside the image. */
	text?: string;
}

/** Thrown for anything the provider itself refused, so the UI can quote it. */
export class GenerateError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'GenerateError';
	}
}

async function base64(blob: Blob): Promise<string> {
	const buffer = new Uint8Array(await blob.arrayBuffer());
	let binary = '';

	// String.fromCharCode has an argument limit, so this goes in chunks rather
	// than spreading a multi-megabyte array in one call.
	for (let at = 0; at < buffer.length; at += 0x8000) {
		binary += String.fromCharCode(...buffer.subarray(at, at + 0x8000));
	}

	return btoa(binary);
}

function blobFromBase64(data: string, mime: string): Blob {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);

	for (let at = 0; at < binary.length; at++) {
		bytes[at] = binary.charCodeAt(at);
	}

	return new Blob([bytes], {type: mime});
}

/** Digs the human-readable half out of whatever shape the error came back in. */
async function failureMessage(response: Response): Promise<string> {
	let body: any;

	try {
		body = await response.json();
	} catch {
		return `${response.status} ${response.statusText}`;
	}

	return (
		body?.error?.message ??
		body?.error?.status ??
		body?.message ??
		`${response.status} ${response.statusText}`
	);
}

/**
 * The size OpenAI wants for an aspect ratio. It only offers square, landscape and
 * portrait, so the wider ratios collapse onto the same two shapes.
 */
function openAiSize(aspect: string, model: GeneratorModel): string {
	const portrait = aspect === '9:16' || aspect === '3:4';
	const landscape = aspect === '16:9' || aspect === '4:3';

	if (model.id.startsWith('dall-e-3')) {
		if (portrait) {
			return '1024x1792';
		}

		return landscape ? '1792x1024' : '1024x1024';
	}

	if (portrait) {
		return '1024x1536';
	}

	return landscape ? '1536x1024' : '1024x1024';
}

/** Models without an aspect parameter get told in words instead. */
function promptWithAspect(request: GenerateRequest): string {
	if (request.model.aspectParam || request.aspect === '1:1') {
		return request.prompt;
	}

	return `${request.prompt}\n\nAspect ratio: ${request.aspect}.`;
}

async function generateWithGemini(
	request: GenerateRequest
): Promise<GeneratedImage> {
	const parts: any[] = [{text: promptWithAspect(request)}];

	for (const attachment of request.attachments) {
		parts.push({
			inline_data: {
				data: await base64(attachment.blob),
				mime_type: attachment.blob.type || 'image/png'
			}
		});
	}

	const generationConfig: any = {
		// Both image models reject a request that doesn't ask for IMAGE back, and the
		// 2.0 preview additionally insists TEXT be allowed.
		responseModalities: ['TEXT', 'IMAGE']
	};

	if (request.model.aspectParam) {
		generationConfig.imageConfig = {aspectRatio: request.aspect};
	}

	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
			request.model.id
		)}:generateContent`,
		{
			body: JSON.stringify({
				contents: [{parts, role: 'user'}],
				generationConfig
			}),
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': request.key
			},
			method: 'POST',
			signal: request.signal
		}
	);

	if (!response.ok) {
		throw new GenerateError(await failureMessage(response));
	}

	const body = await response.json();
	const returned: any[] = body?.candidates?.[0]?.content?.parts ?? [];
	const image = returned.find(part => part.inlineData ?? part.inline_data);
	const text = returned
		.map(part => part.text)
		.filter(Boolean)
		.join('\n');

	if (!image) {
		// A refusal comes back as a perfectly successful response with no image in
		// it, so the reason has to be dug out of the text or the block reason.
		throw new GenerateError(
			text ||
				body?.promptFeedback?.blockReason ||
				body?.candidates?.[0]?.finishReason ||
				'The model returned no image.'
		);
	}

	const inline = image.inlineData ?? image.inline_data;

	return {
		blob: blobFromBase64(
			inline.data,
			inline.mimeType ?? inline.mime_type ?? 'image/png'
		),
		text: text || undefined
	};
}

async function generateWithImagen(
	request: GenerateRequest
): Promise<GeneratedImage> {
	const response = await fetch(
		`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
			request.model.id
		)}:predict`,
		{
			body: JSON.stringify({
				instances: [{prompt: request.prompt}],
				parameters: {aspectRatio: request.aspect, sampleCount: 1}
			}),
			headers: {
				'Content-Type': 'application/json',
				'x-goog-api-key': request.key
			},
			method: 'POST',
			signal: request.signal
		}
	);

	if (!response.ok) {
		throw new GenerateError(await failureMessage(response));
	}

	const body = await response.json();
	const prediction = body?.predictions?.[0];

	if (!prediction?.bytesBase64Encoded) {
		throw new GenerateError(
			prediction?.raiFilteredReason ?? 'The model returned no image.'
		);
	}

	return {
		blob: blobFromBase64(
			prediction.bytesBase64Encoded,
			prediction.mimeType ?? 'image/png'
		)
	};
}

async function generateWithOpenAi(
	request: GenerateRequest
): Promise<GeneratedImage> {
	const size = openAiSize(request.aspect, request.model);
	const editing = request.model.imageInput && request.attachments.length > 0;
	let response: Response;

	if (editing) {
		// Attachments mean this is an edit, which is a different endpoint taking
		// multipart rather than JSON.
		const form = new FormData();

		form.set('model', request.model.id);
		form.set('prompt', request.prompt);
		form.set('size', size);
		form.set('n', '1');

		for (const attachment of request.attachments) {
			form.append(
				'image[]',
				new File([attachment.blob], `${attachment.name}.png`, {
					type: attachment.blob.type || 'image/png'
				})
			);
		}

		response = await fetch('https://api.openai.com/v1/images/edits', {
			body: form,
			headers: {Authorization: `Bearer ${request.key}`},
			method: 'POST',
			signal: request.signal
		});
	} else {
		const body: any = {
			model: request.model.id,
			n: 1,
			prompt: promptWithAspect(request),
			size
		};

		// GPT Image always answers with base64 and rejects the parameter; DALL·E
		// defaults to a URL that expires, and a URL can't be stored.
		if (request.model.id.startsWith('dall-e')) {
			body.response_format = 'b64_json';
		}

		response = await fetch('https://api.openai.com/v1/images/generations', {
			body: JSON.stringify(body),
			headers: {
				Authorization: `Bearer ${request.key}`,
				'Content-Type': 'application/json'
			},
			method: 'POST',
			signal: request.signal
		});
	}

	if (!response.ok) {
		throw new GenerateError(await failureMessage(response));
	}

	const body = await response.json();
	const image = body?.data?.[0];

	if (!image?.b64_json) {
		throw new GenerateError('The model returned no image.');
	}

	return {
		blob: blobFromBase64(
			image.b64_json,
			body?.output_format ? `image/${body.output_format}` : 'image/png'
		)
	};
}

export async function generateImage(
	request: GenerateRequest
): Promise<GeneratedImage> {
	if (!request.key.trim()) {
		throw new GenerateError('No API key is set for this provider.');
	}

	if (!request.prompt.trim()) {
		throw new GenerateError('Describe what to draw first.');
	}

	switch (request.model.api) {
		case 'gemini-generate':
			return generateWithGemini(request);

		case 'imagen-predict':
			return generateWithImagen(request);

		case 'openai-image':
			return generateWithOpenAi(request);
	}
}
