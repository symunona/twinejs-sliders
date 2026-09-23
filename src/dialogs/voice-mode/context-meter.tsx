import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Meter} from '../../components/meter';
import {liveModel} from '../../voice/live/models';
import type {VoiceUsage} from '../../voice/voice.types';

export interface ContextMeterProps {
	modelId: string;
	usage?: VoiceUsage;
}

/** `12400` → `12.4k`. Exact below 1000; nobody needs three digits of precision here. */
export function shortTokens(count: number): string {
	if (count < 1000) {
		return String(count);
	}

	if (count < 1_000_000) {
		return `${(count / 1000).toFixed(count < 10_000 ? 1 : 0)}k`;
	}

	return `${(count / 1_000_000).toFixed(1)}M`;
}

/**
 * How full the context window is.
 *
 * `prompt` and not `total`: `promptTokenCount` is what is actually in the window on the
 * next turn, and it is the only figure that can go DOWN — a sliding-window compaction
 * shows up here and nowhere else. `totalTokenCount` only ever climbs, because it is the
 * bill.
 *
 * The bar is shown only when the model has a `contextTokens` figure, because the API does
 * not report a window size and an invented denominator is worse than no bar.
 */
export const ContextMeter: React.FC<ContextMeterProps> = props => {
	const {modelId, usage} = props;
	const {t} = useTranslation();

	if (!usage) {
		return null;
	}

	const limit = liveModel(modelId)?.contextTokens;
	const label = t('dialogs.voiceMode.contextUsed', {
		tokens: shortTokens(usage.prompt)
	});
	const title = t('dialogs.voiceMode.contextDetail', {
		prompt: usage.prompt,
		total: usage.total
	});

	if (!limit) {
		return (
			<span className="voice-context" title={title}>
				{label}
			</span>
		);
	}

	return (
		<span className="voice-context" title={title}>
			<Meter domId="voice-context-meter" percent={Math.min(1, usage.prompt / limit)}>
				{label}
			</Meter>
		</span>
	);
};
