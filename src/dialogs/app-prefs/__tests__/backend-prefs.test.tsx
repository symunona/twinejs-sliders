import {fireEvent, render, screen, waitFor} from '@testing-library/react';
import {axe} from 'jest-axe';
import * as React from 'react';
import {
	FakeStateProvider,
	FakeStateProviderProps,
	PrefInspector
} from '../../../test-util';
import {
	BackendPrefs,
	defaultBackendUsername,
	isMixedContent,
	trimBackendUrl
} from '../backend-prefs';

function jsonResponse(body: unknown, status = 200): Response {
	return {
		json: () => Promise.resolve(body),
		ok: status >= 200 && status < 300,
		status
	} as Response;
}

const health = {apiVersion: 1, ok: true, service: 'twine-sliders-server'};

const ping = {
	apiVersion: 1,
	bytesUsed: 48 * 1024 * 1024,
	clients: [
		{id: 'mine', name: 'me'},
		{id: 'theirs', name: 'mira'}
	],
	events: true,
	keepRevisions: 20,
	maxAssetBytes: 0,
	maxStoryBytes: 0,
	ok: true,
	storyCount: 3,
	time: '',
	version: '1.2.3'
};

describe('<BackendPrefs>', () => {
	let fetchMock: jest.Mock;

	function renderComponent(prefs?: FakeStateProviderProps['prefs']) {
		return render(
			<FakeStateProvider
				prefs={{
					backendClientId: 'mine',
					backendToken: 'sekrit',
					backendUrl: 'https://example.com',
					backendUsername: 'me',
					...prefs
				}}
			>
				<div className="app-prefs-dialog">
					<BackendPrefs />
				</div>
				<PrefInspector name="backendAutosave" />
				<PrefInspector name="backendToken" />
				<PrefInspector name="backendUrl" />
				<PrefInspector name="backendUsername" />
			</FakeStateProvider>
		);
	}

	beforeEach(() => {
		fetchMock = jest.fn();
		(globalThis as any).fetch = fetchMock;
	});

	it('edits the username preference', () => {
		renderComponent();
		fireEvent.change(screen.getByTestId('backend-username'), {
			target: {value: 'mira'}
		});
		expect(
			screen.getByTestId('pref-inspector-backendUsername')
		).toHaveTextContent('mira');
	});

	it('offers the generated default username as a placeholder', () => {
		renderComponent({backendClientId: 'abcdef', backendUsername: ''});
		expect(screen.getByTestId('backend-username')).toHaveAttribute(
			'placeholder',
			'user-abcd'
		);
	});

	it('trims trailing slashes from the server address', () => {
		renderComponent();
		fireEvent.change(screen.getByTestId('backend-url'), {
			target: {value: 'https://example.com/'}
		});
		expect(screen.getByTestId('pref-inspector-backendUrl')).toHaveTextContent(
			'https://example.com'
		);
	});

	it('hides the token until it is revealed', () => {
		renderComponent();
		expect(screen.getByTestId('backend-token')).toHaveAttribute(
			'type',
			'password'
		);
		fireEvent.click(screen.getByTestId('backend-token-reveal'));
		expect(screen.getByTestId('backend-token')).toHaveAttribute('type', 'text');
	});

	it('toggles the autosave preference', () => {
		renderComponent({backendAutosave: false});
		fireEvent.click(screen.getByTestId('backend-autosave'));
		expect(
			screen.getByTestId('pref-inspector-backendAutosave')
		).toHaveTextContent('true');
	});

	it('does not warn about mixed content when the page is not secure', () => {
		renderComponent({backendUrl: 'http://example.com'});
		expect(
			screen.queryByTestId('backend-mixed-content-warning')
		).not.toBeInTheDocument();
	});

	describe('the Test button', () => {
		it('reports an unreachable server', async () => {
			fetchMock.mockRejectedValue(new Error('nope'));
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));
			expect(
				await screen.findByTestId('backend-test-result')
			).toHaveTextContent('dialogs.appPrefs.backendTestUnreachable');
			expect(fetchMock.mock.calls[0][0]).toBe(
				'https://example.com/api/v1/health'
			);
		});

		it('reports an unreachable server when health is not ok', async () => {
			fetchMock.mockResolvedValue(jsonResponse({}, 502));
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));
			expect(
				await screen.findByTestId('backend-test-result')
			).toHaveTextContent('dialogs.appPrefs.backendTestUnreachable');
		});

		it('reports a rejected token when health is ok but ping is 401', async () => {
			fetchMock
				.mockResolvedValueOnce(jsonResponse(health))
				.mockResolvedValueOnce(
					jsonResponse({error: {code: 'unauthorized', message: 'no'}}, 401)
				);
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));
			expect(
				await screen.findByTestId('backend-test-result')
			).toHaveTextContent('dialogs.appPrefs.backendTestUnauthorized');
		});

		it('reports the server and who else is connected when both succeed', async () => {
			fetchMock
				.mockResolvedValueOnce(jsonResponse(health))
				.mockResolvedValueOnce(jsonResponse(ping));
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));

			const result = await screen.findByTestId('backend-test-result');

			expect(result).toHaveTextContent('dialogs.appPrefs.backendTestConnected');
			expect(result).toHaveTextContent('dialogs.appPrefs.backendTestAlsoHere');
		});

		it('sends the token and client identity to ping, but not to health', async () => {
			fetchMock
				.mockResolvedValueOnce(jsonResponse(health))
				.mockResolvedValueOnce(jsonResponse(ping));
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));
			await screen.findByTestId('backend-test-result');
			expect(fetchMock.mock.calls[0][1].headers).toBeUndefined();
			expect(fetchMock.mock.calls[1][0]).toBe(
				'https://example.com/api/v1/ping'
			);
			expect(fetchMock.mock.calls[1][1].headers).toEqual({
				Authorization: 'Bearer sekrit',
				'X-Client-Id': 'mine',
				'X-Client-Name': 'me'
			});
		});

		it('disables itself while a test is running', async () => {
			let resolveHealth: (value: Response) => void = () => {};

			fetchMock.mockReturnValueOnce(
				new Promise<Response>(resolve => (resolveHealth = resolve))
			);
			renderComponent();
			fireEvent.click(screen.getByTestId('backend-test'));
			await waitFor(() =>
				expect(screen.getByTestId('backend-test')).toBeDisabled()
			);
			resolveHealth(jsonResponse({}, 502));
			await screen.findByTestId('backend-test-result');
			expect(screen.getByTestId('backend-test')).not.toBeDisabled();
		});
	});

	it('is accessible', async () => {
		const {container} = renderComponent();

		expect(await axe(container)).toHaveNoViolations();
	});
});

describe('isMixedContent()', () => {
	it('warns when a secure page points at a plain HTTP server', () =>
		expect(isMixedContent('http://example.com', 'https:')).toBe(true));

	it('allows loopback, which browsers treat as secure', () => {
		expect(isMixedContent('http://localhost:8080', 'https:')).toBe(false);
		expect(isMixedContent('http://127.0.0.1:8080', 'https:')).toBe(false);
	});

	it('allows an HTTPS server, and anything from an insecure page', () => {
		expect(isMixedContent('https://example.com', 'https:')).toBe(false);
		expect(isMixedContent('http://example.com', 'http:')).toBe(false);
	});

	it('says nothing about an address that is still being typed', () =>
		expect(isMixedContent('http://', 'https:')).toBe(false));
});

describe('trimBackendUrl()', () => {
	it('leaves a scheme being typed alone', () => {
		expect(trimBackendUrl('https:')).toBe('https:');
		expect(trimBackendUrl('https:/')).toBe('https:/');
		expect(trimBackendUrl('https://')).toBe('https://');
	});

	it('removes trailing slashes once there is a host', () => {
		expect(trimBackendUrl('https://example.com/')).toBe('https://example.com');
		expect(trimBackendUrl('https://example.com//')).toBe('https://example.com');
		expect(trimBackendUrl('https://example.com/base/')).toBe(
			'https://example.com/base'
		);
	});
});

describe('defaultBackendUsername()', () => {
	it('uses the first four characters of the client id', () =>
		expect(defaultBackendUsername('89abcdef-0000')).toBe('user-89ab'));
});
