import {assetFragment, musicFragment} from '@sliders/asset-store';
import {AssetMeta} from '@sliders/scene-types';
import {
	IconDots,
	IconMusic,
	IconPhotoEdit,
	IconTrash,
	IconWriting
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Badge} from '../../components/badge/badge';
import {ButtonBar} from '../../components/container/button-bar';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {
	LabeledMenuItem,
	MenuButton,
	MenuSeparator
} from '../../components/control/menu-button';
import {
	PromptButton,
	PromptValidationResponse
} from '../../components/control/prompt-button';
import {TagCardButton} from '../../components/tag/tag-card-button';
import {setAssetDragData} from '../passage-edit/scene-preview/asset-drag';
import type {AssetDragPayload} from '../passage-edit/scene-preview/asset-drag';
import {copyText} from '../../util/copy-text';
import {AssetPreview} from './asset-preview';
import {LIBRARY_ASSET_MIME} from './library/library-model';
import {ParticleTilePreview, useParticleHover} from './particle-tile-preview';
import {SoundPreview} from './sound-preview';
import {TileUses} from './tile-uses';

export interface AssetTileProps {
	allTags: string[];
	/** Library badges (usage, fork, sync state), before the tags. */
	badges?: React.ReactNode;
	/**
	 * Library tile menu. Edit and Rename are prepended here, so the menu opens the same
	 * rename prompt the pencil does.
	 */
	menuItems?: (LabeledMenuItem | MenuSeparator)[];
	/** Highlighted and scrolled to--something asked for this tile by name. */
	focused?: boolean;
	/**
	 * Opens the rename prompt, name selected, each time this changes to a new number. Set
	 * for art that was just pasted under a stand-in name.
	 */
	renameRequest?: number;
	meta: AssetMeta;
	onChangeTags: (tags: string[]) => void;
	onDelete: () => void;
	/** The tile started a drag that may land outside the Library -- see `attach-on-drop`. */
	onDragOut?: () => void;
	onEdit: () => void;
	/**
	 * Click capture on the whole tile. Ctrl/Cmd-click brings up a scene that uses this in an
	 * open passage editor -- see `open-using-passage`.
	 */
	onModClick?: (event: React.MouseEvent) => void;
	/** The scenes that write the old name always follow -- see `rename-plan.ts`. */
	onRename: (name: string) => void;
	/** Does something else in this library already answer to this name? */
	nameTaken?: (name: string) => boolean;
	/** Passage names whose scenes write this asset's name. */
	usedIn?: string[];
	/**
	 * No scene names this asset, so a push leaves it behind. Undefined while the scan is
	 * still running, which is not the same as "used" — see `useSyncedRefs`.
	 */
	unreferenced?: boolean;
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) {
		return `${bytes} B`;
	}

	if (bytes < 1024 * 1024) {
		return `${Math.round(bytes / 1024)} KB`;
	}

	return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export const AssetTile: React.FC<AssetTileProps> = props => {
	const {
		allTags,
		badges,
		focused,
		menuItems,
		meta,
		nameTaken,
		onChangeTags,
		onDelete,
		onDragOut,
		onEdit,
		onModClick,
		onRename,
		renameRequest,
		unreferenced,
		usedIn
	} = props;
	const {t} = useTranslation();
	const tileRef = React.useRef<HTMLDivElement>(null);
	const [renameOpen, setRenameOpen] = React.useState(false);
	const [draftName, setDraftName] = React.useState(meta.name);
	const artRef = React.useRef<HTMLDivElement>(null);
	// A particle emitter animates while hovered, and only then -- see `particle-tile-preview`.
	const particleHover = useParticleHover(!!meta.particles);

	// A sound has no pixels, so the whole art half of a tile means something else for it:
	// audition instead of thumbnail, length instead of dimensions, and no image editor.
	const isSound = meta.kind === 'sound';
	// Backgrounds replace `bg:`, objects become an entry under `props:`, sounds replace the
	// scene's `music:` -- dropped on a SCENE, a sound is "this scene sounds like this", the
	// same rule as a sound file dropped from the desktop. Only the NAME travels -- scene
	// YAML addresses assets by name, and `a_8f21` is unwritable. An `fx` asset is not
	// draggable: `fx:` is a list of effects on the whole stage, not something with a
	// position, so there is nowhere on the stage for it to land.
	// An `fx` asset is a particle emitter: placed like a prop, drawn as particles.
	const dragPayload: AssetDragPayload | undefined =
		meta.kind === 'bg' || meta.kind === 'object' || meta.kind === 'fx' || isSound
			? {
					label: meta.name,
					ref: meta.name,
					target: isSound ? 'music' : meta.kind === 'bg' ? 'bg' : 'prop'
			  }
			: undefined;

	React.useEffect(() => {
		if (focused) {
			tileRef.current?.scrollIntoView({block: 'nearest'});
		}
	}, [focused]);

	React.useEffect(() => {
		if (renameRequest === undefined) {
			return;
		}

		setDraftName(meta.name);
		setRenameOpen(true);

		// The prompt's focus trap focuses the field once the card mounts; selecting it
		// makes the stand-in name one keystroke to replace.
		const frame = window.requestAnimationFrame(() =>
			tileRef.current
				?.querySelector<HTMLInputElement>('.card-button-card input')
				?.select()
		);

		return () => window.cancelAnimationFrame(frame);
		// Keyed on the request alone.
	}, [renameRequest]);

	// Something else renamed this--a sync pull, the image editor's own title. The draft
	// is stale at that point, so it follows rather than overwriting.
	React.useEffect(() => setDraftName(meta.name), [meta.name]);

	// Scene YAML addresses assets by NAME, so a rename is the one edit here that can
	// break a scene. Two names in one namespace is refused outright (the store throws
	// anyway); a name scenes already write is allowed, and said out loud: those scenes
	// follow the new name.
	const validateName = React.useCallback(
		(value: string): PromptValidationResponse => {
			const trimmed = value.trim();

			if (trimmed === '') {
				return {message: t('dialogs.slidersAssets.renameEmpty'), valid: false};
			}

			if (trimmed !== meta.name && nameTaken?.(trimmed)) {
				return {
					message: t('dialogs.slidersAssets.renameTaken', {name: trimmed}),
					valid: false
				};
			}

			if (trimmed !== meta.name && usedIn && usedIn.length > 0) {
				return {
					message: t('dialogs.slidersAssets.renameUsed', {
						count: usedIn.length,
						names: usedIn.join(', '),
						old: meta.name
					}),
					valid: true
				};
			}

			return {valid: true};
		},
		[meta.name, nameTaken, t, usedIn]
	);

	return (
		<div
			className={`sliders-tile${focused ? ' focused' : ''}`}
			data-asset-id={meta.id}
			onClickCapture={onModClick}
			draggable={!!dragPayload || !!menuItems}
			onDragStart={event => {
				// Any tile can land on a collection in the Library rail (move, Alt = copy).
				event.dataTransfer.setData(LIBRARY_ASSET_MIME, meta.id);
				onDragOut?.();

				if (dragPayload) {
					// A sound pastes its `music:` line into the passage text, matching what
					// it writes on the stage. The one-shot `- sfx:` beat is the copy button.
					setAssetDragData(
						event.dataTransfer,
						dragPayload,
						isSound ? musicFragment(meta) : assetFragment(meta)
					);
				}
			}}
			ref={tileRef}
			title={
				isSound
					? t('dialogs.slidersAssets.dragSoundToScene')
					: dragPayload
					? t('dialogs.slidersAssets.dragToStage')
					: undefined
			}
		>
			{/* A corner ribbon over the art, not a badge under it: the badge cost every tile in
			    the grid row a line of height. */}
			{unreferenced && (
				<div className="sliders-tile-ribbon">
					<span title={t('dialogs.slidersAssets.unreferencedTitle')}>
						{t('dialogs.slidersAssets.unreferenced')}
					</span>
				</div>
			)}
			<div
				className="sliders-tile-art"
				onPointerEnter={particleHover.onPointerEnter}
				onPointerLeave={particleHover.onPointerLeave}
				ref={artRef}
				// The button below says the same thing, but the picture is what an author
				// points at. Animated art has no editor to open, and a sound has no pixels.
				onDoubleClick={isSound || meta.animated ? undefined : onEdit}
				title={
					isSound || meta.animated
						? undefined
						: t('dialogs.slidersAssets.editImageHint')
				}
			>
				{isSound ? (
					<SoundPreview
						assetId={meta.id}
						duration={meta.duration}
						name={meta.name}
					/>
				) : (
					<>
						{/* Only when the asset carries one: a cross on every default-anchored
						    tile is nine crosses saying nothing. */}
						<AssetPreview alt={meta.name} assetId={meta.id} origin={meta.origin} />
						{particleHover.live && (
							<ParticleTilePreview
								height={artRef.current?.offsetHeight || 120}
								meta={meta}
							/>
						)}
						{/* Dimensions only. Bytes and format are in the tooltip: the pixel size
						    is what an author checks against the stage, the rest is
						    housekeeping. */}
						<span
							className="sliders-tile-size"
							title={t('dialogs.slidersAssets.assetDetail', {
								width: meta.w,
								height: meta.h,
								size: formatBytes(meta.bytes),
								format: meta.mime.replace(/^image\//, '')
							})}
						>
							{meta.w}×{meta.h}
						</span>
					</>
				)}
			</div>
			<div
				className="sliders-tile-name"
				onDoubleClick={() => setRenameOpen(true)}
				title={t('dialogs.slidersAssets.renameHint')}
			>
				{meta.name}
			</div>
			<TileUses passages={usedIn ?? []} />
			<div className="sliders-tile-badges">
				{badges}
				{meta.animated && <Badge label={t('dialogs.slidersAssets.animated')} />}
				{meta.tags.map(tag => (
					<Badge key={tag} label={tag} />
				))}
			</div>
			<ButtonBar>
				{isSound ? (
					// The other half of the pair the tile hands out. The drag writes the
					// scene's looping bed; this copies the one-shot beat, which belongs on a
					// beat the author picks, so it is pasted where they put the cursor.
					<IconButton
						icon={<IconMusic />}
						iconOnly
						label={t('dialogs.slidersAssets.copySfxLine')}
						onClick={() => void copyText(assetFragment(meta))}
					/>
				) : (
					<IconButton
						// Editing an animation would flatten it to one image.
						disabled={meta.animated}
						icon={<IconPhotoEdit />}
						iconOnly
						label={
							meta.animated
								? t('dialogs.slidersAssets.editImageAnimated')
								: t('dialogs.slidersAssets.editImage')
						}
						onClick={onEdit}
					/>
				)}
				<PromptButton
					icon={<IconWriting />}
					iconOnly
					label={t('common.rename')}
					onChange={event => setDraftName(event.target.value)}
					onChangeOpen={setRenameOpen}
					onSubmit={value => onRename(value.trim())}
					open={renameOpen}
					prompt={t('common.renamePrompt', {name: meta.name})}
					validate={validateName}
					value={draftName}
				/>
				<TagCardButton
					allTags={allTags}
					iconOnly
					id={`asset-tag-input-${meta.id}`}
					onAdd={tag => onChangeTags([...meta.tags, tag])}
					onRemove={tag => onChangeTags(meta.tags.filter(t => t !== tag))}
					tags={meta.tags}
				/>
				{menuItems ? (
					<MenuButton
						icon={<IconDots />}
						iconOnly
						items={[
							{
								disabled: isSound || meta.animated,
								label: t('dialogs.library.menu.edit'),
								onClick: onEdit
							},
							{
								label: t('common.rename'),
								onClick: () => setRenameOpen(true)
							},
							...menuItems
						]}
						label={t('dialogs.library.menu.more', {name: meta.name})}
					/>
				) : (
					<ConfirmButton
						confirmVariant="danger"
						icon={<IconTrash />}
						iconOnly
						label={t('common.delete')}
						onConfirm={onDelete}
						prompt={t('dialogs.slidersAssets.deletePrompt', {name: meta.name})}
					/>
				)}
			</ButtonBar>
		</div>
	);
};
