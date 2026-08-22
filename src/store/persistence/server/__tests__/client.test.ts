import {
	ServerError,
	apiBase,
	createServerClient,
	isServerError,
	outgoingStory
} from '../client';
import {testStory} from '../test-fixtures';

interface FakeInit {
	body?: unknown;
	headers?: Record<string, string>;
	method?: string;
}

function response(
	status: number,
	body: unknown,
	headers: Record<string, string> = {}
) {
	const lower = Object.fromEntries(
		Object.entries(headers).map(([key, value]) => [key.toLowerCase(), value])
	);

	return {
		headers: {get: (name: string) => lower[name.toLowerCase()] ?? null},
		json: async () => body,
		ok: status >= 200 && status < 300,
		status,
		statusText: '',
		blob: async () => body as Blob
	} as unknown as Response;
}

function clientWith(fetchImpl: jest.Mock) {
	return createServerClient({
		clientId: 'client-1',
		clientName: 'mira',
		fetch: fetchImpl as unknown as typeof fetch,
		token: 'sekrit',
		url: 'https://example.test/'
	});
}

describe('apiBase', () => {
	it('appends the api path once, whichever the author typed', () => {
		expect(apiBase('https://example.test')).toBe('https://example.test/api/v1');
		expect(apiBase('https://example.test/')).toBe(
			'https://example.test/api/v1'
		);
		expect(apiBase('https://example.test/api/v1')).toBe(
			'https://example.test/api/v1'
		);
	});
});

describe('identity headers', () => {
	it('rides on every request', async () => {
		const fetchImpl = jest.fn(async () => response(200, {ok: true}));

		await clientWith(fetchImpl).health();

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			FakeInit
		];

		expect(url).toBe('https://example.test/api/v1/health');
		expect(init.headers).toMatchObject({
			Authorization: 'Bearer sekrit',
			'X-Client-Id': 'client-1',
			'X-Client-Name': 'mira'
		});
	});
});

describe('stories', () => {
	it('strips sync and selected from anything it sends', () => {
		const sent = outgoingStory(testStory({selected: true, sync: true}));

		expect(sent).not.toHaveProperty('sync');
		expect(sent).not.toHaveProperty('selected');
		expect(sent.passages[0].story).toBe('story-1');
	});

	it('sends If-Match and the app version on a PUT', async () => {
		const fetchImpl = jest.fn(async () =>
			response(200, {bytes: 1, id: 'story-1', rev: 43, updatedAt: ''})
		);

		await clientWith(fetchImpl).putStory(testStory(), 42);

		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, FakeInit];
		const body = JSON.parse(init.body as string);

		expect(init.headers?.['If-Match']).toBe('"42"');
		expect(body.client).toBe('twine-sliders');
		expect(body.story.lastUpdate).toBe('2026-01-01T00:00:00.000Z');
		expect(body.story.sync).toBeUndefined();
	});

	it('revives with a query flag rather than a second endpoint', async () => {
		const fetchImpl = jest.fn(async () =>
			response(200, {bytes: 1, id: 'story-1', rev: 44, updatedAt: ''})
		);

		await clientWith(fetchImpl).reviveStory(testStory());

		const [url] = fetchImpl.mock.calls[0] as unknown as [string, FakeInit];

		expect(url).toBe('https://example.test/api/v1/stories/story-1?revive=1');
	});

	it('turns lastUpdate back into a Date on the way in', async () => {
		const fetchImpl = jest.fn(async () =>
			response(
				200,
				{...testStory(), lastUpdate: '2026-01-01T00:00:00.000Z'},
				{ETag: '"42"'}
			)
		);

		const result = await clientWith(fetchImpl).getStory('story-1');

		if (result === 'not-modified') {
			throw new Error('expected a story');
		}

		expect(result.rev).toBe(42);
		expect(result.story.lastUpdate).toBeInstanceOf(Date);
	});

	it('reports a 304 rather than throwing', async () => {
		const fetchImpl = jest.fn(async () => response(304, null));

		expect(await clientWith(fetchImpl).getStory('story-1', 42)).toBe(
			'not-modified'
		);

		const [, init] = fetchImpl.mock.calls[0] as unknown as [string, FakeInit];

		expect(init.headers?.['If-None-Match']).toBe('"42"');
	});
});

describe('error mapping', () => {
	it('carries rev and lastClient off a 412', async () => {
		const fetchImpl = jest.fn(async () =>
			response(412, {
				error: {code: 'conflict', message: 'stale'},
				lastClient: 'mira',
				rev: 43
			})
		);

		expect.assertions(4);

		try {
			await clientWith(fetchImpl).putStory(testStory(), 42);
		} catch (error) {
			expect(isServerError(error)).toBe(true);
			expect((error as ServerError).conflict).toBe(true);
			expect((error as ServerError).rev).toBe(43);
			expect((error as ServerError).lastClient).toBe('mira');
		}
	});

	it('treats a 409 deleted and a 404 alike as gone', async () => {
		const deleted = jest.fn(async () =>
			response(409, {error: {code: 'deleted', message: 'tombstone'}})
		);
		const missing = jest.fn(async () => response(404, {}));

		await expect(
			clientWith(deleted).putStory(testStory())
		).rejects.toMatchObject({gone: true});
		await expect(clientWith(missing).getStory('nope')).rejects.toMatchObject({
			gone: true
		});
	});

	it('marks a failed fetch retryable and everything the server chose not', async () => {
		const offline = jest.fn(async () => {
			throw new TypeError('Failed to fetch');
		});
		const refused = jest.fn(async () =>
			response(413, {error: {code: 'too_large', message: 'nope'}})
		);

		await expect(clientWith(offline).ping()).rejects.toMatchObject({
			network: true,
			retryable: true,
			status: 0
		});
		await expect(clientWith(refused).ping()).rejects.toMatchObject({
			code: 'too_large',
			retryable: false
		});
	});

	it('falls back to the status when the body is not JSON', async () => {
		const fetchImpl = jest.fn(async () => ({
			headers: {get: () => null},
			json: async () => {
				throw new SyntaxError('<html>');
			},
			ok: false,
			status: 502,
			statusText: 'Bad Gateway'
		}));

		await expect(
			clientWith(fetchImpl as unknown as jest.Mock).ping()
		).rejects.toMatchObject({code: 'internal', retryable: true, status: 502});
	});
});

describe('assets', () => {
	it('uploads with the hash the library already computed', async () => {
		const fetchImpl = jest.fn(async () => response(200, {}));
		const blob = new Blob(['bytes']);

		await clientWith(fetchImpl).putAssetBlob(
			'story-1',
			'a_8f21',
			blob,
			'hash-1',
			'image/webp'
		);

		const [url, init] = fetchImpl.mock.calls[0] as unknown as [
			string,
			FakeInit
		];

		expect(url).toBe(
			'https://example.test/api/v1/stories/story-1/assets/a_8f21'
		);
		expect(init.method).toBe('PUT');
		expect(init.headers).toMatchObject({
			'Content-Type': 'image/webp',
			'X-Asset-Hash': 'hash-1'
		});
		expect(init.body).toBe(blob);
	});

	it('fills in the three diff buckets even when the server omits them', async () => {
		const fetchImpl = jest.fn(async () => response(200, {missing: ['a_1']}));

		expect(
			await clientWith(fetchImpl).diffAssets('story-1', [
				{bytes: 1, hash: 'h', id: 'a_1'}
			])
		).toEqual({missing: ['a_1'], present: [], stale: []});
	});
});
