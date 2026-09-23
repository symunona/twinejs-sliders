import {anchorNames, slugify} from '@sliders/asset-store';
import {
	AssetId,
	AssetMeta,
	BUBBLE_PLACES,
	BUBBLE_PRESETS,
	BubblePlace,
	BubbleStyle,
	Character,
	CharacterPose,
	DEFAULT_FIT,
	Frac2,
	DEFAULT_STEP_SECONDS,
	PoseFit,
	PoseStep,
	poseCover
} from '@sliders/scene-types';
import {
	IconArrowBackUp,
	IconCopy,
	IconCrosshair,
	IconTrash
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {Tab, TabList, TabPanel, Tabs} from 'react-tabs';
import {AnchorSelect} from '../../components/anchor';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {PromptButton} from '../../components/control/prompt-button';
import {TextInput} from '../../components/control/text-input';
import {TextSelect} from '../../components/control/text-select';
import {useCommand} from '../../hotkeys';
import {AdjustSlider} from '../asset-editor/adjust-slider';
import {UploadDropZone} from '../sliders-assets/upload-drop-zone';
import {PoseList} from './pose-list';
import {setStepFit, stepFit, stepFitToAll, stepsOf} from './pose-steps';
import {SpritePreview, SpriteGhost} from './sprite-preview';
import {StepStrip} from './step-strip';

/** What the box reset buttons go back to--the size a new character starts at. */
const DEFAULT_SIZE = {h: 1024, w: 512};

export interface CharacterEditorProps {
	assets: Record<AssetId, AssetMeta>;
	character: Character;
	onChange: (character: Character) => void;
	/** Write the current character out immediately, rather than on the usual debounce. */
	onCommit: () => void;
	/** Open the asset editor on a pose's image — cropping, levels, background removal. */
	onEditPose: (name: string) => void;
	/** Upload files and append them to a pose's steps. */
	onAddSteps: (name: string, files: File[]) => void;
	/** Opens Import set, with files if some were already chosen. */
	onImportSet: (files?: File[]) => void;
	onUploadPoses: (files: File[]) => void;
	/**
	 * "Open on this pose" — a ctrl-click on a `pose:` in a passage. Carries a serial rather
	 * than only a name so that asking twice for the same pose selects it twice: the author
	 * may have clicked something else in between.
	 */
	selectPose?: {name: string; serial: number};
}

/**
 * Which step of a pose the preview is on while it plays. Restarts when the steps change;
 * `loop: false` holds the last one. Stopped (index 0) when `running` is false.
 */
function useStepClock(
	steps: PoseStep[],
	loop: boolean,
	running: boolean
): number {
	const [index, setIndex] = React.useState(0);
	const key = steps.map(step => `${step.asset}:${step.dur ?? ''}`).join('|');

	React.useEffect(() => {
		setIndex(0);

		if (!running || steps.length < 2) {
			return;
		}

		let current = 0;
		let timer: number | undefined;

		function schedule() {
			const seconds = steps[current]?.dur ?? DEFAULT_STEP_SECONDS;

			timer = window.setTimeout(() => {
				if (current === steps.length - 1 && !loop) {
					return;
				}

				current = (current + 1) % steps.length;
				setIndex(current);
				schedule();
			}, Math.max(16, seconds * 1000));
		}

		schedule();

		return () => window.clearTimeout(timer);
		// `key` stands in for `steps`, whose identity changes on every draft edit.
	}, [key, loop, running]);

	return index;
}

/**
 * One key of a character's bubble defaults, with the whole `bubble:` dropped once nothing
 * is left in it — an empty map in the manifest would say "this character has opinions"
 * when it has none.
 */
function withBubble(character: Character, patch: Partial<BubbleStyle>): Character {
	const bubble: BubbleStyle = {...character.bubble, ...patch};

	for (const key of Object.keys(bubble) as (keyof BubbleStyle)[]) {
		if (bubble[key] === undefined) {
			delete bubble[key];
		}
	}

	return Object.keys(bubble).length > 0
		? {...character, bubble}
		: {...character, bubble: undefined};
}

export const CharacterEditor: React.FC<CharacterEditorProps> = props => {
	const {
		assets,
		character,
		onAddSteps,
		onChange,
		onCommit,
		onEditPose,
		onImportSet,
		onUploadPoses,
		selectPose
	} = props;
	const poseNames = Object.keys(character.poses);
	const [newAnchor, setNewAnchor] = React.useState('');
	const [newAnchorOpen, setNewAnchorOpen] = React.useState(false);
	/** Poses drawn faintly behind the selected one, so poses can be compared at once. */
	const [ghosts, setGhosts] = React.useState<string[]>([]);
	/** True while a click on the sprite places the origin. Same control as the asset editor. */
	const [picking, setPicking] = React.useState(false);
	const [selectedPose, setSelectedPose] = React.useState<string | undefined>(
		selectPose && character.poses[selectPose.name] ? selectPose.name : poseNames[0]
	);
	const {t} = useTranslation();

	// Keep the selection valid as poses come and go.
	React.useEffect(() => {
		if (poseNames.length > 0 && (!selectedPose || !character.poses[selectedPose])) {
			setSelectedPose(poseNames[0]);
		}
	}, [character.poses, poseNames, selectedPose]);

	// Keyed on the serial, not the name: the character can arrive after the request does,
	// and a pose the author asked for twice must be selected both times. A pose this
	// character does not have is left alone -- the scene names poses that may not exist yet.
	const requestedPose = selectPose?.name;
	const requestedSerial = selectPose?.serial;

	React.useEffect(() => {
		if (requestedPose && character.poses[requestedPose]) {
			setSelectedPose(requestedPose);
		}
	}, [character.poses, requestedPose, requestedSerial]);

	const activePose = selectedPose ? character.poses[selectedPose] : undefined;
	/** A step picked in the strip. Undefined = the pose plays in the preview. */
	const [selectedStep, setSelectedStep] = React.useState<number>();
	const activeSteps = activePose ? stepsOf(activePose) : [];
	const hasSteps = !!activePose?.steps && activePose.steps.length > 1;
	const clock = useStepClock(
		activeSteps,
		activePose?.loop !== false,
		hasSteps && selectedStep === undefined
	);
	const shownStep = hasSteps ? selectedStep ?? clock : undefined;
	const animatedFile =
		!!activePose?.asset && !!assets[activePose.asset]?.animated;

	// A new pose, or a step list that shrank under the selection, starts from playing.
	React.useEffect(() => {
		setSelectedStep(undefined);
	}, [selectedPose]);

	React.useEffect(() => {
		if (selectedStep !== undefined && selectedStep >= activeSteps.length) {
			setSelectedStep(undefined);
		}
	}, [activeSteps.length, selectedStep]);
	// What the sprite preview draws and what the readout lists: this POSE's rig. The
	// character has no rig of its own — a pose is what decides where a mouth is.
	const activeAnchors = activePose?.anchors ?? {};

	useCommand({
		enabled: !!selectedPose,
		id: 'slidersCharacters.addAnchor',
		label: t('hotkeys.commands.slidersCharacters.addAnchor'),
		run: () => setNewAnchorOpen(true),
		scope: 'sliders-characters'
	});

	/** Dragging an anchor moves it on the SELECTED pose and nowhere else. */
	function handleChangeAnchor(name: string, value: Frac2) {
		if (!selectedPose || !activePose) {
			return;
		}

		onChange({
			...character,
			poses: {
				...character.poses,
				[selectedPose]: {
					...activePose,
					anchors: {...activeAnchors, [name]: value}
				}
			}
		});
	}

	/**
	 * Adding and removing, unlike dragging, apply to EVERY pose.
	 *
	 * Positions are per pose; the set of names is not. A scene that says `mouth` has no
	 * idea which pose will be showing when it is drawn, so an anchor that existed on the
	 * idle pose and not on the angry one would work until the character got angry.
	 */
	function forEachPoseAnchors(
		change: (anchors: Record<string, Frac2>) => Record<string, Frac2>
	) {
		const poses: Character['poses'] = {};

		for (const [name, pose] of Object.entries(character.poses)) {
			poses[name] = {...pose, anchors: change({...(pose.anchors ?? {})})};
		}

		onChange({...character, poses});
	}

	function handleAddAnchor(name: string) {
		const key = slugify(name);

		setNewAnchor('');

		if (!key) {
			return;
		}

		// Seeded at the middle of the box on every pose. Placing it once per pose is the
		// point of the feature, so there is nothing better to guess.
		forEachPoseAnchors(anchors => ({...anchors, [key]: {x: 0.5, y: 0.5}}));
	}

	function handleRemoveAnchor(name: string) {
		forEachPoseAnchors(anchors => {
			delete anchors[name];

			return anchors;
		});
	}

	/**
	 * The rig that fitted one pose is usually close for the rest — the same favour
	 * `fitToAllPoses` does for registration.
	 */
	function handleApplyAnchorsToAll() {
		if (!activePose) {
			return;
		}

		forEachPoseAnchors(() =>
			Object.fromEntries(
				Object.entries(activeAnchors).map(([name, value]) => [name, {...value}])
			)
		);
		onCommit();
	}

	function handleRenamePose(name: string, newName: string) {
		const key = slugify(newName);

		if (!key || key === name || character.poses[key]) {
			return;
		}

		const poses: Character['poses'] = {};

		// Rebuild in order, so the first pose stays first.
		for (const [existingName, pose] of Object.entries(character.poses)) {
			poses[existingName === name ? key : existingName] = pose;
		}

		onChange({...character, poses});

		if (selectedPose === name) {
			setSelectedPose(key);
		}
	}

	function handleDeletePose(name: string) {
		const poses = {...character.poses};

		delete poses[name];
		onChange({...character, poses});
	}

	function handleChangeLoop(name: string, loop: boolean) {
		onChange({
			...character,
			poses: {...character.poses, [name]: {...character.poses[name], loop}}
		});
	}

	function handleChangeFit(fit: PoseFit) {
		if (!selectedPose) {
			return;
		}

		// A picked step keeps its own fit: sheet cells drift one by one.
		if (hasSteps && selectedStep !== undefined) {
			onChange({
				...character,
				poses: {
					...character.poses,
					[selectedPose]: setStepFit(
						character.poses[selectedPose],
						selectedStep,
						fit
					)
				}
			});
			return;
		}

		// Identity is stored as absent, so a pose nudged back to zero reads the same as
		// one never touched--and the manifest stays free of no-op entries.
		const identity = fit.offset.x === 0 && fit.offset.y === 0 && fit.scale === 1;
		const pose: CharacterPose = {...character.poses[selectedPose]};

		if (identity) {
			delete pose.fit;
		} else {
			pose.fit = fit;
		}

		onChange({
			...character,
			poses: {...character.poses, [selectedPose]: pose}
		});
	}

	/**
	 * A sprite sheet is usually off by the same amount throughout, so the fit that fixed
	 * one pose normally fixes all of them.
	 */
	function handleApplyFitToAll() {
		if (!activePose) {
			return;
		}

		const poses: Character['poses'] = {};

		for (const [name, pose] of Object.entries(character.poses)) {
			poses[name] = {...pose};

			if (activePose.fit) {
				poses[name].fit = {...activePose.fit, offset: {...activePose.fit.offset}};
			} else {
				delete poses[name].fit;
			}
		}

		onChange({...character, poses});
		onCommit();
	}

	function handleStepFitToAll() {
		if (!selectedPose || !activePose || selectedStep === undefined) {
			return;
		}

		onChange({
			...character,
			poses: {
				...character.poses,
				[selectedPose]: stepFitToAll(activePose, selectedStep)
			}
		});
		onCommit();
	}

	function handleChangePose(pose: CharacterPose) {
		if (!selectedPose) {
			return;
		}

		onChange({...character, poses: {...character.poses, [selectedPose]: pose}});
	}

	function handleToggleGhost(name: string) {
		setGhosts(current =>
			current.includes(name)
				? current.filter(ghost => ghost !== name)
				: [...current, name]
		);
	}

	// The selected pose draws itself in full, so it is never also a ghost of itself.
	const ghostPoses: SpriteGhost[] = ghosts
		.filter(name => name !== selectedPose && character.poses[name])
		.map(name => ({
			assetId: poseCover(character.poses[name]),
			fit: stepFit(character.poses[name], 0),
			name
		}));

	// Onion skin: a picked step shows the one before it, faintly, underneath. The first
	// step of a looping pose follows the last.
	if (activePose && hasSteps && selectedStep !== undefined) {
		const previous =
			selectedStep > 0
				? selectedStep - 1
				: activePose.loop !== false
				? activeSteps.length - 1
				: undefined;

		if (previous !== undefined && previous !== selectedStep) {
			ghostPoses.unshift({
				assetId: activeSteps[previous].asset,
				fit: stepFit(activePose, previous),
				name: `step:${previous}`
			});
		}
	}

	// What the stage draws: the step on show, with the fit it plays with.
	const shownAsset =
		shownStep !== undefined ? activeSteps[shownStep]?.asset : poseCover(activePose);
	const shownFit =
		activePose && shownStep !== undefined
			? stepFit(activePose, shownStep)
			: activePose?.fit;
	// Panning while the pose plays would write the POSE fit, which every step with its own
	// fit ignores. Pick a step to fit it.
	const canFit = !hasSteps || selectedStep !== undefined;

	return (
		<div className="character-editor">
			{/* One drop target over the whole editor, pose list and stage alike. The stage
			    is the obvious thing to aim a sprite at, and whatever the app does not take
			    as a drop the BROWSER takes instead--it navigates to the file and the app is
			    gone. */}
			<UploadDropZone
				floatingHint
				label={t('dialogs.slidersCharacters.dropPoses')}
				onDrop={onUploadPoses}
			>
				<div className="character-editor-body">
					<PoseList
						assets={assets}
						poses={character.poses}
						onAddFiles={onUploadPoses}
						onChangeLoop={handleChangeLoop}
						onImportSet={() => onImportSet()}
						onDelete={handleDeletePose}
						onEdit={onEditPose}
						onRename={handleRenamePose}
						onSelect={setSelectedPose}
						onToggleGhost={handleToggleGhost}
						selected={selectedPose}
						visible={ghosts}
					/>
					<div className="character-editor-stage">
						<SpritePreview
							anchors={activeAnchors}
							assetId={shownAsset}
							fit={shownFit}
							onChangeAnchor={handleChangeAnchor}
							onChangeFit={canFit ? handleChangeFit : undefined}
							onChangeOrigin={origin => onChange({...character, origin})}
							onCommit={onCommit}
							ghosts={ghostPoses}
							onPickEnd={() => setPicking(false)}
							origin={character.origin}
							picking={picking}
							size={character.size}
						/>
						{activePose && selectedPose && !animatedFile && (
							<StepStrip
								name={selectedPose}
								onAddFiles={files => onAddSteps(selectedPose, files)}
								onChange={handleChangePose}
								onCommit={onCommit}
								onSelect={setSelectedStep}
								pose={activePose}
								selected={hasSteps ? selectedStep : undefined}
								shown={shownStep}
							/>
						)}
					</div>
				</div>
			</UploadDropZone>
			{/* Everything under the stage, in groups that say what they act on. Anchors and
			    the pose fit both move things around on the same picture, and side by side
			    in one row nothing said which was which. */}
			<Tabs
				className="react-tabs character-editor-groups"
				selectedTabClassName="selected"
			>
				<TabList className="sliders-tablist">
					<Tab className="sliders-tab">
						{t('dialogs.slidersCharacters.groupAnchors')}
					</Tab>
					<Tab className="sliders-tab">
						{t('dialogs.slidersCharacters.groupFit')}
					</Tab>
					<Tab className="sliders-tab">
						{t('dialogs.slidersCharacters.groupBox')}
					</Tab>
					<Tab className="sliders-tab">
						{t('dialogs.slidersCharacters.groupDetails')}
					</Tab>
				</TabList>
				<TabPanel>
					<div className="character-editor-group character-editor-anchors">
						<div className="character-editor-anchor">
							<AnchorSelect
								onChange={origin => {
									onChange({...character, origin});
									onCommit();
								}}
								onChangePicking={setPicking}
								origin={character.origin}
								pickHint={t('dialogs.slidersCharacters.originHint')}
								picking={picking}
							/>
							<p className="character-editor-note">
								{t('dialogs.slidersCharacters.originNote')}
							</p>
						</div>
						<div className="character-editor-rig">
							<ButtonBar>
								<PromptButton
									commandId="slidersCharacters.addAnchor"
									disabled={!activePose}
									icon={<IconCrosshair />}
									label={t('dialogs.slidersCharacters.addAnchor')}
									onChange={event => setNewAnchor(event.target.value)}
									onChangeOpen={setNewAnchorOpen}
									onSubmit={handleAddAnchor}
									open={newAnchorOpen}
									prompt={t('dialogs.slidersCharacters.addAnchorPrompt')}
									value={newAnchor}
								/>
								<IconButton
									disabled={!activePose || poseNames.length < 2}
									icon={<IconCopy />}
									label={t('dialogs.slidersCharacters.anchorsToAllPoses')}
									onClick={handleApplyAnchorsToAll}
								/>
							</ButtonBar>
							<dl className="character-editor-readout">
								<dt>{t('dialogs.slidersCharacters.origin')}</dt>
								<dd data-readout="origin">
									{character.origin.x.toFixed(3)},{' '}
									{character.origin.y.toFixed(3)}
								</dd>
								{/* This pose's rig. Another pose's `mouth` is somewhere else,
								    which is the whole point of anchors living on poses. */}
								{anchorNames(character).map(name => {
									const value = activeAnchors[name];

									return (
										<React.Fragment key={name}>
											<dt>{name}</dt>
											<dd data-readout={`anchor:${name}`}>
												{value
													? `${value.x.toFixed(3)}, ${value.y.toFixed(3)}`
													: t('dialogs.slidersCharacters.anchorUnplaced')}
												<IconButton
													icon={<IconTrash />}
													iconOnly
													label={t('dialogs.slidersCharacters.removeAnchor', {
														name
													})}
													onClick={() => handleRemoveAnchor(name)}
												/>
											</dd>
										</React.Fragment>
									);
								})}
							</dl>
						</div>
					</div>
				</TabPanel>
				<TabPanel>
					<div className="character-editor-group character-editor-fit">
						{activePose ? (
							<>
								{hasSteps && (
									<p className="character-editor-note" data-fit-target>
										{selectedStep === undefined
											? t('dialogs.slidersCharacters.steps.fitWholePose')
											: t('dialogs.slidersCharacters.steps.fitStep', {
													index: selectedStep + 1
											  })}
									</p>
								)}
								<AdjustSlider
									editable
									label={t('dialogs.slidersCharacters.poseScale')}
									max={3}
									min={0.2}
									onChange={scale =>
										handleChangeFit({...(shownFit ?? DEFAULT_FIT), scale})
									}
									resetLabel={t('dialogs.slidersCharacters.resetPoseScale')}
									resetTo={DEFAULT_FIT.scale}
									step={0.01}
									value={shownFit?.scale ?? DEFAULT_FIT.scale}
								/>
								<ButtonBar>
									<IconButton
										disabled={!shownFit}
										icon={<IconArrowBackUp />}
										label={t('dialogs.slidersCharacters.resetFit')}
										onClick={() => handleChangeFit(DEFAULT_FIT)}
									/>
									{hasSteps && selectedStep !== undefined && (
										<IconButton
											icon={<IconCopy />}
											label={t('dialogs.slidersCharacters.steps.fitToAllSteps')}
											onClick={handleStepFitToAll}
										/>
									)}
									<IconButton
										disabled={poseNames.length < 2}
										icon={<IconCopy />}
										label={t('dialogs.slidersCharacters.fitToAllPoses')}
										onClick={handleApplyFitToAll}
									/>
								</ButtonBar>
								<p className="character-editor-note">
									{t('dialogs.slidersCharacters.fitNote')}
								</p>
							</>
						) : (
							<p className="character-editor-note">
								{t('dialogs.slidersCharacters.noPose')}
							</p>
						)}
					</div>
				</TabPanel>
				<TabPanel>
					<div className="character-editor-group character-editor-box">
						{/* Sliders, not boxes: these are the character's own rectangle in scene
						    units, shared by every pose, and a typed number gave no sense of
						    how big that is next to the art. */}
						<AdjustSlider
							editable
							label={t('dialogs.slidersCharacters.width')}
							max={2048}
							min={32}
							onChange={w =>
								onChange({...character, size: {...character.size, w}})
							}
							resetLabel={t('dialogs.slidersCharacters.resetWidth')}
							resetTo={DEFAULT_SIZE.w}
							step={8}
							value={character.size.w}
						/>
						<AdjustSlider
							editable
							label={t('dialogs.slidersCharacters.height')}
							max={2048}
							min={32}
							onChange={h =>
								onChange({...character, size: {...character.size, h}})
							}
							resetLabel={t('dialogs.slidersCharacters.resetHeight')}
							resetTo={DEFAULT_SIZE.h}
							step={8}
							value={character.size.h}
						/>
						<p className="character-editor-note">
							{t('dialogs.slidersCharacters.boxNote')}
						</p>
					</div>
				</TabPanel>
				<TabPanel>
					<div className="character-editor-group character-editor-fields">
						{/* No Name field: the ID in the dialog's title bar is the only name a
						    character has. It is what scene YAML writes, so a second display
						    name only ever drifted from it. */}
						{/* Where this character's lines are painted and parked, unless a beat
						    says otherwise. A narrator is written once here rather than on
						    every line they speak. */}
						<TextSelect
							onChange={event =>
								onChange(
									withBubble(character, {as: event.target.value || undefined})
								)
							}
							options={[
								{
									label: t('dialogs.slidersCharacters.bubbleStyleDefault'),
									value: ''
								},
								...BUBBLE_PRESETS.map(preset => ({label: preset, value: preset}))
							]}
							orientation="vertical"
							value={character.bubble?.as ?? ''}
						>
							{t('dialogs.slidersCharacters.bubbleStyle')}
						</TextSelect>
						<TextSelect
							onChange={event =>
								onChange(
									withBubble(character, {
										place: (event.target.value || undefined) as
											| BubblePlace
											| undefined
									})
								)
							}
							options={BUBBLE_PLACES.map(place => ({label: place, value: place}))}
							orientation="vertical"
							value={character.bubble?.place ?? 'auto'}
						>
							{t('dialogs.slidersCharacters.bubblePlace')}
						</TextSelect>
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
				</TabPanel>
			</Tabs>
		</div>
	);
};
