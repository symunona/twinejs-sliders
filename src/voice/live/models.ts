/**
 * Which Live model voice mode talks to, and the few numbers the protocol fixes.
 *
 * Half-cascade rather than native audio, deliberately. Native audio sounds better and
 * calls functions worse, and this is a tool-calling app — a model that narrates an edit it
 * did not make is worse than one that sounds synthetic while making it.
 *
 * Model ids move. They live here, next to `generatorModels`, so the next rename is one
 * file rather than a hunt through the adapter.
 */

export interface LiveModel {
	id: string;
	label: string;
	note?: string;
}

export const liveModels: LiveModel[] = [
	{
		id: 'gemini-live-2.5-flash-preview',
		label: 'Gemini 2.5 Flash Live',
		note: 'Half-cascade. Weaker voice, stronger function calling — the right trade here.'
	},
	{
		id: 'gemini-2.0-flash-live-001',
		label: 'Gemini 2.0 Flash Live'
	},
	{
		id: 'gemini-2.5-flash-native-audio-preview-09-2025',
		label: 'Gemini 2.5 Flash Native Audio',
		note: 'Sounds best. Calls tools least reliably.'
	}
];

export const defaultLiveModel = liveModels[0].id;

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
