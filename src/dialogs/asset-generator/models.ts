/**
 * Which image models the generator knows how to talk to, and what each one needs.
 *
 * Every entry is reachable straight from the browser--both APIs allow cross-origin
 * calls with the key in a header or query string, so there is no server in the
 * middle and the key never leaves the machine except to its own provider.
 */

export type ProviderId = 'gemini' | 'openai';

/**
 * Which request shape the model wants. Gemini has two entirely different image
 * endpoints, and OpenAI's differ by whether reference images are attached, so the
 * transport is picked from the model rather than the provider.
 */
export type GeneratorApi = 'gemini-generate' | 'imagen-predict' | 'openai-image';

export interface GeneratorModel {
	api: GeneratorApi;
	/** Sends the aspect ratio as a real parameter rather than as prompt text. */
	aspectParam: boolean;
	/** Accepts attached assets as reference images. */
	imageInput: boolean;
	/** What the API calls the model. */
	id: string;
	label: string;
	note?: string;
	provider: ProviderId;
}

export interface Provider {
	id: ProviderId;
	/** Which preference holds this provider's key. */
	keyPref: 'geminiApiKey' | 'openAiApiKey';
	label: string;
	/** Where to go and get a key. */
	keyUrl: string;
}

export const providers: Provider[] = [
	{
		id: 'gemini',
		keyPref: 'geminiApiKey',
		keyUrl: 'https://aistudio.google.com/apikey',
		label: 'Google Gemini'
	},
	{
		id: 'openai',
		keyPref: 'openAiApiKey',
		keyUrl: 'https://platform.openai.com/api-keys',
		label: 'OpenAI'
	}
];

export function provider(id: ProviderId): Provider {
	return providers.find(candidate => candidate.id === id)!;
}

export const generatorModels: GeneratorModel[] = [
	{
		api: 'gemini-generate',
		aspectParam: true,
		id: 'gemini-2.5-flash-image',
		imageInput: true,
		label: 'Gemini 2.5 Flash Image (Nano Banana)',
		note: 'Edits and combines the images you attach. The best default here.',
		provider: 'gemini'
	},
	{
		api: 'gemini-generate',
		aspectParam: true,
		id: 'gemini-2.5-flash-image-preview',
		imageInput: true,
		label: 'Gemini 2.5 Flash Image Preview',
		provider: 'gemini'
	},
	{
		api: 'gemini-generate',
		aspectParam: false,
		id: 'gemini-2.0-flash-preview-image-generation',
		imageInput: true,
		label: 'Gemini 2.0 Flash Image Generation',
		provider: 'gemini'
	},
	{
		api: 'imagen-predict',
		aspectParam: true,
		id: 'imagen-4.0-generate-001',
		imageInput: false,
		label: 'Imagen 4',
		note: 'Text only--attachments are ignored.',
		provider: 'gemini'
	},
	{
		api: 'imagen-predict',
		aspectParam: true,
		id: 'imagen-4.0-ultra-generate-001',
		imageInput: false,
		label: 'Imagen 4 Ultra',
		provider: 'gemini'
	},
	{
		api: 'imagen-predict',
		aspectParam: true,
		id: 'imagen-4.0-fast-generate-001',
		imageInput: false,
		label: 'Imagen 4 Fast',
		provider: 'gemini'
	},
	{
		api: 'imagen-predict',
		aspectParam: true,
		id: 'imagen-3.0-generate-002',
		imageInput: false,
		label: 'Imagen 3',
		provider: 'gemini'
	},
	{
		api: 'openai-image',
		aspectParam: true,
		id: 'gpt-image-1',
		imageInput: true,
		label: 'GPT Image 1',
		note: 'Attachments are edited rather than merely described.',
		provider: 'openai'
	},
	{
		api: 'openai-image',
		aspectParam: true,
		id: 'gpt-image-1-mini',
		imageInput: true,
		label: 'GPT Image 1 Mini',
		provider: 'openai'
	},
	{
		api: 'openai-image',
		aspectParam: true,
		id: 'dall-e-3',
		imageInput: false,
		label: 'DALL·E 3',
		note: 'Text only--attachments are ignored.',
		provider: 'openai'
	}
];

/** Aspect ratios offered, in the order the selector lists them. */
export const aspectRatios = ['1:1', '16:9', '9:16', '4:3', '3:4'] as const;

export type AspectRatio = (typeof aspectRatios)[number];

/**
 * Models are stored in preferences as `provider:id` so that a custom model id typed
 * into the selector survives a reload without needing its own preference.
 */
export function modelKey(model: Pick<GeneratorModel, 'id' | 'provider'>): string {
	return `${model.provider}:${model.id}`;
}

/**
 * Resolves a stored key back to a model. A key naming something not in the list is a
 * custom model id, which is deliberately allowed: new image models appear faster than
 * this list can be updated, and the request shape is the same.
 */
export function modelFromKey(key: string): GeneratorModel | undefined {
	const known = generatorModels.find(model => modelKey(model) === key);

	if (known) {
		return known;
	}

	const divider = key.indexOf(':');

	if (divider === -1) {
		return undefined;
	}

	const providerId = key.slice(0, divider) as ProviderId;
	const id = key.slice(divider + 1);

	if (!id || !providers.some(candidate => candidate.id === providerId)) {
		return undefined;
	}

	return customModel(providerId, id);
}

/** A model the list has never heard of, guessed at from its id. */
export function customModel(
	providerId: ProviderId,
	id: string
): GeneratorModel {
	const imagen = providerId === 'gemini' && id.startsWith('imagen');

	return {
		api:
			providerId === 'openai'
				? 'openai-image'
				: imagen
				? 'imagen-predict'
				: 'gemini-generate',
		aspectParam: true,
		id,
		// Assuming attachments work is the kinder failure: the request errors with the
		// provider's own message rather than silently dropping what was attached.
		imageInput: !imagen && !id.startsWith('dall-e'),
		label: id,
		provider: providerId
	};
}
