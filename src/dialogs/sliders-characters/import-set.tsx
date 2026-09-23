import {Character, Frac2, PoseFit} from '@sliders/scene-types';
import {
	IconArrowLeft,
	IconFileImport,
	IconFolder,
	IconX
} from '@tabler/icons';
import classNames from 'classnames';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {IconButton} from '../../components/control/icon-button';
import {TextSelect} from '../../components/control/text-select';
import {
	ImportPose,
	plannedPoseNames
} from '../sliders-assets/character-poses';
import {UploadButton} from '../sliders-assets/upload-button';
import {UploadDropZone} from '../sliders-assets/upload-drop-zone';
import {DecodedImage, decodeImage, readPixels, sliceToBlob} from './import-set-images';
import {
	AlignMode,
	alignFits,
	alphaProfile,
	cellIsEmpty,
	durForFps,
	Feet,
	findFeet,
	GridSpec,
	gridLayout,
	groupFiles,
	guessGrid,
	looksLikeSheet,
	Pixels,
	poseKey
} from './import-set-logic';

/** One image in the review table: a file, or a slice already cut. */
interface ReviewImage {
	animated: boolean;
	blob: Blob;
	feet?: Feet;
	height: number;
	label: string;
	url: string;
	width: number;
}

interface ReviewPose {
	fps: number;
	images: ReviewImage[];
	include: boolean;
	key: string;
	loop: boolean;
	name: string;
}

interface SheetState {
	asSheet: boolean;
	/** Every cell its own still pose, rather than every row one pose. */
	cellsArePoses: boolean;
	decoded: DecodedImage;
	file: File;
	pixels?: Pixels;
	rowNames: string[];
	/** `row:col` of cells the author switched off. */
	skipped: string[];
	spec: GridSpec;
	/** `row:col` of cells that start a new pose within their row. */
	splits: string[];
}

type Stage = 'pick' | 'loading' | 'sheet' | 'review' | 'importing';

export interface ImportSetProps {
	character: Character;
	/** Files handed over by a drop or a picker; skips the pick stage. */
	initialFiles?: File[];
	onCancel: () => void;
	onImport: (set: ImportPose[], faces: 'left' | 'right') => Promise<void>;
}

const IMAGE_EXTENSION = /\.(png|apng|gif|webp|jpe?g|avif|bmp|svg)$/i;

function isImage(file: File): boolean {
	return file.type.startsWith('image/') || IMAGE_EXTENSION.test(file.name);
}

function cellKey(row: number, col: number): string {
	return `${row}:${col}`;
}

function toggle(list: string[], key: string): string[] {
	return list.includes(key) ? list.filter(item => item !== key) : [...list, key];
}

let nextKey = 0;

function reviewPose(name: string, images: ReviewImage[]): ReviewPose {
	return {
		fps: 10,
		images,
		include: true,
		key: `pose-${nextKey++}`,
		loop: true,
		name
	};
}

/** A pose playing in a box shaped like the character's, aligned as it will be saved. */
const ImportPreview: React.FC<{
	box: {w: number; h: number};
	fits: (PoseFit | undefined)[];
	fps: number;
	images: ReviewImage[];
	loop: boolean;
	origin: Frac2;
}> = props => {
	const {box, fits, fps, images, loop, origin} = props;
	const [index, setIndex] = React.useState(0);

	React.useEffect(() => {
		setIndex(0);

		if (images.length < 2 || !(fps > 0)) {
			return;
		}

		const timer = window.setInterval(
			() =>
				setIndex(current =>
					current + 1 < images.length ? current + 1 : loop ? 0 : current
				),
			1000 / fps
		);

		return () => window.clearInterval(timer);
	}, [fps, images, loop]);

	const image = images[Math.min(index, images.length - 1)];
	const fit = fits[Math.min(index, images.length - 1)];
	const originCss = `${origin.x * 100}% ${origin.y * 100}%`;

	return (
		<div
			className="import-set-preview"
			style={{aspectRatio: `${box.w} / ${box.h}`}}
		>
			{image && (
				<img
					alt=""
					src={image.url}
					style={{
						objectPosition: originCss,
						transform: fit
							? `translate(${fit.offset.x * 100}%, ${fit.offset.y * 100}%) scale(${fit.scale})`
							: undefined,
						transformOrigin: originCss
					}}
				/>
			)}
			<div className="import-set-floor" style={{top: `${origin.y * 100}%`}} />
		</div>
	);
};

/**
 * Import set: many files, a folder, a sprite sheet or one animated file into poses at
 * once. Pick → (sheet grid) → review → upload. Nothing is uploaded before Import.
 *
 * Takes over the character editor's area rather than floating over it: a modal inside a
 * dialog inside a stacking context is the z-index trap in `.claude/TRAPS.md`.
 */
export const ImportSet: React.FC<ImportSetProps> = props => {
	const {character, initialFiles, onCancel, onImport} = props;
	const [stage, setStage] = React.useState<Stage>('pick');
	const [sheet, setSheet] = React.useState<SheetState>();
	const [poses, setPoses] = React.useState<ReviewPose[]>([]);
	const [faces, setFaces] = React.useState<'left' | 'right'>(
		character.faces ?? 'right'
	);
	const [align, setAlign] = React.useState<AlignMode>('step');
	const [error, setError] = React.useState<string>();
	const folderInput = React.useRef<HTMLInputElement>(null);
	/** Every object URL made here, revoked on the way out. */
	const urls = React.useRef<string[]>([]);
	const {t} = useTranslation();
	const box = character.size;
	const origin = character.origin;

	React.useEffect(
		() => () => {
			for (const url of urls.current) {
				URL.revokeObjectURL(url);
			}
		},
		[]
	);

	// `webkitdirectory` is not in React's attribute list.
	React.useEffect(() => {
		folderInput.current?.setAttribute('webkitdirectory', '');
	}, []);

	async function decodeTracked(blob: Blob) {
		const decoded = await decodeImage(blob);

		urls.current.push(decoded.url);
		return decoded;
	}

	function reviewImage(blob: Blob, label: string, decoded: DecodedImage): ReviewImage {
		const pixels = decoded.animated
			? undefined
			: readPixels(decoded.image, {h: decoded.height, w: decoded.width, x: 0, y: 0});

		return {
			animated: decoded.animated,
			blob,
			feet: pixels ? findFeet(pixels) : undefined,
			height: decoded.height,
			label,
			url: decoded.url,
			width: decoded.width
		};
	}

	async function loadFiles(chosen: File[]) {
		const files = chosen.filter(isImage);

		setError(undefined);

		if (files.length === 0) {
			setError(t('dialogs.slidersCharacters.importSet.noImages'));
			return;
		}

		setStage('loading');

		try {
			if (files.length === 1) {
				const [file] = files;
				const decoded = await decodeTracked(file);

				// One animated file is one pose that plays itself — today's behaviour.
				if (decoded.animated) {
					setPoses([
						reviewPose(poseKey(file.name, character.id).pose, [
							reviewImage(file, file.name, decoded)
						])
					]);
					setSheet(undefined);
					setStage('review');
					return;
				}

				const pixels = readPixels(decoded.image, {
					h: decoded.height,
					w: decoded.width,
					x: 0,
					y: 0
				});
				const guess = guessGrid(
					decoded,
					pixels
						? {x: alphaProfile(pixels, 'x'), y: alphaProfile(pixels, 'y')}
						: undefined,
					box
				);

				setSheet({
					asSheet: looksLikeSheet(decoded, box),
					cellsArePoses: false,
					decoded,
					file,
					pixels,
					rowNames: [],
					skipped: [],
					spec: {
						by: 'count',
						cellH: Math.floor(decoded.height / guess.rows),
						cellW: Math.floor(decoded.width / guess.cols),
						cols: guess.cols,
						margin: 0,
						rows: guess.rows,
						spacing: 0
					},
					splits: []
				});
				setStage('sheet');
				return;
			}

			const groups = groupFiles(files, character.id);
			const next: ReviewPose[] = [];

			for (const group of groups) {
				const images: ReviewImage[] = [];

				for (const file of group.items) {
					images.push(reviewImage(file, file.name, await decodeTracked(file)));
				}

				next.push(reviewPose(group.name, images));
			}

			setSheet(undefined);
			setPoses(next);
			setStage('review');
		} catch (caught) {
			setError((caught as Error).message);
			setStage('pick');
		}
	}

	// Files handed over by a drop onto the editor.
	React.useEffect(() => {
		if (initialFiles && initialFiles.length > 0) {
			void loadFiles(initialFiles);
		}
		// Once, for the files the panel was opened with.
	}, []);

	const layout = sheet?.asSheet ? gridLayout(sheet.decoded, sheet.spec) : undefined;

	function rowName(row: number): string {
		const typed = sheet?.rowNames[row];

		if (typed) {
			return typed;
		}

		return row === 0 && !character.poses.idle ? 'idle' : `row-${row + 1}`;
	}

	function emptyCell(rect: {x: number; y: number; w: number; h: number}): boolean {
		return !!sheet?.pixels && cellIsEmpty(sheet.pixels, rect);
	}

	function updateSpec(patch: Partial<GridSpec>) {
		setSheet(current =>
			current ? {...current, spec: {...current.spec, ...patch}} : current
		);
	}

	/** Cut the grid into poses: one per row, split where the author said. */
	async function sliceSheet() {
		if (!sheet) {
			return;
		}

		setStage('loading');

		try {
			if (!sheet.asSheet) {
				setPoses([
					reviewPose(poseKey(sheet.file.name, character.id).pose, [
						reviewImage(sheet.file, sheet.file.name, sheet.decoded)
					])
				]);
				setStage('review');
				return;
			}

			const grid = gridLayout(sheet.decoded, sheet.spec);
			const next: ReviewPose[] = [];

			for (let row = 0; row < grid.rows; row++) {
				let current: ReviewImage[] = [];
				let part = 0;
				const flush = () => {
					if (current.length > 0) {
						part++;
						next.push(
							reviewPose(
								part === 1 ? rowName(row) : `${rowName(row)}-${part}`,
								current
							)
						);
						current = [];
					}
				};

				for (const cell of grid.cells.filter(item => item.row === row)) {
					const key = cellKey(cell.row, cell.col);

					if (emptyCell(cell) || sheet.skipped.includes(key)) {
						continue;
					}

					if (sheet.cellsArePoses || sheet.splits.includes(key)) {
						flush();
					}

					const blob = await sliceToBlob(sheet.decoded.image, cell);
					const url = URL.createObjectURL(blob);
					const pixels = readPixels(sheet.decoded.image, cell);

					urls.current.push(url);
					current.push({
						animated: false,
						blob,
						feet: pixels ? findFeet(pixels) : undefined,
						height: cell.h,
						label: `${sheet.file.name} ${key}`,
						url,
						width: cell.w
					});
				}

				flush();
			}

			setPoses(next);
			setStage('review');
		} catch (caught) {
			setError((caught as Error).message);
			setStage('sheet');
		}
	}

	function updatePose(key: string, patch: Partial<ReviewPose>) {
		setPoses(current =>
			current.map(pose => (pose.key === key ? {...pose, ...patch} : pose))
		);
	}

	function mergePose(from: string, into: string) {
		setPoses(current => {
			const source = current.find(pose => pose.key === from);

			if (!source) {
				return current;
			}

			return current
				.filter(pose => pose.key !== from)
				.map(pose =>
					pose.key === into
						? {...pose, images: [...pose.images, ...source.images]}
						: pose
				);
		});
	}

	function fitsFor(pose: ReviewPose): (PoseFit | undefined)[] {
		const fits = alignFits(pose.images, align, box, origin);

		// An animated file has no one set of feet.
		return fits.map((fit, index) => (pose.images[index].animated ? undefined : fit));
	}

	const included = poses.filter(pose => pose.include);
	const planned = plannedPoseNames(
		included.map(pose => pose.name),
		character.poses
	);

	async function handleImport() {
		setStage('importing');

		try {
			await onImport(
				included.map(pose => {
					const fits = fitsFor(pose);

					return {
						dur: pose.images.length > 1 ? durForFps(pose.fps) : undefined,
						images: pose.images.map((image, index) => ({
							blob: image.blob,
							fit: fits[index],
							label: image.label
						})),
						loop: pose.images.length > 1 && !pose.loop ? false : undefined,
						name: pose.name
					};
				}),
				faces
			);
		} catch (caught) {
			setError((caught as Error).message);
			setStage('review');
		}
	}

	function renderPick() {
		return (
			<div className="import-set-pick">
				<p>{t('dialogs.slidersCharacters.importSet.pickNote')}</p>
				<ButtonBar>
					<UploadButton
						label={t('dialogs.slidersCharacters.importSet.chooseFiles')}
						onUpload={files => void loadFiles(files)}
					/>
					<span className="upload-button">
						<IconButton
							icon={<IconFolder />}
							label={t('dialogs.slidersCharacters.importSet.chooseFolder')}
							onClick={() => folderInput.current?.click()}
						/>
						<input
							aria-label={t('dialogs.slidersCharacters.importSet.chooseFolder')}
							multiple
							onChange={event => {
								const files = Array.from(event.target.files ?? []);

								event.target.value = '';

								if (files.length > 0) {
									void loadFiles(files);
								}
							}}
							ref={folderInput}
							type="file"
						/>
					</span>
				</ButtonBar>
			</div>
		);
	}

	function numberField(
		label: string,
		value: number,
		onChange: (value: number) => void,
		min = 0
	) {
		return (
			<label className="import-set-field">
				<span>{label}</span>
				<input
					min={min}
					onChange={event => {
						const next = parseInt(event.target.value, 10);

						if (Number.isFinite(next) && next >= min) {
							onChange(next);
						}
					}}
					type="number"
					value={value}
				/>
			</label>
		);
	}

	function renderSheet() {
		if (!sheet) {
			return null;
		}

		const {decoded, spec} = sheet;
		const rows = layout?.rows ?? 0;

		return (
			<div className="import-set-sheet">
				<div className="import-set-sheet-controls">
					<label className="import-set-check">
						<input
							checked={sheet.asSheet}
							onChange={event =>
								setSheet({...sheet, asSheet: event.target.checked})
							}
							type="checkbox"
						/>
						{t('dialogs.slidersCharacters.importSet.isSheet')}
					</label>
					<p className="character-editor-note">
						{t('dialogs.slidersCharacters.importSet.sheetSize', {
							height: decoded.height,
							width: decoded.width
						})}
					</p>
					{sheet.asSheet && (
						<>
							<TextSelect
								onChange={event =>
									updateSpec({by: event.target.value as GridSpec['by']})
								}
								options={[
									{
										label: t('dialogs.slidersCharacters.importSet.byCount'),
										value: 'count'
									},
									{
										label: t('dialogs.slidersCharacters.importSet.bySize'),
										value: 'size'
									}
								]}
								orientation="vertical"
								value={spec.by}
							>
								{t('dialogs.slidersCharacters.importSet.gridBy')}
							</TextSelect>
							{spec.by === 'count' ? (
								<>
									{numberField(
										t('dialogs.slidersCharacters.importSet.cols'),
										spec.cols,
										cols => updateSpec({cols}),
										1
									)}
									{numberField(
										t('dialogs.slidersCharacters.importSet.rows'),
										spec.rows,
										rows => updateSpec({rows}),
										1
									)}
								</>
							) : (
								<>
									{numberField(
										t('dialogs.slidersCharacters.importSet.cellW'),
										spec.cellW,
										cellW => updateSpec({cellW}),
										1
									)}
									{numberField(
										t('dialogs.slidersCharacters.importSet.cellH'),
										spec.cellH,
										cellH => updateSpec({cellH}),
										1
									)}
								</>
							)}
							{numberField(
								t('dialogs.slidersCharacters.importSet.margin'),
								spec.margin,
								margin => updateSpec({margin})
							)}
							{numberField(
								t('dialogs.slidersCharacters.importSet.spacing'),
								spec.spacing,
								spacing => updateSpec({spacing})
							)}
							<p className="character-editor-note" data-readout="grid">
								{t('dialogs.slidersCharacters.importSet.gridReadout', {
									cellH: layout?.cellH ?? 0,
									cellW: layout?.cellW ?? 0,
									cols: layout?.cols ?? 0,
									rows
								})}
							</p>
							<label className="import-set-check">
								<input
									checked={sheet.cellsArePoses}
									onChange={event =>
										setSheet({...sheet, cellsArePoses: event.target.checked})
									}
									type="checkbox"
								/>
								{t('dialogs.slidersCharacters.importSet.cellsArePoses')}
							</label>
							<p className="character-editor-note">
								{t('dialogs.slidersCharacters.importSet.cellNote')}
							</p>
							<ol className="import-set-rows">
								{Array.from({length: rows}, (_, row) => (
									<li key={row}>
										<label className="import-set-field">
											<span>
												{t('dialogs.slidersCharacters.importSet.rowName', {
													row: row + 1
												})}
											</span>
											<input
												onChange={event => {
													const rowNames = sheet.rowNames.slice();

													rowNames[row] = event.target.value;
													setSheet({...sheet, rowNames});
												}}
												type="text"
												value={rowName(row)}
											/>
										</label>
									</li>
								))}
							</ol>
						</>
					)}
				</div>
				<div className="import-set-sheet-view">
					<div className="import-set-sheet-art">
						<img alt={sheet.file.name} src={decoded.url} />
						{layout?.cells.map(cell => {
							const key = cellKey(cell.row, cell.col);
							const empty = emptyCell(cell);

							return (
								<button
									aria-label={t('dialogs.slidersCharacters.importSet.cell', {
										col: cell.col + 1,
										row: cell.row + 1
									})}
									className={classNames('import-set-cell', {
										empty,
										skipped: sheet.skipped.includes(key),
										split: sheet.splits.includes(key)
									})}
									data-cell={key}
									disabled={empty}
									key={key}
									onClick={event =>
										setSheet(
											event.shiftKey
												? {...sheet, splits: toggle(sheet.splits, key)}
												: {...sheet, skipped: toggle(sheet.skipped, key)}
										)
									}
									style={{
										height: `${(cell.h / decoded.height) * 100}%`,
										left: `${(cell.x / decoded.width) * 100}%`,
										top: `${(cell.y / decoded.height) * 100}%`,
										width: `${(cell.w / decoded.width) * 100}%`
									}}
									type="button"
								/>
							);
						})}
					</div>
				</div>
			</div>
		);
	}

	function renderReview() {
		return (
			<div className="import-set-review">
				<table>
					<thead>
						<tr>
							<th>{t('dialogs.slidersCharacters.importSet.include')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.pose')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.steps')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.fps')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.loop')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.preview')}</th>
							<th>{t('dialogs.slidersCharacters.importSet.merge')}</th>
						</tr>
					</thead>
					<tbody>
						{poses.map(pose => {
							const plannedName = pose.include
								? planned[included.indexOf(pose)]
								: undefined;
							const stepped = pose.images.length > 1;

							return (
								<tr
									className={classNames({dropped: !pose.include})}
									data-import-pose={pose.name}
									key={pose.key}
								>
									<td>
										<input
											aria-label={t('dialogs.slidersCharacters.importSet.includePose', {
												name: pose.name
											})}
											checked={pose.include}
											onChange={event =>
												updatePose(pose.key, {include: event.target.checked})
											}
											type="checkbox"
										/>
									</td>
									<td>
										<input
											aria-label={t('dialogs.slidersCharacters.importSet.poseName')}
											onChange={event =>
												updatePose(pose.key, {name: event.target.value})
											}
											type="text"
											value={pose.name}
										/>
										{plannedName && plannedName !== pose.name && (
											<span className="import-set-planned">→ {plannedName}</span>
										)}
									</td>
									<td>{pose.images.length}</td>
									<td>
										{stepped && (
											<input
												aria-label={t('dialogs.slidersCharacters.importSet.fps')}
												max={60}
												min={1}
												onChange={event => {
													const fps = parseFloat(event.target.value);

													if (fps > 0) {
														updatePose(pose.key, {fps});
													}
												}}
												type="number"
												value={pose.fps}
											/>
										)}
									</td>
									<td>
										{stepped && (
											<input
												aria-label={t('dialogs.slidersCharacters.importSet.loop')}
												checked={pose.loop}
												onChange={event =>
													updatePose(pose.key, {loop: event.target.checked})
												}
												type="checkbox"
											/>
										)}
									</td>
									<td>
										<ImportPreview
											box={box}
											fits={fitsFor(pose)}
											fps={pose.fps}
											images={pose.images}
											loop={pose.loop}
											origin={origin}
										/>
									</td>
									<td>
										{poses.length > 1 && (
											<select
												aria-label={t('dialogs.slidersCharacters.importSet.merge')}
												onChange={event => {
													if (event.target.value) {
														mergePose(pose.key, event.target.value);
													}
												}}
												value=""
											>
												<option value="">—</option>
												{poses
													.filter(other => other.key !== pose.key)
													.map(other => (
														<option key={other.key} value={other.key}>
															{other.name}
														</option>
													))}
											</select>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
				<div className="import-set-options">
					<TextSelect
						onChange={event => setFaces(event.target.value as 'left' | 'right')}
						options={[
							{label: t('dialogs.slidersCharacters.importSet.facesRight'), value: 'right'},
							{label: t('dialogs.slidersCharacters.importSet.facesLeft'), value: 'left'}
						]}
						value={faces}
					>
						{t('dialogs.slidersCharacters.importSet.faces')}
					</TextSelect>
					<TextSelect
						onChange={event => setAlign(event.target.value as AlignMode)}
						options={[
							{label: t('dialogs.slidersCharacters.importSet.alignStep'), value: 'step'},
							{label: t('dialogs.slidersCharacters.importSet.alignPose'), value: 'pose'},
							{label: t('dialogs.slidersCharacters.importSet.alignOff'), value: 'off'}
						]}
						value={align}
					>
						{t('dialogs.slidersCharacters.importSet.alignFeet')}
					</TextSelect>
				</div>
				<p className="character-editor-note">
					{t('dialogs.slidersCharacters.importSet.alignNote')}
				</p>
			</div>
		);
	}

	return (
		<UploadDropZone
			floatingHint
			label={t('dialogs.slidersCharacters.importSet.drop')}
			onDrop={files => void loadFiles(files)}
		>
			<div className="import-set" data-stage={stage}>
				<div className="import-set-header">
					<h3>{t('dialogs.slidersCharacters.importSet.title')}</h3>
					<ButtonBar>
						{(stage === 'sheet' || stage === 'review') && (
							<IconButton
								icon={<IconArrowLeft />}
								label={t('dialogs.slidersCharacters.importSet.back')}
								onClick={() => setStage(stage === 'review' && sheet ? 'sheet' : 'pick')}
							/>
						)}
						{stage === 'sheet' && (
							<IconButton
								icon={<IconFileImport />}
								label={t('dialogs.slidersCharacters.importSet.next')}
								onClick={() => void sliceSheet()}
								variant="primary"
							/>
						)}
						{stage === 'review' && (
							<IconButton
								disabled={included.length === 0}
								icon={<IconFileImport />}
								label={t('dialogs.slidersCharacters.importSet.import', {
									count: included.length
								})}
								onClick={() => void handleImport()}
								variant="create"
							/>
						)}
						<IconButton
							disabled={stage === 'importing'}
							icon={<IconX />}
							label={t('common.cancel')}
							onClick={onCancel}
						/>
					</ButtonBar>
				</div>
				{error && (
					<p className="sliders-characters-error" role="alert">
						{error}
					</p>
				)}
				{stage === 'pick' && renderPick()}
				{(stage === 'loading' || stage === 'importing') && (
					<p className="import-set-busy">
						{stage === 'loading'
							? t('dialogs.slidersCharacters.importSet.loading')
							: t('dialogs.slidersCharacters.importSet.importing')}
					</p>
				)}
				{stage === 'sheet' && renderSheet()}
				{stage === 'review' && renderReview()}
			</div>
		</UploadDropZone>
	);
};
