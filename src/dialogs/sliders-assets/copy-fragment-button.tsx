import {IconCheck, IconClipboard} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {IconButton} from '../../components/control/icon-button';

/**
 * Puts text on the clipboard. The async Clipboard API needs a secure context and a user
 * gesture; the textarea trick covers everywhere else.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		if (navigator.clipboard?.writeText) {
			await navigator.clipboard.writeText(text);
			return true;
		}
	} catch (error) {
		console.warn('Clipboard API refused the copy, falling back', error);
	}

	try {
		const textArea = document.createElement('textarea');

		textArea.value = text;
		textArea.setAttribute('readonly', '');
		textArea.style.position = 'fixed';
		textArea.style.opacity = '0';
		document.body.appendChild(textArea);
		textArea.select();

		const copied = document.execCommand('copy');

		document.body.removeChild(textArea);
		return copied;
	} catch (error) {
		console.warn('Could not copy to the clipboard', error);
		return false;
	}
}

export interface CopyFragmentButtonProps {
	fragment: string;
}

/**
 * Copying a tile yields the scene-YAML line, not the asset id (spec 03). This is the
 * feature that gets used every day, so the button wears the fragment as its label.
 */
export const CopyFragmentButton: React.FC<CopyFragmentButtonProps> = props => {
	const {fragment} = props;
	const [copied, setCopied] = React.useState(false);
	const {t} = useTranslation();

	React.useEffect(() => {
		if (copied) {
			const timeout = window.setTimeout(() => setCopied(false), 1500);

			return () => window.clearTimeout(timeout);
		}
	}, [copied]);

	async function handleClick() {
		setCopied(await copyText(fragment));
	}

	return (
		<span className="copy-fragment-button" data-fragment={fragment}>
			<IconButton
				icon={copied ? <IconCheck /> : <IconClipboard />}
				label={fragment}
				displayLabel={
					copied ? (
						t('dialogs.slidersAssets.copied')
					) : (
						<code className="sliders-fragment">{fragment}</code>
					)
				}
				onClick={handleClick}
				variant="primary"
			/>
		</span>
	);
};
