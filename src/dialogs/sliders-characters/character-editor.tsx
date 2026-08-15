import {slugify} from '@sliders/asset-store';
import {AssetId, AssetMeta, Character, Frac2} from '@sliders/scene-types';
import {IconCrosshair, IconTrash} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {CardContent} from '../../components/container/card';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {TextInput} from '../../components/control/text-input';
import {TextSelect} from '../../components/control/text-select';
import {useCommand} from '../../hotkeys';
import {FrameList} from './frame-list';
import {SpritePreview} from './sprite-preview';

export interface CharacterEditorProps {
	assets: Record<AssetId, AssetMeta>;
	character: Character;
	onChange: (character: Character) => void;
	/** Write the current character out immediately, rather than on the usual debounce. */
	onCommit: () => void;
	onUploadFrames: (files: File[]) => void;
}

function parseSize(value: string, fallback: number): number {
	const parsed = Number.parseInt(value, 10);

	return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const CharacterEditor: React.FC<CharacterEditorProps> = props => {
	const {assets, character, onChange, onCommit, onUploadFrames} = props;
	const frameNames = Object.keys(character.frames);
	const [newAnchor, setNewAnchor] = React.useState('');
	const [newAnchorOpen, setNewAnchorOpen] = React.useState(false);
	const [onion, setOnion] = React.useState('');
	const [selectedFrame, setSelectedFrame] = React.useState<string | undefined>(
		frameNames[0]
	);
	const {t} = useTranslation();

	// Keep the selection valid as frames come and go.
	React.useEffect(() => {
		if (frameNames.length > 0 && (!selectedFrame || !character.frames[selectedFrame])) {
			setSelectedFrame(frameNames[0]);
		}
	}, [character.frames, frameNames, selectedFrame]);

	const activeFrame = selectedFrame ? character.frames[selectedFrame] : undefined;

	useCommand({
		id: 'slidersCharacters.addAnchor',
		label: t('hotkeys.commands.slidersCharacters.addAnchor'),
		run: () => setNewAnchorOpen(true),
		scope: 'sliders-characters'
	});

	function handleChangeAnchor(name: string, value: Frac2) {
		onChange({...character, anchors: {...character.anchors, [name]: value}});
	}

	function handleAddAnchor(name: string) {
		const key = slugify(name);

		setNewAnchor('');
		handleChangeAnchor(key, {x: 0.5, y: 0.5});
	}

	function handleRemoveAnchor(name: string) {
		const anchors = {...character.anchors};

		delete anchors[name];
		onChange({...character, anchors});
	}

	function handleRenameFrame(name: string, newName: string) {
		const key = slugify(newName);

		if (!key || key === name || character.frames[key]) {
			return;
		}

		const frames: Character['frames'] = {};

		// Rebuild in order, so the first frame stays first.
		for (const [existingName, frame] of Object.entries(character.frames)) {
			frames[existingName === name ? key : existingName] = frame;
		}

		onChange({...character, frames});

		if (selectedFrame === name) {
			setSelectedFrame(key);
		}
	}

	function handleDeleteFrame(name: string) {
		const frames = {...character.frames};

		delete frames[name];
		onChange({...character, frames});
	}

	function handleChangeLoop(name: string, loop: boolean) {
		onChange({
			...character,
			frames: {...character.frames, [name]: {...character.frames[name], loop}}
		});
	}

	return (
		<div className="character-editor">
			<div className="character-editor-body">
				<FrameList
					assets={assets}
					frames={character.frames}
					onAddFiles={onUploadFrames}
					onChangeLoop={handleChangeLoop}
					onDelete={handleDeleteFrame}
					onRename={handleRenameFrame}
					onSelect={setSelectedFrame}
					selected={selectedFrame}
				/>
				<div className="character-editor-stage">
					<SpritePreview
						anchors={character.anchors}
						assetId={activeFrame?.asset}
						onChangeAnchor={handleChangeAnchor}
						onChangeOrigin={origin => onChange({...character, origin})}
						onCommit={onCommit}
						onionAssetId={onion ? character.frames[onion]?.asset : undefined}
						origin={character.origin}
						size={character.size}
					/>
					<ButtonBar>
						<TextSelect
							onChange={event => setOnion(event.target.value)}
							options={[
								{label: t('dialogs.slidersCharacters.noOnionSkin'), value: ''},
								...frameNames
									.filter(name => name !== selectedFrame)
									.map(name => ({label: name, value: name}))
							]}
							value={onion}
						>
							{t('dialogs.slidersCharacters.onionSkin')}
						</TextSelect>
						<PromptButton
							icon={<IconCrosshair />}
							label={t('dialogs.slidersCharacters.addAnchor')}
							onChange={event => setNewAnchor(event.target.value)}
							onChangeOpen={setNewAnchorOpen}
							onSubmit={handleAddAnchor}
							open={newAnchorOpen}
							prompt={t('dialogs.slidersCharacters.addAnchorPrompt')}
							value={newAnchor}
						/>
					</ButtonBar>
				</div>
			</div>
			<CardContent>
				<div className="character-editor-fields">
					<TextInput
						onChange={event => onChange({...character, name: event.target.value})}
						orientation="vertical"
						value={character.name}
					>
						{t('dialogs.slidersCharacters.name')}
					</TextInput>
					<TextInput
						onChange={event =>
							onChange({
								...character,
								size: {
									...character.size,
									w: parseSize(event.target.value, character.size.w)
								}
							})
						}
						orientation="vertical"
						value={String(character.size.w)}
					>
						{t('dialogs.slidersCharacters.width')}
					</TextInput>
					<TextInput
						onChange={event =>
							onChange({
								...character,
								size: {
									...character.size,
									h: parseSize(event.target.value, character.size.h)
								}
							})
						}
						orientation="vertical"
						value={String(character.size.h)}
					>
						{t('dialogs.slidersCharacters.height')}
					</TextInput>
					<TextInput
						onChange={event =>
							onChange({
								...character,
								tags: event.target.value
									.split(',')
									.map(tag => tag.trim())
									.filter(Boolean)
							})
						}
						orientation="vertical"
						value={character.tags.join(', ')}
					>
						{t('common.tags')}
					</TextInput>
				</div>
				<dl className="character-editor-readout">
					<dt>{t('dialogs.slidersCharacters.origin')}</dt>
					<dd data-readout="origin">
						{character.origin.x.toFixed(3)}, {character.origin.y.toFixed(3)}
					</dd>
					{Object.entries(character.anchors).map(([name, value]) => (
						<React.Fragment key={name}>
							<dt>{name}</dt>
							<dd data-readout={`anchor:${name}`}>
								{value.x.toFixed(3)}, {value.y.toFixed(3)}
								<IconButton
									icon={<IconTrash />}
									iconOnly
									label={t('dialogs.slidersCharacters.removeAnchor', {name})}
									onClick={() => handleRemoveAnchor(name)}
								/>
							</dd>
						</React.Fragment>
					))}
				</dl>
			</CardContent>
		</div>
	);
};
