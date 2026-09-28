import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {DialogCard} from '../../../components/container/dialog-card';
import {useLibraryEngine} from '../../../store/asset-library/library-provider';
import {DialogComponentProps} from '../../dialogs.types';
import {useLibraryChange} from '../asset-store-context';
import {ConflictPanel} from './conflict-panel';
import './library.css';

/** Every library conflict, from the story list's chip. No story needed. */
export const LibraryConflictsDialog: React.FC<DialogComponentProps> = props => {
	const engine = useLibraryEngine();
	const version = useLibraryChange();
	const {t} = useTranslation();

	return (
		<DialogCard
			{...props}
			className="library-conflicts-dialog"
			headerLabel={t('dialogs.library.conflictsDialog')}
			maximizable
		>
			<div className="library-panel-body">
				{engine && (
					<ConflictPanel
						collectionName={id => engine.get(id, 'collection')?.name ?? ''}
						engine={engine}
						version={version}
					/>
				)}
			</div>
		</DialogCard>
	);
};
