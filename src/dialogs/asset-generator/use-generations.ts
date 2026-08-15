import * as React from 'react';
import {Generation, listGenerations} from './generation-store';

/**
 * The asset editor can be opened on a generation from its own dialog, and applying an
 * edit there has to show up in the history behind it. Same module-level counter the
 * asset library uses, for the same reason.
 */
let historyVersion = 0;
const historyListeners = new Set<() => void>();

export function refreshGenerations(): void {
	historyVersion++;
	historyListeners.forEach(listener => listener());
}

export interface GenerationHistory {
	busy: boolean;
	generations: Generation[];
	refresh: () => void;
	/** Object URL per generation id. Revoked as soon as the history reloads. */
	urls: Record<string, string>;
}

export function useGenerations(): GenerationHistory {
	const [generations, setGenerations] = React.useState<Generation[]>([]);
	const [busy, setBusy] = React.useState(true);
	const [version, setVersion] = React.useState(historyVersion);

	React.useEffect(() => {
		const listener = () => setVersion(historyVersion);

		historyListeners.add(listener);
		return () => {
			historyListeners.delete(listener);
		};
	}, []);

	React.useEffect(() => {
		let current = true;

		listGenerations()
			.then(loaded => {
				if (current) {
					setGenerations(loaded);
				}
			})
			.catch(error => {
				console.error('Could not load the generation history', error);
			})
			.finally(() => {
				if (current) {
					setBusy(false);
				}
			});

		return () => {
			current = false;
		};
	}, [version]);

	// One URL per blob, minted together and revoked together. Editing a generation
	// replaces its blob under the same id, so keying these by id alone would leave a
	// stale URL behind; the whole map is rebuilt whenever the list is.

	const urls = React.useMemo(() => {
		const result: Record<string, string> = {};

		for (const generation of generations) {
			result[generation.id] = URL.createObjectURL(generation.blob);
		}

		return result;
	}, [generations]);

	React.useEffect(
		() => () => {
			Object.values(urls).forEach(url => URL.revokeObjectURL(url));
		},
		[urls]
	);

	return {busy, generations, refresh: refreshGenerations, urls};
}
