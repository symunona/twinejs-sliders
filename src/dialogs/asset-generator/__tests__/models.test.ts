import {
	customModel,
	generatorModels,
	modelFromKey,
	modelKey,
	providers
} from '../models';

describe('the generator model list', () => {
	it('gives every model a provider that exists', () => {
		const ids = providers.map(entry => entry.id);

		for (const model of generatorModels) {
			expect(ids).toContain(model.provider);
		}
	});

	it('has no duplicate keys', () => {
		const keys = generatorModels.map(modelKey);

		expect(new Set(keys).size).toBe(keys.length);
	});
});

describe('modelFromKey()', () => {
	it('resolves a listed model', () => {
		const model = modelFromKey('gemini:gemini-2.5-flash-image');

		expect(model?.id).toBe('gemini-2.5-flash-image');
		expect(model?.api).toBe('gemini-generate');
	});

	it('accepts a model id the list has never heard of', () => {
		const model = modelFromKey('openai:gpt-image-9');

		expect(model?.id).toBe('gpt-image-9');
		expect(model?.provider).toBe('openai');
		expect(model?.api).toBe('openai-image');
	});

	it('routes an unknown imagen id to the predict endpoint', () => {
		expect(modelFromKey('gemini:imagen-9.0-generate-001')?.api).toBe(
			'imagen-predict'
		);
	});

	it('rejects a key with no provider or no id', () => {
		expect(modelFromKey('')).toBeUndefined();
		expect(modelFromKey('gemini')).toBeUndefined();
		expect(modelFromKey('gemini:')).toBeUndefined();
		expect(modelFromKey('midjourney:v7')).toBeUndefined();
	});

	it('round-trips a key', () => {
		for (const model of generatorModels) {
			expect(modelFromKey(modelKey(model))).toEqual(model);
		}
	});
});

describe('customModel()', () => {
	it('assumes attachments work unless the id says otherwise', () => {
		expect(customModel('openai', 'gpt-image-2').imageInput).toBe(true);
		expect(customModel('openai', 'dall-e-4').imageInput).toBe(false);
		expect(customModel('gemini', 'imagen-5.0-generate-001').imageInput).toBe(
			false
		);
	});
});
