import {generateImage, GenerateError} from '../generate';
import {modelFromKey} from '../models';

// jsdom's Blob has no arrayBuffer(), and encoding an attachment needs one.
if (!Blob.prototype.arrayBuffer) {
	Blob.prototype.arrayBuffer = function () {
		return Promise.resolve(new ArrayBuffer(0));
	};
}

function jsonResponse(body: unknown, ok = true): Response {
	return {
		json: () => Promise.resolve(body),
		ok,
		status: ok ? 200 : 400,
		statusText: ok ? 'OK' : 'Bad Request'
	} as Response;
}

/** One transparent pixel, base64 encoded, as a stand-in for a returned image. */
const PIXEL = 'iVBORw0KGgo=';

const gemini = modelFromKey('gemini:gemini-2.5-flash-image')!;
const imagen = modelFromKey('gemini:imagen-4.0-generate-001')!;
const openai = modelFromKey('openai:gpt-image-1')!;
const dalle = modelFromKey('openai:dall-e-3')!;

function request(overrides: Record<string, any> = {}) {
	return {
		aspect: '16:9',
		attachments: [],
		key: 'test-key',
		model: gemini,
		prompt: 'a tavern',
		...overrides
	} as any;
}

describe('generateImage()', () => {
	let fetchMock: jest.Mock;

	beforeEach(() => {
		fetchMock = jest.fn();
		(globalThis as any).fetch = fetchMock;
	});

	it('refuses to call anything without a key', async () => {
		await expect(generateImage(request({key: '  '}))).rejects.toThrow(
			GenerateError
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('refuses to call anything without a prompt', async () => {
		await expect(generateImage(request({prompt: ' '}))).rejects.toThrow(
			GenerateError
		);
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it('reads the image out of a Gemini response', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				candidates: [
					{
						content: {
							parts: [
								{text: 'here you go'},
								{inlineData: {data: PIXEL, mimeType: 'image/png'}}
							]
						}
					}
				]
			})
		);

		const result = await generateImage(request());
		const [url, init] = fetchMock.mock.calls[0];
		const body = JSON.parse(init.body);

		expect(url).toContain('gemini-2.5-flash-image:generateContent');
		expect(init.headers['x-goog-api-key']).toBe('test-key');
		expect(body.generationConfig.imageConfig.aspectRatio).toBe('16:9');
		expect(body.generationConfig.responseModalities).toContain('IMAGE');
		expect(result.blob.type).toBe('image/png');
		expect(result.text).toBe('here you go');
	});

	it('sends attachments as inline data', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				candidates: [
					{content: {parts: [{inlineData: {data: PIXEL, mimeType: 'image/png'}}]}}
				]
			})
		);

		await generateImage(
			request({
				attachments: [
					{blob: new Blob([], {type: 'image/webp'}), name: 'tavern'}
				]
			})
		);

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);

		expect(body.contents[0].parts).toHaveLength(2);
		expect(body.contents[0].parts[1].inline_data.mime_type).toBe('image/webp');
	});

	it('treats a Gemini response with no image as a failure, quoting its text', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				candidates: [{content: {parts: [{text: 'I cannot draw that.'}]}}]
			})
		);

		await expect(generateImage(request())).rejects.toThrow('I cannot draw that.');
	});

	it('quotes the provider message when the call fails', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({error: {message: 'API key not valid'}}, false)
		);

		await expect(generateImage(request())).rejects.toThrow('API key not valid');
	});

	it('uses the predict endpoint and aspect parameter for Imagen', async () => {
		fetchMock.mockResolvedValue(
			jsonResponse({
				predictions: [{bytesBase64Encoded: PIXEL, mimeType: 'image/png'}]
			})
		);

		await generateImage(request({aspect: '9:16', model: imagen}));

		const [url, init] = fetchMock.mock.calls[0];

		expect(url).toContain('imagen-4.0-generate-001:predict');
		expect(JSON.parse(init.body).parameters.aspectRatio).toBe('9:16');
	});

	it('posts JSON to OpenAI generations when nothing is attached', async () => {
		fetchMock.mockResolvedValue(jsonResponse({data: [{b64_json: PIXEL}]}));

		await generateImage(request({model: openai}));

		const [url, init] = fetchMock.mock.calls[0];

		expect(url).toBe('https://api.openai.com/v1/images/generations');
		expect(init.headers.Authorization).toBe('Bearer test-key');
		expect(JSON.parse(init.body).size).toBe('1536x1024');
	});

	it('posts multipart to OpenAI edits when something is attached', async () => {
		fetchMock.mockResolvedValue(jsonResponse({data: [{b64_json: PIXEL}]}));

		await generateImage(
			request({
				attachments: [{blob: new Blob([], {type: 'image/png'}), name: 'hero'}],
				model: openai
			})
		);

		const [url, init] = fetchMock.mock.calls[0];

		expect(url).toBe('https://api.openai.com/v1/images/edits');
		expect(init.body).toBeInstanceOf(FormData);
		expect((init.body as FormData).getAll('image[]')).toHaveLength(1);
	});

	it('asks DALL·E for base64, since its URLs expire', async () => {
		fetchMock.mockResolvedValue(jsonResponse({data: [{b64_json: PIXEL}]}));

		await generateImage(request({aspect: '9:16', model: dalle}));

		const body = JSON.parse(fetchMock.mock.calls[0][1].body);

		expect(body.response_format).toBe('b64_json');
		expect(body.size).toBe('1024x1792');
	});
});
