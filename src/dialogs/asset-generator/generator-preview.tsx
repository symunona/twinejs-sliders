import {AssetId} from '@sliders/scene-types';
import * as React from 'react';
import {createPortal} from 'react-dom';
import {useTranslation} from 'react-i18next';

/** What the right-hand pane is showing: a library asset, or something generated. */
export type GeneratorSelection =
	| {id: AssetId; kind: 'asset'}
	| {id: string; kind: 'generation'};

export interface GeneratorPreviewProps {
	/** Model, aspect, date--whatever the source knows about itself. */
	detail?: string;
	name?: string;
	url?: string;
}

/**
 * A big look at whatever was clicked last, so the tiny tiles don't have to be the only
 * way to see an image. Clicking the image goes full screen, which is the only way to
 * judge a background at anything like its real size.
 */
export const GeneratorPreview: React.FC<GeneratorPreviewProps> = props => {
	const {detail, name, url} = props;
	const [fullScreen, setFullScreen] = React.useState(false);
	const {t} = useTranslation();

	// Deleting the previewed generation while it fills the screen would otherwise
	// leave an empty black sheet with no obvious way out.
	React.useEffect(() => {
		if (!url) {
			setFullScreen(false);
		}
	}, [url]);

	React.useEffect(() => {
		if (!fullScreen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				// Captured, so Escape leaves full screen rather than closing the dialog.
				event.preventDefault();
				event.stopPropagation();
				setFullScreen(false);
			}
		};

		document.addEventListener('keydown', onKeyDown, true);
		return () => document.removeEventListener('keydown', onKeyDown, true);
	}, [fullScreen]);

	return (
		<div className="generator-preview">
			<h3 className="asset-generator-heading">
				{t('dialogs.assetGenerator.preview')}
			</h3>
			{url ? (
				<>
					<button
						className="generator-preview-image"
						onClick={() => setFullScreen(true)}
						title={t('dialogs.assetGenerator.fullScreen')}
						type="button"
					>
						<img alt={name ?? ''} src={url} />
					</button>
					{name && <p className="generator-preview-name">{name}</p>}
					{detail && <p className="asset-generator-detail">{detail}</p>}
				</>
			) : (
				<p className="sliders-empty">
					{t('dialogs.assetGenerator.emptyPreview')}
				</p>
			)}
			{/* The dialog stack is a transformed ancestor, which would make `position:
			    fixed` resolve against IT rather than the viewport. */}
			{fullScreen &&
				url &&
				createPortal(
					<div
						className="generator-preview-full"
						onClick={() => setFullScreen(false)}
						role="presentation"
						title={t('dialogs.assetGenerator.leaveFullScreen')}
					>
						<img alt={name ?? ''} src={url} />
					</div>,
					document.body
				)}
		</div>
	);
};
