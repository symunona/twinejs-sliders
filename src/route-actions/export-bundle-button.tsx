import {IconFileExport, IconX} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../components/container/card';
import {CardButton} from '../components/control/card-button';
import {IconButton} from '../components/control/icon-button';
import {slidersAssetStore} from '../dialogs/sliders-assets/asset-store-context';
import {Story} from '../store/stories';
import {getAppInfo} from '../util/app-info';
import {saveBlob} from '../util/save-file';
import {exportStoryBundle, ExportReport} from '../util/sliders-bundle';

export interface ExportBundleButtonProps {
	story?: Story;
}

/**
 * Exports a story as a `.sliders.zip` — the story plus the assets it references.
 *
 * The asset library is global and origin-bound, so a story exported as plain HTML arrives
 * on another machine with every `bg:` and every character unresolved. See
 * docs/sliders/08-export-import-bundle.md.
 */
export const ExportBundleButton: React.FC<ExportBundleButtonProps> = props => {
	const {story} = props;
	const {t} = useTranslation();
	const [busy, setBusy] = React.useState(false);
	const [error, setError] = React.useState<Error>();
	const [report, setReport] = React.useState<ExportReport>();

	// The download itself is the confirmation, so a clean export says nothing. The card
	// only opens when something was left behind or picked for the author, or when the
	// export failed outright.
	const open =
		!!error ||
		(!!report &&
			(report.unresolved.length > 0 || report.ambiguousFx.length > 0));

	async function handleClick() {
		if (!story) {
			throw new Error('No story provided to export');
		}

		setBusy(true);
		setError(undefined);
		setReport(undefined);

		try {
			const bundle = await exportStoryBundle(
				story,
				slidersAssetStore(),
				getAppInfo()
			);

			saveBlob(bundle.blob, bundle.filename);
			setReport(bundle.report);
		} catch (error) {
			setError(error as Error);
		} finally {
			setBusy(false);
		}
	}

	function handleDismiss() {
		setError(undefined);
		setReport(undefined);
	}

	return (
		<CardButton
			ariaLabel={error?.message ?? ''}
			disabled={!story || busy}
			icon={<IconFileExport />}
			label={
				busy
					? t('routeActions.build.exportingWithAssets')
					: t('routeActions.build.exportWithAssets')
			}
			onChangeOpen={handleDismiss}
			onClick={handleClick}
			open={open}
		>
			<CardContent>
				{error && <p>{error.message}</p>}
				{report && (
					<>
						<p>
							{t('routeActions.build.exportedWithAssets', {
								assets: report.assetCount,
								characters: report.characterCount
							})}
						</p>
						{report.unresolved.length > 0 && (
							<p>
								{t('routeActions.build.exportUnresolved', {
									count: report.unresolved.length,
									names: report.unresolved.join(', ')
								})}
							</p>
						)}
						{report.ambiguousFx.length > 0 && (
							<p>
								{t('routeActions.build.exportAmbiguousFx', {
									count: report.ambiguousFx.length,
									names: report.ambiguousFx.join(', ')
								})}
							</p>
						)}
					</>
				)}
				<IconButton
					icon={<IconX />}
					label={t('common.close')}
					onClick={handleDismiss}
					variant="primary"
				/>
			</CardContent>
		</CardButton>
	);
};
