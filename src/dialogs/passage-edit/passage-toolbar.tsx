import {IconResize} from '@tabler/icons';
import {Editor} from 'codemirror';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {UndoRedoButtons} from '../../components/codemirror';
import {ButtonBar} from '../../components/container/button-bar';
import {MenuButton} from '../../components/control/menu-button';
import {RenamePassageButton} from '../../components/passage/rename-passage-button';
import {TestPassageButton} from '../../routes/story-edit/toolbar/passage/test-passage-button';
import {
	addPassageTag,
	Passage,
	removePassageTag,
	setTagColor,
	Story,
	storyPassageTags,
	updatePassage
} from '../../store/stories';
import {useUndoableStoriesContext} from '../../store/undoable-stories';
import {Color} from '../../util/color';
import {isPassageSize, passageSizes} from '../../util/passage-sizes';
import {TagCardButton} from '../../components/tag/tag-card-button';

export interface PassageToolbarProps {
	disabled?: boolean;
	editor?: Editor;
	passage: Passage;
	story: Story;
	useCodeMirror: boolean;
}

export const PassageToolbar: React.FC<PassageToolbarProps> = props => {
	const {disabled, editor, passage, story, useCodeMirror} = props;
	const {dispatch} = useUndoableStoriesContext();
	const {t} = useTranslation();
	const passageTags = storyPassageTags(story);

	function handleAddTag(name: string) {
		dispatch(addPassageTag(story, passage, name), t('undoChange.addTag'));
	}

	function handleChangeTagColor(name: string, color: Color) {
		dispatch(setTagColor(story, name, color));
	}

	function handleRemoveTag(name: string) {
		dispatch(removePassageTag(story, passage, name), t('undoChange.removeTag'));
	}

	function handleRename(name: string) {
		// Don't create newly linked passages here because the update action will
		// try to recreate the passage as it's been renamed--it sees new links in
		// existing passages, updates them, but does not see that the passage name
		// has been updated since that hasn't happened yet.

		dispatch(updatePassage(story, passage, {name}, {dontUpdateOthers: true}));
	}

	function handleSetSize({height, width}: {height: number; width: number}) {
		dispatch(updatePassage(story, passage, {height, width}));
	}

	return (
		<ButtonBar>
			{useCodeMirror && (
				<UndoRedoButtons
					disabled={disabled}
					editor={editor}
					watch={passage.text}
				/>
			)}
			<TagCardButton
				allTags={passageTags}
				id={`passage-tag-input-${passage.id}`}
				onAdd={handleAddTag}
				onChangeColor={handleChangeTagColor}
				onRemove={handleRemoveTag}
				tagColors={story.tagColors}
				tags={passage.tags}
			/>
			<MenuButton
				disabled={disabled}
				icon={<IconResize />}
				items={[
					{
						checkable: true,
						checked: isPassageSize(passage, passageSizes.small),
						label: t('dialogs.passageEdit.sizeSmall'),
						onClick: () => handleSetSize(passageSizes.small)
					},
					{
						checkable: true,
						checked: isPassageSize(passage, passageSizes.large),
						label: t('dialogs.passageEdit.sizeLarge'),
						onClick: () => handleSetSize(passageSizes.large)
					},
					{
						checkable: true,
						checked: isPassageSize(passage, passageSizes.tall),
						label: t('dialogs.passageEdit.sizeTall'),
						onClick: () => handleSetSize(passageSizes.tall)
					},
					{
						checkable: true,
						checked: isPassageSize(passage, passageSizes.wide),
						label: t('dialogs.passageEdit.sizeWide'),
						onClick: () => handleSetSize(passageSizes.wide)
					},
					{
						checkable: true,
						checked: isPassageSize(passage, passageSizes.largeWithPreview),
						label: t('dialogs.passageEdit.sizeLargeWithPreview'),
						onClick: () => handleSetSize(passageSizes.largeWithPreview)
					}
				]}
				label={t('dialogs.passageEdit.size')}
			/>
			<RenamePassageButton
				disabled={disabled}
				// Not `dialog`: that scope now resolves inside every other dialog too, and
				// F2 there would rename whatever passage happens to be open behind it.
				hotkeyScope="passage-editor"
				onRename={handleRename}
				passage={passage}
				story={story}
			/>
			<TestPassageButton hotkeyScope={null} passage={passage} story={story} />
		</ButtonBar>
	);
};
