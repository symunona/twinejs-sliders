/**
 * Which Live model voice mode talks to, and the few numbers the protocol fixes.
 *
 * Model ids move, and a retired one does not degrade — the socket closes 1008 "not found
 * for API version v1beta" before setup completes. 2026-09 that happened to every id this
 * list shipped with. They live here, next to `generatorModels`, so the next rename is one
 * file rather than a hunt through the adapter. Check the live list with
 * `GET /v1beta/models?key=…`, filtered on `supportedGenerationMethods` ∋
 * `bidiGenerateContent` — the docs page lags it.
 */

export interface LiveModel {
	/**
	 * Roughly how many tokens fit in this model's window.
	 *
	 * DISPLAY ONLY, and approximate. The Live API exposes no window size — the closest
	 * thing on the wire is `ContextWindowCompressionConfig.triggerTokens`, documented as
	 * "80% of the model's context window limit", which is a default we do not receive.
	 * So this is a published figure copied by hand, it drifts with every model rename,
	 * and nothing but a progress bar is allowed to depend on it. Leave it unset rather
	 * than guess: the panel then shows the token count with no percentage.
	 */
	contextTokens?: number;
	id: string;
	label: string;
	note?: string;
	/**
	 * Sent as `generationConfig.thinkingConfig.thinkingLevel`. Per model, not a preference:
	 * extended-thinking REQUIRES it (1007 without), and 3.8 Live REJECTS it (1007 with).
	 */
	thinkingLevel?: 'low' | 'medium' | 'high';
}

export const liveModels: LiveModel[] = [
	{
		id: 'gemini-3.8-live',
		label: 'Gemini 3.8 Live',
		note: 'Default. Fast, calls tools well, no reasoning delay.'
	},
	{
		id: 'gemini-3.8-live-extended-thinking',
		label: 'Gemini 3.8 Live, extended thinking',
		note: 'Reasons in the background. Slower to act; tool calls arrive after a pause.',
		thinkingLevel: 'low'
	},
	{
		id: 'gemini-3.1-flash-live-preview',
		label: 'Gemini 3.1 Flash Live',
		note: 'Legacy preview. Tool calls run one at a time.'
	},
	{
		// The docs give native-audio models a 128k window and publish nothing for the rest.
		contextTokens: 128_000,
		id: 'gemini-2.5-flash-native-audio-preview-12-2025',
		label: 'Gemini 2.5 Flash Native Audio',
		note: 'Best voice. Weakest at tools.'
	}
];

export const defaultLiveModel = liveModels[0].id;

export function liveModel(id: string): LiveModel | undefined {
	return liveModels.find(model => model.id === id);
}

/**
 * The saved choice, or the default when it is empty or no longer listed. A pref naming a
 * retired id must not reproduce the 1008 this file was rewritten to fix.
 */
export function pickLiveModel(id: string | undefined): LiveModel {
	return liveModel(id ?? '') ?? liveModels[0];
}

/**
 * Rates the protocol fixes, not preferences. The API takes 16 kHz mono PCM16 in and
 * always sends 24 kHz mono PCM16 out; resampling either one is our job, not its.
 */
export const INPUT_SAMPLE_RATE = 16_000;
export const OUTPUT_SAMPLE_RATE = 24_000;

export function liveEndpoint(apiKey: string): string {
	return (
		'wss://generativelanguage.googleapis.com/ws/' +
		'google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent' +
		`?key=${encodeURIComponent(apiKey)}`
	);
}
