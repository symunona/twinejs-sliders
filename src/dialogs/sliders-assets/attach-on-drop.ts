import type {LibraryEngine} from '@sliders/asset-library';
import * as React from 'react';
import {attachCollections} from '../../store/asset-library/auto-attach';

/** Drops inside the Library itself (rail move/copy, upload zone) are not uses. */
const LIBRARY_SELECTOR = '.sliders-assets-dialog';

/**
 * A tile dragged out of the Library and dropped somewhere that took it -- the stage, the
 * passage text -- attaches the collection it was dragged FROM.
 *
 * Name-based auto-attach (`auto-attach.ts`) has to guess from a plain name and declines
 * when two packs share it. A drag knows its source, so it does not guess. Armed on
 * dragstart, fired from a capture-phase `drop` on the document: a `drop` only reaches an
 * element that accepted the drag, and capture runs before the target's own handler writes
 * the name, so the scene resolves the moment it is written. Disarmed on dragend.
 */
export function useAttachOnDrop(
	engine: LibraryEngine | undefined,
	storyId: string,
	storyName?: string
): (collection: string) => void {
	const disarm = React.useRef<() => void>();
	const latest = React.useRef({engine, storyId, storyName});

	latest.current = {engine, storyId, storyName};
	React.useEffect(() => () => disarm.current?.(), []);

	return React.useCallback((collection: string) => {
		disarm.current?.();

		const handleDrop = (event: DragEvent) => {
			const target = event.target as Element | null;

			if (target?.closest?.(LIBRARY_SELECTOR)) {
				return;
			}

			const {engine, storyId, storyName} = latest.current;

			if (engine) {
				attachCollections(engine, storyId, [collection], storyName);
			}
		};
		const stop = () => {
			document.removeEventListener('drop', handleDrop, true);
			document.removeEventListener('dragend', stop, true);
			disarm.current = undefined;
		};

		document.addEventListener('drop', handleDrop, true);
		document.addEventListener('dragend', stop, true);
		disarm.current = stop;
	}, []);
}
