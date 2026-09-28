import * as React from 'react';
import {useDialogsContext} from '../dialogs/context';
import {useLibraryChange} from '../dialogs/sliders-assets/asset-store-context';
import {LibraryConflictsDialog} from '../dialogs/sliders-assets/library/library-conflicts-dialog';
import {collectionSync} from '../dialogs/sliders-assets/library/library-model';
import {SyncChip} from '../dialogs/sliders-assets/library/sync-chip';
import {
	useLibraryEngine,
	useLibraryStatus
} from '../store/asset-library/library-provider';

/**
 * The asset library's sync, aggregated over every collection (plan 2, "App-wide"). Sits
 * next to the story sync status in the story list's top bar. Conflicts open the panel.
 */
export const LibrarySyncChip: React.FC = () => {
	const engine = useLibraryEngine();
	const status = useLibraryStatus();
	const {dispatch} = useDialogsContext();

	useLibraryChange();

	if (!engine) {
		return null;
	}

	return (
		<SyncChip
			className="library-sync-chip-app"
			onOpenConflicts={() =>
				dispatch({component: LibraryConflictsDialog, type: 'addDialog'})
			}
			sync={collectionSync(engine, undefined, status)}
		/>
	);
};
