import {IconFocus2} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../../../components/control/icon-button';
import {useCommand} from '../../../../hotkeys';

export interface GoToPassageButtonProps {
	onOpenFuzzyFinder: () => void;
}

export const GoToPassageButton: React.FC<GoToPassageButtonProps> = props => {
	const {onOpenFuzzyFinder} = props;
	const {t} = useTranslation();

	useCommand({
		id: 'passage.goTo',
		label: t('hotkeys.commands.passage.goTo'),
		run: onOpenFuzzyFinder,
		scope: 'story-map'
	});

	// The same finder as a chord, in `global` and allowed in text fields, which
	// is what the bare key above cannot be: a letter only belongs in a scope
	// where the work is picking things rather than typing. Every place
	// `passage.goTo` did not resolve--focus in the passage text, in a dialog, or
	// on nothing at all--was a place Ctrl+P opened the browser's print dialog
	// instead.

	useCommand({
		allowInInput: true,
		id: 'passage.find',
		label: t('hotkeys.commands.passage.find'),
		run: onOpenFuzzyFinder,
		scope: 'global'
	});

	return (
		<IconButton
			commandId="passage.goTo"
			icon={<IconFocus2 />}
			label={t('routes.storyEdit.toolbar.goTo')}
			onClick={onOpenFuzzyFinder}
		/>
	);
};
