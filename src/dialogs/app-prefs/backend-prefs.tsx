import {v4 as uuid} from '@lukeed/uuid';
import {
	IconAlertTriangle,
	IconEye,
	IconEyeOff,
	IconPlugConnected
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CheckboxButton} from '../../components/control/checkbox-button';
import {IconButton} from '../../components/control/icon-button';
import {TextInput} from '../../components/control/text-input';
import {IconLoading} from '../../components/image/icon';
import type {
	HealthResponse,
	PingResponse
} from '../../store/persistence/server/server.types';
import {setPref, usePrefsContext} from '../../store/prefs';
import './backend-prefs.css';

/** How long a probe waits before it counts as no answer. */
const PROBE_TIMEOUT = 8000;

/**
 * Hosts a plain-HTTP backend is still reachable on from an HTTPS page--browsers treat
 * loopback as a secure context.
 */
const LOOPBACK_HOSTS = ['localhost', '127.0.0.1', '[::1]', '::1'];

/**
 * The name other editors see when the Username field is left empty. Identity here is a
 * label, not a credential (spec 11, "Auth and identity").
 */
export function defaultBackendUsername(clientId: string): string {
	return `user-${clientId.slice(0, 4)}`;
}

/**
 * Trailing slashes off, so the URL can have `/api/v1/...` appended to it. Careful not to
 * eat the slashes of `https://` as fast as someone types them.
 */
export function trimBackendUrl(value: string): string {
	const trimmed = value.trim();

	// Still typing the scheme: "https:", "https:/".

	if (/^[a-z][a-z0-9+.-]*:\/?$/i.test(trimmed)) {
		return trimmed;
	}

	// Scheme finished, no host yet: "https://".

	const scheme = /^[a-z][a-z0-9+.-]*:\/\//i.exec(trimmed);

	if (scheme && trimmed.length === scheme[0].length) {
		return trimmed;
	}

	return trimmed.replace(/\/+$/, '');
}

/**
 * Would the browser block a request to this URL? An HTTPS page can't reach a plain-HTTP
 * backend, and the failure looks exactly like an unreachable server, so say so up front.
 */
export function isMixedContent(
	url: string,
	pageProtocol = typeof window === 'undefined'
		? 'http:'
		: window.location.protocol
): boolean {
	if (pageProtocol !== 'https:') {
		return false;
	}

	try {
		const parsed = new URL(url);

		return (
			parsed.protocol === 'http:' && !LOOPBACK_HOSTS.includes(parsed.hostname)
		);
	} catch (error) {
		// Not a URL yet--nothing to warn about.

		return false;
	}
}

interface TestMessage {
	key: string;
	values?: Record<string, string | number>;
}

interface TestResult {
	messages: TestMessage[];
	variant: 'error' | 'success';
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

async function probe(
	url: string,
	path: string,
	headers?: Record<string, string>
): Promise<Response> {
	const controller = new AbortController();
	const timeout = window.setTimeout(() => controller.abort(), PROBE_TIMEOUT);

	try {
		return await fetch(`${url}${path}`, {headers, signal: controller.signal});
	} finally {
		window.clearTimeout(timeout);
	}
}

/**
 * Stamps a `data-testid` onto a child of a shared control that doesn't take arbitrary DOM
 * props. Cheaper than widening `TextInput`, `IconButton` and `CheckboxButton` for one
 * dialog section.
 */
const TestId: React.FC<{
	children: React.ReactNode;
	className?: string;
	selector: string;
	testId: string;
}> = ({children, className, selector, testId}) => {
	const ref = React.useRef<HTMLSpanElement>(null);

	React.useEffect(() => {
		ref.current?.querySelector(selector)?.setAttribute('data-testid', testId);
	});

	return (
		<span className={className} ref={ref}>
			{children}
		</span>
	);
};

export const BackendPrefs: React.FC = () => {
	const {dispatch, prefs} = usePrefsContext();
	const {t} = useTranslation();
	const [result, setResult] = React.useState<TestResult | null>(null);
	const [showToken, setShowToken] = React.useState(false);
	const [testing, setTesting] = React.useState(false);

	// Mint this browser's id once. It's never shown, but it names us in presence and
	// supplies the default username.

	React.useEffect(() => {
		if (!prefs.backendClientId) {
			dispatch(setPref('backendClientId', uuid()));
		}
	}, [dispatch, prefs.backendClientId]);

	const mixedContent = isMixedContent(prefs.backendUrl);

	function clientId() {
		if (prefs.backendClientId) {
			return prefs.backendClientId;
		}

		const minted = uuid();

		dispatch(setPref('backendClientId', minted));
		return minted;
	}

	async function handleTest() {
		const id = clientId();
		const url = trimBackendUrl(prefs.backendUrl);
		const unreachable: TestResult = {
			messages: [
				{
					key: mixedContent
						? 'dialogs.appPrefs.backendTestMixedContent'
						: 'dialogs.appPrefs.backendTestUnreachable'
				}
			],
			variant: 'error'
		};

		setResult(null);
		setTesting(true);

		try {
			if (!url) {
				setResult(unreachable);
				return;
			}

			let health: Response;

			try {
				// No auth on /health--it's a pure reachability probe (spec 11, "Probe").

				health = await probe(url, '/api/v1/health');

				if (!health.ok) {
					setResult(unreachable);
					return;
				}
			} catch (error) {
				setResult(unreachable);
				return;
			}

			const healthBody = (await health.json()) as HealthResponse;
			const ping = await probe(url, '/api/v1/ping', {
				Authorization: `Bearer ${prefs.backendToken}`,
				'X-Client-Id': id,
				'X-Client-Name':
					prefs.backendUsername.trim() || defaultBackendUsername(id)
			});

			if (ping.status === 401) {
				setResult({
					messages: [{key: 'dialogs.appPrefs.backendTestUnauthorized'}],
					variant: 'error'
				});
				return;
			}

			if (!ping.ok) {
				setResult({
					messages: [
						{
							key: 'dialogs.appPrefs.backendTestFailed',
							values: {status: ping.status}
						}
					],
					variant: 'error'
				});
				return;
			}

			const pingBody = (await ping.json()) as PingResponse;
			const messages: TestMessage[] = [
				{
					key: 'dialogs.appPrefs.backendTestConnected',
					values: {
						bytes: formatBytes(pingBody.bytesUsed ?? 0),
						service: healthBody.service ?? '',
						storyCount: pingBody.storyCount ?? 0,
						version: pingBody.version ?? ''
					}
				}
			];
			const others = (pingBody.clients ?? [])
				.filter(client => client.id !== id)
				.map(client => client.name);

			if (others.length > 0) {
				messages.push({
					key: 'dialogs.appPrefs.backendTestAlsoHere',
					values: {names: others.join(', ')}
				});
			}

			setResult({messages, variant: 'success'});
		} catch (error) {
			setResult(unreachable);
		} finally {
			setTesting(false);
		}
	}

	return (
		<div className="backend-prefs">
			<h3 className="app-prefs-heading">
				{t('dialogs.appPrefs.backendServer')}
			</h3>
			<p className="font-explanation">
				{t('dialogs.appPrefs.backendServerExplanation')}
			</p>
			<TestId selector="input" testId="backend-username">
				<TextInput
					onChange={e => dispatch(setPref('backendUsername', e.target.value))}
					orientation="vertical"
					placeholder={defaultBackendUsername(prefs.backendClientId)}
					value={prefs.backendUsername}
				>
					{t('dialogs.appPrefs.backendUsername')}
				</TextInput>
			</TestId>
			<p className="font-explanation">
				{t('dialogs.appPrefs.backendUsernameExplanation')}
			</p>
			<TestId selector="input" testId="backend-url">
				<TextInput
					onChange={e =>
						dispatch(setPref('backendUrl', trimBackendUrl(e.target.value)))
					}
					orientation="vertical"
					placeholder={t('dialogs.appPrefs.backendUrlPlaceholder')}
					value={prefs.backendUrl}
				>
					{t('dialogs.appPrefs.backendUrl')}
				</TextInput>
			</TestId>
			{mixedContent && (
				<p
					className="backend-prefs-warning"
					data-testid="backend-mixed-content-warning"
				>
					<IconAlertTriangle />
					{t('dialogs.appPrefs.backendMixedContent')}
				</p>
			)}
			<div className="backend-prefs-token">
				<TestId selector="input" testId="backend-token">
					<TextInput
						onChange={e => dispatch(setPref('backendToken', e.target.value))}
						orientation="vertical"
						placeholder={t('dialogs.appPrefs.backendTokenPlaceholder')}
						type={showToken ? 'text' : 'password'}
						value={prefs.backendToken}
					>
						{t('dialogs.appPrefs.backendToken')}
					</TextInput>
				</TestId>
				<TestId selector="button" testId="backend-token-reveal">
					<IconButton
						icon={showToken ? <IconEyeOff /> : <IconEye />}
						iconOnly
						label={t(
							showToken
								? 'dialogs.appPrefs.backendTokenHide'
								: 'dialogs.appPrefs.backendTokenShow'
						)}
						onClick={() => setShowToken(value => !value)}
					/>
				</TestId>
			</div>
			<p className="font-explanation">
				{t('dialogs.appPrefs.backendTokenExplanation')}
			</p>
			<TestId selector="button" testId="backend-autosave">
				<CheckboxButton
					label={t('dialogs.appPrefs.backendAutosave')}
					onChange={value => dispatch(setPref('backendAutosave', value))}
					value={prefs.backendAutosave}
				/>
			</TestId>
			<p className="font-explanation">
				{t('dialogs.appPrefs.backendAutosaveExplanation')}
			</p>
			<div className="backend-prefs-test">
				<TestId selector="button" testId="backend-test">
					<IconButton
						disabled={testing}
						icon={testing ? <IconLoading /> : <IconPlugConnected />}
						label={t(
							testing
								? 'dialogs.appPrefs.backendTesting'
								: 'dialogs.appPrefs.backendTest'
						)}
						onClick={handleTest}
					/>
				</TestId>
			</div>
			{result && (
				<p
					className={`backend-prefs-result variant-${result.variant}`}
					data-testid="backend-test-result"
				>
					{result.messages
						.map(message => t(message.key, message.values))
						.join(' ')}
				</p>
			)}
		</div>
	);
};
