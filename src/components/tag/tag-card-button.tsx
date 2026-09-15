import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardButton} from '../control/card-button';
import {IconPlus, IconTag} from '@tabler/icons';
import {CardContent} from '../container/card';
import {AutocompleteTextInput} from '../control/autocomplete-text-input';
import type {AutocompleteMetadata} from '../control/autocomplete-text-input';
import {IconButton} from '../control/icon-button';
import {Color} from '../../util/color';
import {TagButton} from './tag-button';
import {isValidTagName} from '../../util/tag';
import {useControlledOpen} from '../control/use-controlled-open';
import './tag-card-button.css';

export interface TagCardButtonProps {
	/**
	 * The command this button runs, if it has one--see `IconButtonProps`.
	 */
	commandId?: string;
	disabled?: boolean;
	allTags: string[];
	/**
	 * Drop the label and show the tag icon alone--for a tile whose action row has to fit
	 * on one line. `CardButton` spreads into `IconButton`, but this component picks its
	 * props apart instead of spreading, so it has to be forwarded by hand.
	 */
	iconOnly?: boolean;
	id: string;
	onAdd: (value: string) => void;
	/**
	 * Called when the tag card opens or closes. Only needed if a parent wants
	 * to control this--see `open`.
	 */
	onChangeOpen?: (value: boolean) => void;
	/**
	 * Is the tag card open? Leave undefined to let the button manage itself.
	 */
	open?: boolean;
	onChangeColor?: (value: string, color: Color) => void;
	onRemove: (value: string) => void;
	/**
	 * When true, the new-tag field only accepts names already present in
	 * `allTags` -- for a filter-style selector, where "adding" a name that
	 * matches nothing would be a dead end.
	 */
	restrictToExisting?: boolean;
	tagColors?: Record<string, Color>;
	tags: string[];
}

export const TagCardButton: React.FC<TagCardButtonProps> = props => {
	const {
		allTags,
		commandId,
		disabled,
		iconOnly,
		id,
		onAdd,
		onChangeColor,
		onChangeOpen,
		onRemove,
		open: controlledOpen,
		restrictToExisting,
		tagColors,
		tags
	} = props;
	const [newTagName, setNewTagName] = React.useState('');
	const [open, setOpen] = useControlledOpen(controlledOpen, onChangeOpen);
	const {t} = useTranslation();
	const tagCompletions = React.useMemo(
		() => allTags.filter(tag => !tags.includes(tag)),
		[allTags, tags]
	);
	const label =
		tags.length === 0
			? t('common.tags')
			: t('components.tagCardButton.tagsWithCount_plural', {
					count: tags.length
			  });
	let validationMessage: string | undefined = undefined;
	let canAdd = isValidTagName(newTagName);

	if (!canAdd && newTagName !== '') {
		validationMessage = t('components.tagCardButton.invalidName');
	}

	if (canAdd) {
		canAdd = !tags.includes(newTagName);

		if (!canAdd) {
			validationMessage = t('components.tagCardButton.alreadyAdded');
		}
	}

	if (canAdd && restrictToExisting) {
		canAdd = allTags.includes(newTagName);

		if (!canAdd) {
			validationMessage = t('components.tagCardButton.invalidName');
		}
	}

	function handleNewTagNameChange(
		event: React.ChangeEvent<HTMLInputElement>,
		metadata: AutocompleteMetadata
	) {
		const value = event.target.value.replaceAll(' ', '-');

		if (metadata.autocompleted) {
			onAdd(value);
			setNewTagName('');
			return;
		}

		setNewTagName(value);
	}

	function handleSubmit(event: React.FormEvent) {
		event.preventDefault();

		if (canAdd && newTagName.trim() !== '') {
			onAdd(newTagName);
			setNewTagName('');
		}
	}

	function handleChangeOpen(value: boolean) {
		setOpen(value);

		if (!value) {
			setNewTagName('');
		}
	}

	return (
		<span className="tag-card-button">
			<CardButton
				ariaLabel={t('common.tags')}
				commandId={commandId}
				disabled={disabled}
				onChangeOpen={handleChangeOpen}
				open={open}
				icon={<IconTag />}
				iconOnly={iconOnly}
				label={label}
			>
				<CardContent>
					<form onSubmit={handleSubmit}>
						<AutocompleteTextInput
							completions={tagCompletions}
							id={id}
							onChange={handleNewTagNameChange}
							value={newTagName}
						>
							{t('components.tagCardButton.tagNameLabel')}
						</AutocompleteTextInput>
						<IconButton
							buttonType="submit"
							disabled={!canAdd}
							icon={<IconPlus />}
							label={t('common.add')}
							variant="create"
						/>
						{validationMessage && <p>{validationMessage}</p>}
					</form>
					<div className="tags">
						{tags.map(tag => (
							<TagButton
								key={tag}
								name={tag}
								color={tagColors?.[tag]}
								onChangeColor={
									onChangeColor
										? color => onChangeColor(tag, color)
										: undefined
								}
								onRemove={() => onRemove(tag)}
							/>
						))}
					</div>
				</CardContent>
			</CardButton>
		</span>
	);
};
