import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconLayoutNavbarCollapse, IconLayoutNavbarExpand} from '@tabler/icons';
import {
	BackgroundDialogCard,
	DialogCard
} from '../../components/container/dialog-card';
import {DialogStack} from '../../components/container/dialog-card/dialog-stack';
import {EditableTitle} from '../../components/control/editable-title';
import {IconButton} from '../../components/control/icon-button';
import {TagGrid} from '../../components/tag';
import {VisibleWhitespace} from '../../components/visible-whitespace';
import {setPref, usePrefsContext} from '../../store/prefs';
import {
	passageWithId,
	storyWithId,
	updatePassage,
	useStoriesContext
} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {
	addPassageEditors,
	removePassageEditors,
	useDialogsContext
} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {PassageEditContents} from './passage-edit-contents';
import './passage-edit-stack.css';

export interface PassageEditStackProps extends DialogComponentProps {
	passageIds: string[];
	storyId: string;
}

const InnerPassageEditStack: React.FC<PassageEditStackProps> = props => {
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	const {onChangeProps, onClose, passageIds, storyId, ...managementProps} =
		props;
	const {dispatch} = useDialogsContext();
	const {dispatch: prefsDispatch, prefs} = usePrefsContext();
	const {stories} = useStoriesContext();
	const {dispatch: storiesDispatch} = useUndoableStoriesContext();
	const {t} = useTranslation();
	const storyTagColors = storyWithId(stories, storyId).tagColors;
	const passageInfo = passageIds.map(passageId => {
		const passage = passageWithId(stories, storyId, passageId);

		return {name: passage.name, tags: passage.tags};
	});
	const style: React.CSSProperties = {};

	if (managementProps.collapsed) {
		style.height = `calc(var(--control-height) * ${passageIds.length})`;

		if (managementProps.maximized) {
			style.bottom = 0;
			style.position = 'absolute';
		}
	}

	function handleRename(passageId: string, name: string) {
		const passage = passageWithId(stories, storyId, passageId);

		// Don't create newly linked passages here, for the reason the toolbar's rename
		// button gives: the update would see the new links before it saw the new name.
		storiesDispatch(
			updatePassage(
				storyWithId(stories, storyId),
				passage,
				{name},
				{dontUpdateOthers: true}
			)
		);
	}

	function nameTaken(name: string) {
		return storyWithId(stories, storyId).passages.some(
			// eslint-disable-next-line no-restricted-syntax -- store identity, not link resolution: this asks whether a card already carries the name, and `Start` does not take `start`.
			passage => passage.name === name
		);
	}

	function handleClose(
		passageId: string,
		event?: React.KeyboardEvent | React.MouseEvent
	) {
		if (event?.shiftKey) {
			onClose(event);
		} else {
			dispatch(removePassageEditors([passageId]));
		}
	}

	// Lives in the title bar next to maximize, because it is about how much
	// room the editor gets--the same kind of thing maximizing is.

	const toolbarToggle = (
		<IconButton
			icon={
				prefs.passageEditorToolbars ? (
					<IconLayoutNavbarCollapse />
				) : (
					<IconLayoutNavbarExpand />
				)
			}
			iconOnly
			label={t(
				prefs.passageEditorToolbars
					? 'dialogs.passageEdit.hideToolbars'
					: 'dialogs.passageEdit.showToolbars'
			)}
			onClick={() =>
				prefsDispatch(
					setPref('passageEditorToolbars', !prefs.passageEditorToolbars)
				)
			}
			tooltipPosition="bottom"
		/>
	);

	return (
		<div
			className={classNames('passage-edit-stack', {
				collapsed: managementProps.collapsed
			})}
			style={style}
		>
			<DialogStack childKeys={passageIds}>
				{passageIds.map((passageId, index) => {
					if (index !== 0) {
						return (
							<BackgroundDialogCard
								{...managementProps}
								headerDisplayLabel={
									<>
										<TagGrid
											tags={passageInfo[index].tags}
											tagColors={storyTagColors}
										/>
										<VisibleWhitespace value={passageInfo[index].name} />
									</>
								}
								headerLabel={passageInfo[index].name}
								key={passageId}
								onClose={event => handleClose(passageId, event)}
								onRaise={() =>
									dispatch(addPassageEditors(storyId, [passageId]))
								}
							>
								<PassageEditContents
									disabled
									passageId={passageId}
									storyId={storyId}
								/>
							</BackgroundDialogCard>
						);
					}

					return (
						<DialogCard
							{...managementProps}
							headerControls={toolbarToggle}
							// Scene commands belong to writing a scene, not to every dialog,
							// but they have to survive focus sitting on the card's own chrome
							// --which is where Escape out of the text puts it. Background
							// cards are disabled, so only the front one declares it.
							hotkeyScope="passage-editor"
							// The title of the editor in front renames the passage when
							// clicked. Background cards keep a plain title--a click there
							// raises that editor, which is the only thing it can mean.
							headerDisplayLabel={
								<>
									<TagGrid
										tags={passageInfo[index].tags}
										tagColors={storyTagColors}
									/>
									<EditableTitle
										editable
										nameTaken={nameTaken}
										onRename={name => handleRename(passageId, name)}
										title={t('components.passageCard.renameTitle')}
										value={passageInfo[index].name}
									>
										<VisibleWhitespace value={passageInfo[index].name} />
									</EditableTitle>
								</>
							}
							headerLabel={passageInfo[index].name}
							key={passageId}
							maximizable
							onClose={event => handleClose(passageId, event)}
						>
							<PassageEditContents passageId={passageId} storyId={storyId} />
						</DialogCard>
					);
				})}
			</DialogStack>
		</div>
	);
};

export const PassageEditStack: React.FC<PassageEditStackProps> = props => {
	const {passageIds, storyId} = props;
	const {stories} = useStoriesContext();

	const existingPassageIds = passageIds.filter(passageId => {
		try {
			passageWithId(stories, storyId, passageId);
		} catch {
			return false;
		}

		return true;
	});

	// If there aren't any passages to display, render nothing and call onClose.

	if (existingPassageIds.length === 0) {
		props.onClose();
		return null;
	}

	// If passages differ from what we were asked to display, change our props.

	if (existingPassageIds.length !== passageIds.length) {
		props.onChangeProps({...props, passageIds: existingPassageIds});
		return null;
	}

	// We're good to display dialogs normally.

	return <InnerPassageEditStack {...props} />;
};
