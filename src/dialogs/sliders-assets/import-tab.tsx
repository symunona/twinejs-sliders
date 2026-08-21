import {AssetKind, AssetMeta, Character} from '@sliders/scene-types';
import {IconDownload} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {TextSelect} from '../../components/control/text-select';
import {useStoriesContext} from '../../store/stories';
import {AssetPreview} from './asset-preview';
import {
	LEGACY_ASSET_SCOPE,
	useAssetLibrary,
	useAssetStore
} from './asset-store-context';
import {
	assetIsPresent,
	importAssetFromStory,
	importCharacterFromStory
} from './import-from-story';

export interface ImportTabProps {
	/** This story's assets, frames included — what "already here" is judged against. */
	present: AssetMeta[];
	search: string;
	/** Called after anything is written, so the other tabs re-read the library. */
	onImported: () => void;
}

/** One row of the source picker. */
interface Source {
	label: string;
	scope: string;
}

/**
 * Bringing art over from another story.
 *
 * Libraries are per story now, so the author who wants the same forest in two stories has
 * to say so. One picture at a time on purpose: copying a whole library across is how the
 * shared pile happened in the first place.
 */
export const ImportTab: React.FC<ImportTabProps> = props => {
	const {onImported, present, search} = props;
	const {t} = useTranslation();
	const {stories} = useStoriesContext();
	const target = useAssetStore();
	const legacy = useAssetLibrary(LEGACY_ASSET_SCOPE);
	const [source, setSource] = React.useState('');
	const [busyId, setBusyId] = React.useState<string>();
	const [notice, setNotice] = React.useState<string>();

	const sources: Source[] = React.useMemo(() => {
		const list: Source[] = stories
			.filter(story => story.id !== target.scope)
			.map(story => ({label: story.name, scope: story.id}))
			.sort((a, b) => a.label.localeCompare(b.label));

		// The library every story used to share. It is not a story, so it has no name of
		// its own, and it only exists for authors who were here before scoping.
		if (legacy.all.length > 0 || legacy.characters.length > 0) {
			list.unshift({
				label: t('dialogs.slidersAssets.importLegacy'),
				scope: LEGACY_ASSET_SCOPE
			});
		}

		return list;
	}, [legacy.all.length, legacy.characters.length, stories, t, target.scope]);

	// Whatever the picker is showing has to be a real choice: the legacy row appears once
	// its library has loaded, and a story can be deleted while the dialog is open.
	const selected = sources.some(item => item.scope === source)
		? source
		: sources[0]?.scope;
	const library = useAssetLibrary(selected ?? target.scope);
	const searchText = search.trim().toLowerCase();

	const matchingAssets = React.useMemo(
		() =>
			selected === undefined
				? []
				: library.visible.filter(
						asset =>
							!searchText || asset.name.toLowerCase().includes(searchText)
				  ),
		[library.visible, searchText, selected]
	);
	const matchingCharacters = React.useMemo(
		() =>
			selected === undefined
				? []
				: library.characters.filter(
						character =>
							!searchText ||
							character.name.toLowerCase().includes(searchText) ||
							character.id.includes(searchText)
				  ),
		[library.characters, searchText, selected]
	);

	/** Runs one copy, and says what happened whether it wrote anything or not. */
	async function run(
		id: string,
		name: string,
		copy: () => Promise<{imported: boolean; warnings: string[]}>
	) {
		setBusyId(id);
		setNotice(undefined);

		try {
			const result = await copy();

			setNotice(
				[
					result.imported
						? t('dialogs.slidersAssets.imported', {name})
						: t('dialogs.slidersAssets.importedNothing', {name}),
					...result.warnings
				].join(' ')
			);
			onImported();
		} catch (error) {
			setNotice(
				t('dialogs.slidersAssets.importError', {
					message: (error as Error).message,
					name
				})
			);
		} finally {
			setBusyId(undefined);
		}
	}

	function handleImportAsset(meta: AssetMeta) {
		return run(meta.id, meta.name, () =>
			importAssetFromStory(library.store, target, meta)
		);
	}

	function handleImportCharacter(character: Character) {
		return run(character.id, character.name, () =>
			importCharacterFromStory(library.store, target, character)
		);
	}

	/** A character is here when its frames are — the same bytes test the assets use. */
	function characterIsPresent(character: Character): boolean {
		const frames = Object.values(character.frames);

		return (
			frames.length > 0 &&
			frames.every(frame => {
				const meta = library.all.find(asset => asset.id === frame.asset);

				return !!meta && assetIsPresent(meta, present);
			})
		);
	}

	if (sources.length === 0) {
		return (
			<div className="sliders-import">
				<p className="sliders-empty">
					{t('dialogs.slidersAssets.importNoStories')}
				</p>
			</div>
		);
	}

	return (
		<div className="sliders-import">
			<div className="sliders-import-bar">
				<TextSelect
					onChange={event => setSource(event.target.value)}
					options={sources.map(item => ({
						label: item.label,
						value: item.scope
					}))}
					value={selected}
				>
					{t('dialogs.slidersAssets.importFrom')}
				</TextSelect>
			</div>
			{notice && (
				<p className="sliders-import-notice" role="status">
					{notice}
				</p>
			)}
			<div className="sliders-tiles">
				{matchingAssets.map(asset => (
					<ImportTile
						busy={busyId === asset.id}
						detail={kindLabel(asset.kind, t)}
						here={assetIsPresent(asset, present)}
						key={asset.id}
						name={asset.name}
						onImport={() => handleImportAsset(asset)}
						previewId={asset.id}
						scope={selected!}
					/>
				))}
				{matchingCharacters.map(character => (
					<ImportTile
						busy={busyId === character.id}
						detail={t('dialogs.slidersAssets.frameCount', {
							count: Object.keys(character.frames).length
						})}
						here={characterIsPresent(character)}
						key={character.id}
						name={character.name}
						onImport={() => handleImportCharacter(character)}
						previewId={
							character.frames[Object.keys(character.frames)[0]]?.asset
						}
						scope={selected!}
					/>
				))}
			</div>
			{!library.busy &&
				matchingAssets.length === 0 &&
				matchingCharacters.length === 0 && (
					<p className="sliders-empty">
						{t('dialogs.slidersAssets.importEmpty')}
					</p>
				)}
		</div>
	);
};

function kindLabel(kind: AssetKind, t: (key: string) => string): string {
	switch (kind) {
		case 'bg':
			return t('dialogs.slidersAssets.backgrounds');
		case 'object':
			return t('dialogs.slidersAssets.objects');
		case 'fx':
			return t('dialogs.slidersAssets.fx');
		default:
			return t('dialogs.slidersAssets.characters');
	}
}

interface ImportTileProps {
	busy: boolean;
	detail: string;
	/** Already in this story, by bytes. Nothing to do, so the button says so and stops. */
	here: boolean;
	name: string;
	onImport: () => void;
	previewId?: string;
	/** The story the preview's bytes come from, which is not the one we are editing. */
	scope: string;
}

const ImportTile: React.FC<ImportTileProps> = props => {
	const {busy, detail, here, name, onImport, previewId, scope} = props;
	const {t} = useTranslation();

	return (
		<div className="sliders-tile">
			<AssetPreview alt={name} assetId={previewId} scope={scope} />
			<div className="sliders-tile-name">{name}</div>
			<div className="sliders-tile-detail">{detail}</div>
			<div className="sliders-tile-badges">
				{here && <Badge label={t('dialogs.slidersAssets.importAlreadyHere')} />}
			</div>
			<ButtonBar>
				<IconButton
					disabled={busy || here}
					icon={<IconDownload />}
					label={
						here
							? t('dialogs.slidersAssets.importAlreadyHere')
							: t('dialogs.slidersAssets.import')
					}
					onClick={onImport}
					variant={here ? undefined : 'primary'}
				/>
			</ButtonBar>
		</div>
	);
};
