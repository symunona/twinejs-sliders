import {AssetId, AssetMask, AssetMeta, Frac2, MaskOp} from '@sliders/scene-types';
import classNames from 'classnames';
import {
	IconAdjustments,
	IconContrast,
	IconCrop,
	IconDeviceFloppy,
	IconEraser,
	IconFilePlus,
	IconLink,
	IconResize,
	IconTarget,
	IconWand,
	IconWriting,
	IconX
} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {
	AnchorOverlay,
	AnchorSelect,
	DEFAULT_ANCHOR,
	roundAnchor,
	sameAnchor
} from '../../components/anchor';
import {ButtonBar} from '../../components/container/button-bar';
import {DialogCard} from '../../components/container/dialog-card';
import {CheckboxButton} from '../../components/control/checkbox-button';
import {ConfirmButton} from '../../components/control/confirm-button';
import {IconButton} from '../../components/control/icon-button';
import {
	PromptButton,
	PromptValidationResponse
} from '../../components/control/prompt-button';
import {useCommand} from '../../hotkeys';
// Imported from the module rather than the barrel: the generator opens this dialog to
// edit a generation, so the two files are a cycle either way, and going through
// `../asset-generator` would drag the whole generator barrel into that cycle. Only
// referenced inside a handler, so it is resolved long after both modules have run.
import {AssetGeneratorDialog} from '../asset-generator/asset-generator';
import {useDialogsContext} from '../context';
import {DialogComponentProps} from '../dialogs.types';
import {
	refreshAssetLibrary,
	useAssetStore
} from '../sliders-assets/asset-store-context';
import {useAssetUsage} from '../sliders-assets/use-asset-usage';
import {useSceneRefRename} from '../sliders-assets/use-scene-ref-rename';
import {AdjustSlider} from './adjust-slider';
import {
	BackgroundSupport,
	backgroundSupport,
	BackgroundTimeoutError,
	BackgroundUnsupportedError,
	compositeAlpha,
	CutoutTuning,
	DEFAULT_TUNING,
	removeBackground,
	tunedAlpha
} from './background-engine';
import {
	BackgroundOnCpuError,
	EngineProgress,
	keepStorage,
	webGpuDescription
} from './engine-types';
import {NoteBody, NoteButton, useNote} from './editor-note';
import {EditorSection} from './editor-section';
import {EditorToolbar, ToolId, TOOL_IDS} from './editor-toolbar';
import {
	anchorAfterCrop,
	canvasBlob,
	CropRect,
	cropFromDrag,
	defaultEdits,
	drawCropOverlay,
	anchorBeforeCrop,
	drawEdited,
	GAMMA_RANGE,
	ImageEdits,
	LEVEL_RANGE,
	sameEdits,
	sameTuning
} from './image-edits';
import {decodeCutout, encodeCutout} from './cutout-map';
import {MaskOverlay} from './mask-overlay';
import {
	DEFAULT_FEATHER,
	MASK_MODES,
	MaskMode,
	MaskToolId,
	emptyMask,
	mergeAlpha,
	rasterizeMask,
	sameMask
} from './mask-shapes';
import {MaskTool} from './mask-tool';
import './asset-editor.css';

/** Longest edge the live preview is drawn at. Full size is only used on save. */
const MAX_PREVIEW = 900;

/** The preview's size on screen, for a source of this size. */
function previewSize(source: {height: number; width: number}, scale: number) {
	return {
		height: Math.max(1, Math.round(source.height * scale)),
		width: Math.max(1, Math.round(source.width * scale))
	};
}

/**
 * The `paint` preview: the composite, raw.
 *
 * No adjustments and no crop wash -- everything that could disguise the edge being judged
 * is off. The checkerboard the plan asks for is already there: `.asset-editor-canvas
 * canvas` carries one as a CSS background, so every transparent pixel shows it and a
 * second one baked into the bitmap would only fight it at a different cell size.
 */
function drawComposite(
	target: HTMLCanvasElement,
	source: HTMLCanvasElement,
	scale: number
) {
	const {height, width} = previewSize(source, scale);
	const context = target.getContext('2d');

	if (!context) {
		return;
	}

	target.width = width;
	target.height = height;
	context.clearRect(0, 0, width, height);
	context.imageSmoothingQuality = 'high';
	context.drawImage(source, 0, 0, width, height);
}

/**
 * The `alpha` preview: the effective alpha as grayscale, white = opaque.
 *
 * Drawn at source size into a scratch canvas and scaled down from there, because the
 * alpha is one value per SOURCE pixel and there is no cheap way to sample it at preview
 * size that `drawImage` does not already do better. Fully opaque, so the checkerboard
 * under the canvas stays out of a picture whose whole subject is transparency.
 */
function drawAlpha(
	target: HTMLCanvasElement,
	effective: Float32Array | undefined,
	width: number,
	height: number,
	scale: number
) {
	const full = document.createElement('canvas');

	full.width = width;
	full.height = height;

	const scratch = full.getContext('2d');
	const context = target.getContext('2d');

	if (!scratch || !context) {
		return;
	}

	const image = scratch.createImageData(width, height);

	for (let index = 0; index < width * height; index++) {
		// Absent alpha means nothing is cut: the asset is opaque everywhere, which is
		// white. Reached when the mode is left on `alpha` for the instant between a
		// cutout being dropped and the switch falling back to `rendered`.
		const level = Math.round(
			Math.min(1, Math.max(0, effective?.[index] ?? 1)) * 255
		);

		image.data[index * 4] = level;
		image.data[index * 4 + 1] = level;
		image.data[index * 4 + 2] = level;
		image.data[index * 4 + 3] = 255;
	}

	scratch.putImageData(image, 0, 0);

	const size = previewSize({height, width}, scale);

	target.width = size.width;
	target.height = size.height;
	context.imageSmoothingQuality = 'high';
	context.drawImage(full, 0, 0, size.width, size.height);
}

export interface AssetEditorDialogProps extends DialogComponentProps {
	/** The asset being edited. Absent when editing pixels that aren't in the library. */
	assetId?: AssetId;
	/**
	 * Image bytes to edit that no asset owns yet--a freshly generated image. The
	 * generator keeps its own history and decides for itself what becomes an asset, so
	 * this mode offers `onApply` in place of the two library saves.
	 */
	source?: {blob: Blob; name: string};
	/** Handed the edited bytes, when editing something that isn't an asset. */
	onApply?: (blob: Blob) => void | Promise<void>;
	/**
	 * Told the id the edit ended up under. Replacing reports the id it came in with;
	 * saving as new reports the new one, so a character can repoint its frame at it.
	 */
	onSaved?: (assetId: AssetId) => void;
}

function megabytes(bytes: number): string {
	return `${Math.round(bytes / 1024 / 102.4) / 10} MB`;
}

/** Which of the four steps a stage is, so the wait has a shape. */
const STAGE_STEPS: Record<EngineProgress['stage'], number> = {
	download: 1,
	refine: 4,
	run: 3,
	start: 2
};

const STAGE_COUNT = 4;

/** Past this, a wait needs explaining rather than just spinning. */
const SLOW_SECONDS = 12;

/**
 * The line to show for a stage. Three things vary: the closer pass has to read
 * differently from the first one or it looks stuck, a percentage is only worth
 * printing when there is one, and "on your GPU" is a lie on the CPU fallback.
 */
export function stageKey(progress: EngineProgress, cpu: boolean): string {
	const {estimated, pass, stage} = progress;

	if (stage === 'start' && cpu) {
		return 'dialogs.assetEditor.stage.startCpu';
	}

	if (stage !== 'run') {
		return `dialogs.assetEditor.stage.${stage}`;
	}

	const closer = pass === 2 ? 'Closer' : '';

	return `dialogs.assetEditor.stage.run${closer}${estimated ? 'Estimated' : ''}`;
}

function elapsedLabel(seconds: number): string {
	if (seconds < 60) {
		return `${seconds}s`;
	}

	return `${Math.floor(seconds / 60)}m ${`${seconds % 60}`.padStart(2, '0')}s`;
}

export const AssetEditorDialog: React.FC<AssetEditorDialogProps> = props => {
	const {assetId, source: sourceImage} = props;
	const store = useAssetStore();
	const {dispatch} = useDialogsContext();
	// Which passages write this asset's name, so the rename prompt can offer to carry them
	// along -- the same list the asset browser's tiles show.
	const usage = useAssetUsage();
	const renameScenes = useSceneRefRename();
	const [background, setBackground] = React.useState<BackgroundSupport>();
	const cancel = React.useRef<AbortController>();
	const preview = React.useRef<HTMLCanvasElement>(null);
	const canvasBox = React.useRef<HTMLDivElement>(null);
	const [dragFrom, setDragFrom] = React.useState<{x: number; y: number}>();
	const [edits, setEdits] = React.useState<ImageEdits>();
	const [error, setError] = React.useState<string>();
	const [lockAspect, setLockAspect] = React.useState(true);
	const [meta, setMeta] = React.useState<AssetMeta>();
	const [name, setName] = React.useState('');
	/**
	 * Where this asset is pinned, as a fraction of the SOURCE image. Kept in source
	 * coordinates because that is what the preview shows and what a click on it means;
	 * the crop is folded in on the way out, in `savedAnchor()`.
	 */
	const [origin, setOrigin] = React.useState<Frac2>(DEFAULT_ANCHOR);
	/** True while the next click on the image places the anchor instead of cropping. */
	const [picking, setPicking] = React.useState(false);
	/** Kept so removing the background can be undone. */
	const [original, setOriginal] = React.useState<HTMLCanvasElement>();
	/** The cutout's alpha, kept so the tuning sliders don't re-run the model. */
	const [alpha, setAlpha] = React.useState<Float32Array>();
	const [tuning, setTuning] = React.useState<CutoutTuning>(DEFAULT_TUNING);
	const [elapsed, setElapsed] = React.useState(0);
	const [progress, setProgress] = React.useState<EngineProgress>();
	const [renameOpen, setRenameOpen] = React.useState(false);
	/** The name in the rename prompt, which is the asset's own--not `name`, which is the
	    name a "save as new" would use. */
	const [renameName, setRenameName] = React.useState('');
	const [replaceOpen, setReplaceOpen] = React.useState(false);
	const [saveAsOpen, setSaveAsOpen] = React.useState(false);
	const [saving, setSaving] = React.useState(false);
	/** Every asset's id and name, to spot a name clash before saving. */
	const [library, setLibrary] = React.useState<{id: string; name: string}[]>([]);
	/**
	 * Every name a scene can address--asset names AND character ids, one namespace. Wider
	 * than `library`, which is assets alone: a rename to a character's id is refused by
	 * the store, so the prompt has to know about them too.
	 */
	const [taken, setTaken] = React.useState<Set<string>>(new Set());
	/**
	 * The pixels on screen, and the alpha they were drawn through.
	 *
	 * One piece of state, written by one effect. Three things feed the composite -- the
	 * model's alpha, its tuning, and the hand-drawn shapes -- and when each of them
	 * composited for itself, a mask and a cutout could each undo the other's work
	 * depending on which handler ran last. The effect also gets React's batching, which
	 * matters: a vertex drag fires on every pointermove, and `rasterizeMask` allocates and
	 * reads back a full-size canvas per shape.
	 */
	const [composed, setComposed] = React.useState<{
		canvas: HTMLCanvasElement;
		/** `clamp(tuned + shapes, 0, 1)`. Absent when there was nothing to composite. */
		effective?: Float32Array;
	}>();
	const source = composed?.canvas;
	const effective = composed?.effective;
	/** The hand-drawn shapes, in fractions of the SOURCE image. */
	const [mask, setMask] = React.useState<AssetMask>({shapes: []});
	/** The shape the mask pane's op and feather are editing, and whose handles show. */
	const [selectedShape, setSelectedShape] = React.useState<string>();
	const [maskTool, setMaskTool] = React.useState<MaskToolId>('polygon');
	/** Which of the three previews the stage draws. Not saved: it is a way of looking. */
	const [maskMode, setMaskMode] = React.useState<MaskMode>('rendered');
	/** What the NEXT shape drawn starts with, until a shape is picked to edit instead. */
	const [maskOp, setMaskOp] = React.useState<MaskOp>('cut');
	const [maskFeather, setMaskFeather] = React.useState(DEFAULT_FEATHER);
	/**
	 * The bytes `original` was decoded from, kept so a save can store them as the asset's
	 * `source` sidecar -- the base every later edit of it is re-rendered from.
	 */
	const [baseBlob, setBaseBlob] = React.useState<Blob>();
	/**
	 * The settings this asset opened with. Re-opening an edit restores its controls, and
	 * without a baseline to compare against that restored state would read as unsaved work
	 * and light up both save buttons before the author had touched anything.
	 */
	const [saved, setSaved] = React.useState<{
		edits?: ImageEdits;
		mask?: AssetMask;
		tuning?: CutoutTuning;
	}>({});
	/**
	 * Which control panel the right pane is showing. Colour first: it is the only tool
	 * that is safe to open on, because it changes nothing until a slider moves, where
	 * arriving in Sizing arms a crop drag on the very first click.
	 */
	const [tool, setTool] = React.useState<ToolId>('adjust');
	const {t} = useTranslation();

	/** Passages whose scenes write this asset's name. Empty while it has no name yet. */
	const usedIn = (meta && usage.get(meta.name)) || [];

	// Every section's prose hides behind an icon until asked for. Each one keeps
	// its own state so that opening the background note doesn't unfold the rest.

	const adjustNote = useNote();
	const anchorNote = useNote();
	const cpuNote = useNote();
	const engineNote = useNote();
	const saveNote = useNote();
	const sizeNote = useNote();

	// A cutout can take a while--first run compiles shaders, and the model runs
	// twice. A ticking clock is the difference between "working" and "hung".

	const running = progress !== undefined;

	React.useEffect(() => {
		if (!running) {
			setElapsed(0);
			return;
		}

		const startedAt = Date.now();
		const timer = window.setInterval(
			() => setElapsed(Math.round((Date.now() - startedAt) / 1000)),
			500
		);

		return () => window.clearInterval(timer);
		// Keyed off whether a run is happening at all, not off the stage:
		// restarting the clock at every stage change would defeat the point.
	}, [running]);

	// Whether this machine can cut backgrounds out at all. Asking costs a GPU
	// adapter request, so it happens once, here.

	React.useEffect(() => {
		let current = true;

		backgroundSupport().then(result => {
			if (current) {
				setBackground(result);
			}

			// The weights are 168 MB of otherwise-evictable storage, and losing
			// them means downloading them again.
			if (result.engine) {
				keepStorage();
			}
		});

		return () => {
			current = false;
		};
	}, []);

	React.useEffect(() => {
		let current = true;

		store.list({includeFrames: true}).then(assets => {
			if (current) {
				setLibrary(assets.map(asset => ({id: asset.id, name: asset.name})));
			}
		});

		store.takenNames().then(names => {
			if (current) {
				setTaken(names);
			}
		});

		return () => {
			current = false;
		};
	}, [store]);

	// Load the asset's pixels into a canvas we can work on.

	React.useEffect(() => {
		let current = true;

		async function load() {
			// Two ways in: an asset id, or raw bytes that no asset owns yet. Only the
			// first has metadata, and everything that needs metadata is guarded on it.
			const assetMeta = assetId ? await store.meta(assetId) : undefined;
			// What an edit is redone FROM: the pixels the first edit started with when this
			// asset has been edited before, its own bytes otherwise. Re-rendering from the
			// base is what stops a second pass stacking on an already-baked, already
			// re-encoded picture.
			const base = assetId ? await store.sidecar(assetId, 'source') : undefined;
			const blob = assetId ? base ?? (await store.get(assetId)) : sourceImage?.blob;

			if (!current) {
				return;
			}

			if ((assetId && !assetMeta) || !blob) {
				setError(t('dialogs.assetEditor.loadError'));
				return;
			}

			// Editing an animation would flatten it to its first frame, so don't.

			if (assetMeta?.animated) {
				setMeta(assetMeta);
				setError(t('dialogs.assetEditor.animatedError'));
				return;
			}

			const bitmap = await createImageBitmap(blob);
			const canvas = document.createElement('canvas');

			canvas.width = bitmap.width;
			canvas.height = bitmap.height;
			canvas.getContext('2d')?.drawImage(bitmap, 0, 0);
			bitmap.close?.();

			if (!current) {
				return;
			}

			// Settings are only meaningful over the pixels they were rendered from. Without
			// that base the asset's own bytes ARE the edit, and re-applying it would
			// brighten what is already bright and crop what is already cropped.
			const restored = base ? assetMeta?.edits : undefined;
			// Same rule, same reason: without the `source` sidecar the asset's own bytes
			// already have the holes cut in them, and re-applying the shapes would cut the
			// same hole twice -- softening every feathered edge a second time and darkening
			// nothing that was not already gone.
			const restoredMask = base ? assetMeta?.mask : undefined;
			const stored = assetMeta?.origin ?? DEFAULT_ANCHOR;

			setMeta(assetMeta);
			setName(assetMeta ? `${assetMeta.name}-edit` : sourceImage?.name ?? '');
			setRenameName(assetMeta?.name ?? '');
			// A stored anchor is written against the CROPPED picture; what is on screen is
			// the whole original, so it has to come back out of the crop it went into.
			setOrigin(
				restored
					? anchorBeforeCrop(
							stored,
							restored.crop,
							canvas.width,
							canvas.height
					  )
					: stored
			);
			setBaseBlob(blob);
			setOriginal(canvas);
			// The recomposite effect will write this again the moment `original` lands.
			// Set here anyway, so the dialog shows the picture on the same tick it stops
			// saying "Opening…" rather than one frame later.
			setComposed({canvas});
			setEdits(restored ?? defaultEdits(canvas.width, canvas.height));
			setMask(restoredMask ?? {shapes: []});
			setSaved({
				edits: restored,
				mask: restoredMask,
				tuning: assetMeta?.tuning
			});

			// A stored cutout goes back through the path a fresh one takes, so its two
			// sliders keep working without the model having to run for a second time.
			const storedMap =
				base && assetMeta?.sidecars?.includes('cutout')
					? await store.sidecar(assetMeta.id, 'cutout')
					: undefined;
			const map = storedMap ? await decodeCutout(storedMap) : undefined;

			if (!current) {
				return;
			}

			// A map whose size doesn't match is one stored against different pixels. It
			// cannot be composited, and a silent drop beats a crash: the asset still opens,
			// with its background-removal button live again.
			if (map && map.alpha.length === canvas.width * canvas.height) {
				setAlpha(map.alpha);
				setTuning(assetMeta?.tuning ?? DEFAULT_TUNING);
				// No composite here. The alpha and the tuning are two thirds of what the
				// recomposite effect is keyed on, and the mask is the third.
			}
		}

		load().catch(loadError => {
			console.error('Could not open this asset for editing', loadError);

			if (current) {
				setError(t('dialogs.assetEditor.loadError'));
			}
		});

		return () => {
			current = false;
		};
	}, [assetId, sourceImage, store, t]);

	/**
	 * The composite, in one place.
	 *
	 *     effective = clamp(tuned + keepShapes − cutShapes, 0, 1)
	 *     source    = compositeAlpha(original, effective)
	 *
	 * An effect rather than three handlers, for two reasons. Correctness: the model's
	 * alpha and the hand-drawn shapes are independent, so each of them has to be added to
	 * what the other produced rather than painted over it, and only something that sees
	 * both at once can do that. Speed: a vertex drag calls `onChange` on every
	 * pointermove, and doing this inline would re-rasterise a 2048px image per frame.
	 * Here React coalesces the state writes and this runs once per committed render.
	 */
	React.useEffect(() => {
		if (!original) {
			return;
		}

		const tuned = alpha ? tunedAlpha(alpha, tuning) : undefined;
		const shapes = rasterizeMask(mask, original.width, original.height);
		const effective = mergeAlpha(
			tuned,
			shapes,
			original.width * original.height
		);

		// Nothing to composite: no cutout, no shapes. The asset's own pixels are already
		// what the author is looking at, and running them through an all-ones alpha would
		// re-encode them for no reason.
		setComposed({
			canvas: effective ? compositeAlpha(original, effective) : original,
			effective
		});
	}, [alpha, mask, original, tuning]);

	// Redraw the preview whenever the source, the adjustments or the preview mode
	// change. The crop is drawn as an overlay instead, so that it stays possible to
	// re-crop. Shape outlines and vertex handles are NOT drawn here--they belong to
	// `MaskOverlay`, which sits over this canvas in its own coordinate space.

	React.useEffect(() => {
		const canvas = preview.current;

		if (!canvas || !source || !edits) {
			return;
		}

		const scale = Math.min(
			1,
			MAX_PREVIEW / Math.max(source.width, source.height)
		);

		if (maskMode === 'alpha') {
			drawAlpha(canvas, effective, source.width, source.height, scale);
			return;
		}

		if (maskMode === 'paint') {
			drawComposite(canvas, source, scale);
			return;
		}

		drawEdited(
			source,
			{
				...edits,
				crop: {h: source.height, w: source.width, x: 0, y: 0},
				height: source.height,
				width: source.width
			},
			canvas,
			scale
		);

		if (edits.crop.w !== source.width || edits.crop.h !== source.height) {
			drawCropOverlay(
				canvas,
				edits.crop,
				scale,
				getComputedStyle(canvas).getPropertyValue('--blue').trim() || '#00a'
			);
		}
	}, [edits, effective, maskMode, source]);

	const busy = saving || progress !== undefined;
	/**
	 * The cutout is about to run on the CPU. Everything works, it is simply a
	 * minute an image rather than a second, which is worth saying loudly before
	 * someone starts one and worth repeating in every line while it runs.
	 */
	const onCpu = background?.engine?.cpu === true;
	/**
	 * A cutout exists — the model has run and its alpha is what `source` was composited
	 * through.
	 *
	 * Asked of the alpha rather than of `source !== original`, which is what this used to
	 * be. That test reads "the pixels on screen are not the ones we opened", and every
	 * future thing that touches transparency — a hand-drawn mask, first — makes it true
	 * without a cutout existing. Answered that way it would write a `tuning` describing a
	 * cutout that was never made, and leave the restore button offering to undo nothing.
	 */
	const hasCutout = alpha !== undefined;
	/**
	 * Something has been drawn by hand. Its own test, beside `hasCutout` and never folded
	 * into it: a mask is metadata that survives the model being undone, and a cutout is a
	 * model run that survives every shape being deleted.
	 */
	const hasMask = !emptyMask(mask);
	/**
	 * The previews worth offering. `paint` and `alpha` both show transparency, and with
	 * neither a cutout nor a shape there is none to show--`paint` would be the picture it
	 * already was and `alpha` a blank white sheet with nothing in it to read.
	 *
	 * Unless the mask tool is open, and this is the whole point: drawing only happens in a
	 * transparency preview, so gating those previews on a shape already existing means the
	 * FIRST shape can never be drawn. An asset with no cutout is exactly the case this
	 * feature exists for--a prop's screen, a window--and it was the one case locked out.
	 */
	const maskModes: readonly MaskMode[] =
		hasCutout || hasMask || tool === 'mask' ? MASK_MODES : ['rendered'];
	/** Editing bytes no asset owns--everything keyed off library metadata is off. */
	const detached = assetId === undefined;

	// Deleting the last shape, or restoring the background, can leave the stage in a mode
	// that no longer means anything. Fall back rather than leave the author looking at an
	// empty checkerboard with the switch that would explain it greyed out.
	//
	// Not while the mask tool is open: there the transparency previews are the drawing
	// surface, and falling back out of one the moment the last shape is deleted would
	// close the door behind the author the first time they changed their mind.

	React.useEffect(() => {
		if (!hasCutout && !hasMask && tool !== 'mask') {
			setMaskMode('rendered');
		}
	}, [hasCutout, hasMask, tool]);

	function changeEdits(changes: Partial<ImageEdits>) {
		setEdits(current => (current ? {...current, ...changes} : current));
	}

	/** Cropping resets the output size--it's almost never what you still want. */
	function changeCrop(crop: CropRect) {
		changeEdits({crop, height: crop.h, width: crop.w});
	}

	function changeWidth(value: number) {
		if (!edits) {
			return;
		}

		const width = Math.max(1, Math.round(value || 1));

		changeEdits({
			height: lockAspect
				? Math.max(1, Math.round(width * (edits.crop.h / edits.crop.w)))
				: edits.height,
			width
		});
	}

	function changeHeight(value: number) {
		if (!edits) {
			return;
		}

		const height = Math.max(1, Math.round(value || 1));

		changeEdits({
			height,
			width: lockAspect
				? Math.max(1, Math.round(height * (edits.crop.w / edits.crop.h)))
				: edits.width
		});
	}

	function imagePoint(event: React.PointerEvent) {
		const canvas = preview.current;

		if (!canvas || !source) {
			return undefined;
		}

		const rect = canvas.getBoundingClientRect();

		return {
			x: ((event.clientX - rect.left) / rect.width) * source.width,
			y: ((event.clientY - rect.top) / rect.height) * source.height
		};
	}

	/**
	 * Switching tools disarms anchor picking. It is a one-shot mode that only the Sizing
	 * panel can turn on, so leaving that panel with it still armed would put a cursor on
	 * the image that nothing onscreen explains.
	 */
	function selectTool(next: ToolId) {
		setPicking(false);
		setTool(next);

		// Opening the mask tool means wanting to draw, and drawing does not happen in the
		// rendered preview -- it takes no gestures at all. Landing there would show a pane
		// full of greyed-out tools and leave the author to find a second switch first.
		if (next === 'mask') {
			setMaskMode(current => (current === 'rendered' ? 'paint' : current));
		}
	}

	function handlePointerDown(event: React.PointerEvent) {
		const point = imagePoint(event);

		if (!point || busy || !source) {
			return;
		}

		// Picking is a one-shot mode: place the anchor, turn back into the crop tool.
		// Leaving it armed makes the next crop drag silently move the anchor instead.
		if (picking) {
			setOrigin(
				roundAnchor({x: point.x / source.width, y: point.y / source.height})
			);
			setPicking(false);
			return;
		}

		// Otherwise the drag is a crop, which belongs to the Sizing tool. Left live in
		// every tool it was a trap: a drag meant as "scrub that slider" that started a
		// pixel inside the image cropped instead, with no crop control in sight.
		if (tool !== 'size') {
			return;
		}

		event.currentTarget.setPointerCapture(event.pointerId);
		setDragFrom(point);
	}

	function handlePointerMove(event: React.PointerEvent) {
		const point = imagePoint(event);

		if (!dragFrom || !point || !source) {
			return;
		}

		changeCrop(cropFromDrag(dragFrom, point, source.width, source.height));
	}

	function handlePointerUp() {
		if (!dragFrom || !source || !edits) {
			return;
		}

		setDragFrom(undefined);

		// A click rather than a drag means "never mind".

		if (edits.crop.w < 8 || edits.crop.h < 8) {
			resetCrop();
		}
	}

	function resetCrop() {
		if (source) {
			changeCrop({h: source.height, w: source.width, x: 0, y: 0});
		}
	}

	/**
	 * The anchor as the saved image will see it. The preview is the whole source, so the
	 * anchor is placed against that; cropping moves every fraction of it.
	 */
	function savedAnchor(): Frac2 {
		if (!source || !edits) {
			return origin;
		}

		return anchorAfterCrop(origin, edits.crop, source.width, source.height);
	}

	/**
	 * Re-applies the tuning without touching the model: the alpha is already computed, so
	 * the recomposite this sets off is one pass over the original pixels.
	 *
	 * It composites nothing itself. Doing so would drop whatever the mask contributes,
	 * because the tuning only ever describes the model's half of the alpha.
	 */
	function retune(next: CutoutTuning) {
		setTuning(next);
	}

	/**
	 * Swaps the cutout over: the background is kept and the subject is dropped.
	 *
	 * Deletes the key rather than writing `false`, so an asset nobody inverted carries no
	 * trace of the toggle into sync. `sameTuning` reads absent and `false` as one thing,
	 * which is what keeps turning it on and off again from counting as an unsaved edit.
	 */
	function toggleInvert(value: boolean) {
		const next: CutoutTuning = {
			softness: tuning.softness,
			threshold: tuning.threshold
		};

		if (value) {
			next.invert = true;
		}

		retune(next);
	}

	async function handleRemoveBackground() {
		// The model runs on the ORIGINAL, never on what is on screen. A mask already
		// drawn has cut holes in `source`, and feeding those back in would bake a hand
		// edge into the model's alpha -- where the two are meant to stay independent, so
		// that either can be undone without disturbing the other.
		if (!original) {
			return;
		}

		const controller = new AbortController();

		cancel.current = controller;
		setError(undefined);
		setProgress({stage: 'download'});

		try {
			const cutout = await removeBackground(original, {
				onProgress: setProgress,
				signal: controller.signal,
				tuning
			});

			// Only the alpha. `cutout.canvas` is the engine's own composite of it, which
			// knows nothing about the mask; the recomposite effect makes the picture.
			setAlpha(cutout.alpha);
		} catch (removeError) {
			const failure = removeError as Error;

			// Anything that isn't a deliberate cancel gets logged with the
			// adapter, because "which GPU" is the first question every one of
			// these raises.
			if (failure?.name !== 'AbortError') {
				console.error(
					`Could not remove the background (WebGPU: ${
						webGpuDescription() ?? 'unknown'
					})`,
					removeError
				);
			}

			if (failure?.name === 'AbortError') {
				// The author asked for this; nothing to report.
			} else if (removeError instanceof BackgroundUnsupportedError) {
				setError(t(removeError.reasonKey));
			} else if (removeError instanceof BackgroundOnCpuError) {
				setError(
					t('dialogs.assetEditor.onCpuError', {
						gpu: removeError.gpu ?? t('dialogs.assetEditor.unknownGpu'),
						seconds: removeError.seconds
					})
				);
			} else if (removeError instanceof BackgroundTimeoutError) {
				setError(
					t('dialogs.assetEditor.timeoutError', {
						gpu: webGpuDescription() ?? t('dialogs.assetEditor.unknownGpu'),
						seconds: removeError.seconds,
						stage: t(`dialogs.assetEditor.stage.${removeError.stage}`, {
							percent: 100
						})
					})
				);
			} else {
				setError(
					t('dialogs.assetEditor.backgroundError', {
						message: failure?.message ?? String(removeError)
					})
				);
			}
		} finally {
			cancel.current = undefined;
			setProgress(undefined);
		}
	}

	/**
	 * What the store should remember alongside the bytes, so this edit can be re-opened.
	 *
	 * The base blob rides along on every save. `replace` only writes it the first time --
	 * after that the asset already holds the pixels this edit was rendered from, and the
	 * blob offered here is that same picture read back.
	 */
	async function editOptions() {
		if (!edits || !original) {
			return {};
		}

		return {
			cutout: alpha
				? await encodeCutout(alpha, original.width, original.height)
				: undefined,
			edits,
			// An empty mask is cleared rather than written: a `{shapes: []}` on the meta
			// of every asset anyone ever opened the mask pane on is noise that syncs.
			mask: emptyMask(mask) ? undefined : mask,
			source: baseBlob,
			tuning: hasCutout ? tuning : undefined
		};
	}

	/**
	 * Opens the generator with this asset already attached, so "the same thing, but at
	 * night" is one click rather than a close, a reopen and a hunt through the picker.
	 *
	 * What gets attached is the asset as the library holds it. The generator reads
	 * bytes by id, and an edit that is still only in this dialog has no id--hence the
	 * warning on the button whenever there is one.
	 */
	function handleGenerate() {
		if (!meta) {
			return;
		}

		// NOT maximized. Opening a maximized dialog un-maximizes every other one, and
		// this editor is normally the maximized one -- losing that swaps the wrapper
		// element React renders it in, so it remounts and the edit in progress is gone.
		dispatch({
			type: 'addDialog',
			component: AssetGeneratorDialog,
			props: {attach: [meta.id]}
		});
	}

	/** The edited pixels, as a file the asset store will take. */
	async function editedFile(fileName: string) {
		const canvas = document.createElement('canvas');

		drawEdited(source!, edits!, canvas);

		// PNG, because the edit may have added transparency. The asset store
		// re-encodes it to WebP on the way in either way.
		const blob = await canvasBlob(canvas);

		return new File([blob], `${fileName}.png`, {type: 'image/png'});
	}

	/**
	 * Hands the edited bytes back to whoever opened the editor on them. Used by the
	 * asset generator, which keeps generated images in its own history until someone
	 * chooses what they should become.
	 */
	async function handleApply() {
		if (!source || !edits || !props.onApply) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			const canvas = document.createElement('canvas');

			drawEdited(source, edits, canvas);
			await props.onApply(await canvasBlob(canvas));
			props.onClose();
		} catch (applyError) {
			console.error('Could not apply the edit', applyError);
			setError(t('dialogs.assetEditor.saveError'));
			setSaving(false);
		}
	}

	/** Writes the edit back over the asset it came from, keeping its id. */
	async function handleReplace() {
		if (!source || !edits || !meta) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			await store.replace(meta.id, await editedFile(meta.name), await editOptions());

			// Metadata, so it rides a second call rather than the bytes. Cropping moves the
			// anchor even when nobody touched it, which is why this compares rather than
			// checking whether the anchor controls were used.
			const anchor = savedAnchor();

			if (!sameAnchor(anchor, meta.origin ?? DEFAULT_ANCHOR)) {
				await store.update(meta.id, {origin: anchor});
			}

			refreshAssetLibrary();
			props.onSaved?.(meta.id);
			props.onClose();
		} catch (saveError) {
			console.error('Could not overwrite the asset', saveError);
			setError(t('dialogs.assetEditor.saveError'));
			setSaving(false);
		}
	}

	/**
	 * Renames the asset itself. Metadata only: the pixels, the edit in progress and the id
	 * are all untouched, so an author who opened this to crop something and noticed the
	 * name was wrong does not have to abandon the edit to fix it.
	 */
	async function handleRename(value: string, updateScenes = false) {
		const renamed = value.trim();

		if (!meta || renamed === '' || renamed === meta.name) {
			return;
		}

		const oldName = meta.name;

		setError(undefined);

		try {
			const updated = await store.update(meta.id, {name: renamed});

			setMeta(updated);
			setName(`${updated.name}-edit`);
			setLibrary(current =>
				current.map(asset =>
					asset.id === updated.id ? {...asset, name: updated.name} : asset
				)
			);
			setTaken(current => {
				const next = new Set(current);

				next.delete(meta.name);
				next.add(updated.name);
				return next;
			});

			if (updateScenes) {
				renameScenes(oldName, updated.name);
			}

			refreshAssetLibrary();
		} catch (renameError) {
			console.error('Could not rename the asset', renameError);
			setError(t('dialogs.assetEditor.renameError', {name: renamed}));
		}
	}

	async function handleSave(asName: string) {
		if (!source || !edits || !meta) {
			return;
		}

		setError(undefined);
		setSaving(true);

		try {
			const saveName = asName.trim() || `${meta.name}-edit`;

			// `ownerCharacter` rides along, or a character frame edited here would land
			// in the library as a loose asset while the character kept the old one.
			const saved = await store.putAsset(await editedFile(saveName), {
				...(await editOptions()),
				kind: meta.kind,
				name: saveName,
				origin: savedAnchor(),
				ownerCharacter: meta.ownerCharacter,
				sourceAsset: meta.id,
				tags: meta.tags
			});

			refreshAssetLibrary();
			props.onSaved?.(saved.id);
			props.onClose();
		} catch (saveError) {
			console.error('Could not save the edited asset', saveError);
			setError(t('dialogs.assetEditor.saveError'));
			setSaving(false);
		}
	}

	// Names are how scenes refer to assets--`bg: tavern-night`--so two assets
	// sharing one is ambiguous in a way two ids never are. Saying so is still
	// advice rather than a rule: the clash is reported, the save is allowed.
	// Memoised because `PromptButton` re-validates whenever this identity
	// changes, and validating sets state.
	const validateSaveName = React.useCallback(
		(value: string): PromptValidationResponse => {
			const trimmed = value.trim().toLowerCase();

			if (trimmed === '') {
				return {message: t('dialogs.assetEditor.nameEmpty'), valid: false};
			}

			const clash = library.find(asset => asset.name.toLowerCase() === trimmed);

			if (!clash) {
				return {valid: true};
			}

			return {
				message: t(
					clash.id === meta?.id
						? 'dialogs.assetEditor.clashesWithSelf'
						: 'dialogs.assetEditor.clashesWithOther',
					{name: clash.name}
				),
				valid: true
			};
		},
		[library, meta?.id, t]
	);

	// Unlike "save as new", where a clash is only advice, a rename that collides is
	// refused: `store.update` throws on it, and two assets under one name is exactly what
	// the store exists to prevent.
	const validateRename = React.useCallback(
		(value: string): PromptValidationResponse => {
			const trimmed = value.trim().toLowerCase();

			if (trimmed === '') {
				return {message: t('dialogs.assetEditor.nameEmpty'), valid: false};
			}

			const clash = library.find(
				asset => asset.id !== meta?.id && asset.name.toLowerCase() === trimmed
			);

			if (clash || (trimmed !== meta?.name.toLowerCase() && taken.has(value.trim()))) {
				return {
					message: t('dialogs.assetEditor.renameTaken', {
						name: clash?.name ?? value.trim()
					}),
					valid: false
				};
			}

			// Allowed, but said out loud: the second submit carries those scenes along,
			// and the plain one leaves them naming art that is gone.
			if (trimmed !== meta?.name.toLowerCase() && usedIn.length > 0) {
				return {
					message: t('dialogs.assetEditor.renameUsed', {
						count: usedIn.length,
						old: meta?.name
					}),
					valid: true
				};
			}

			return {valid: true};
		},
		[library, meta?.id, meta?.name, t, taken, usedIn.length]
	);

	const cropped =
		source !== undefined &&
		edits !== undefined &&
		(edits.crop.w !== source.width || edits.crop.h !== source.height);

	/** The anchor is metadata, so moving it alone is still a change worth saving. */
	const anchorChanged =
		!detached && !sameAnchor(origin, meta?.origin ?? DEFAULT_ANCHOR);

	/** The cutout as it would be saved: absent once an author has undone the removal. */
	const savedTuning = hasCutout ? tuning : undefined;

	/**
	 * Something has been done to the image that no save has written down. Drives both
	 * the save buttons and the toolbar's readout, from one test--a readout that could
	 * say "unsaved" while the save buttons were greyed out would be worse than none.
	 *
	 * Measured against the state the asset OPENED with, not against a pristine image.
	 * Re-opening an edit restores its controls, and comparing those to zero would call
	 * an already-saved edit unsaved from the moment the dialog appeared.
	 */
	const dirty =
		source !== undefined &&
		edits !== undefined &&
		(anchorChanged ||
			!sameTuning(savedTuning, saved.tuning) ||
			!sameMask(mask, saved.mask) ||
			!sameEdits(
				edits,
				saved.edits ?? defaultEdits(source.width, source.height)
			));

	const saveDisabled = busy || !source || !edits || !dirty;

	useCommand({
		enabled: !busy && !hasCutout && !!background?.engine,
		id: 'assetEditor.removeBackground',
		label: t('hotkeys.commands.assetEditor.removeBackground'),
		run: handleRemoveBackground,
		scope: 'asset-editor'
	});

	useCommand({
		enabled: hasCutout && !progress,
		id: 'assetEditor.restoreBackground',
		label: t('hotkeys.commands.assetEditor.restoreBackground'),
		// Drops the model's alpha and nothing else. It used to put `original` back on
		// screen as well, which with a mask drawn threw the holes away silently: the
		// shapes were still on the meta and still in the save, but the preview no longer
		// showed them. The recomposite effect redraws whatever is left.
		run: () => setAlpha(undefined),
		scope: 'asset-editor'
	});

	useCommand({
		enabled: hasCutout && !progress,
		id: 'assetEditor.invertCutout',
		label: t('hotkeys.commands.assetEditor.invertCutout'),
		run: () => toggleInvert(!tuning.invert),
		scope: 'asset-editor'
	});

	useCommand({
		enabled: maskModes.length > 1,
		id: 'assetEditor.cycleMaskMode',
		label: t('hotkeys.commands.assetEditor.cycleMaskMode'),
		run: () =>
			setMaskMode(
				current =>
					MASK_MODES[(MASK_MODES.indexOf(current) + 1) % MASK_MODES.length]
			),
		scope: 'asset-editor'
	});

	useCommand({
		enabled: hasMask && !busy,
		id: 'assetEditor.clearMask',
		label: t('hotkeys.commands.assetEditor.clearMask'),
		run: () => {
			setMask({shapes: []});
			setSelectedShape(undefined);
		},
		scope: 'asset-editor'
	});

	useCommand({
		enabled: cropped,
		id: 'assetEditor.resetCrop',
		label: t('hotkeys.commands.assetEditor.resetCrop'),
		run: resetCrop,
		scope: 'asset-editor'
	});

	// Both saves are chords, and allowed in inputs, because the name field is
	// where focus normally is by the time either is wanted.

	useCommand({
		allowInInput: true,
		enabled: !saveDisabled,
		id: 'assetEditor.saveAsNew',
		label: t('hotkeys.commands.assetEditor.saveAsNew'),
		// Detached editing has one destination rather than two, so the same key
		// commits the edit there instead. Saving as new opens the name prompt--the
		// name is no longer sitting in a field waiting to be used.
		run: detached ? handleApply : () => setSaveAsOpen(true),
		scope: 'asset-editor'
	});

	useCommand({
		allowInInput: true,
		enabled: !saveDisabled && !detached,
		id: 'assetEditor.replace',
		label: t('hotkeys.commands.assetEditor.replace'),
		run: () => setReplaceOpen(true),
		scope: 'asset-editor'
	});

	/**
	 * What the edit can become. Detached editing has one destination--back to whoever
	 * opened the dialog--where a library asset has two, and the difference between them
	 * is the whole reason both buttons say what they replace.
	 */
	const saveActions = detached ? (
		<IconButton
			commandId="assetEditor.saveAsNew"
			disabled={saveDisabled}
			icon={<IconDeviceFloppy />}
			label={t('dialogs.assetEditor.apply')}
			onClick={handleApply}
			variant="create"
		/>
	) : (
		<>
			<PromptButton
				commandId="assetEditor.saveAsNew"
				disabled={saveDisabled}
				icon={<IconFilePlus />}
				label={t('dialogs.assetEditor.saveAsNew')}
				onChange={event => setName(event.target.value)}
				onChangeOpen={setSaveAsOpen}
				onSubmit={handleSave}
				open={saveAsOpen}
				prompt={t('dialogs.assetEditor.saveAsPrompt')}
				submitIcon={<IconFilePlus />}
				submitLabel={t('dialogs.assetEditor.saveAsSubmit')}
				submitVariant="create"
				validate={validateSaveName}
				value={name}
			/>
			<ConfirmButton
				commandId="assetEditor.replace"
				confirmVariant="danger"
				disabled={saveDisabled}
				icon={<IconDeviceFloppy />}
				label={t('dialogs.assetEditor.replace')}
				onChangeOpen={setReplaceOpen}
				onConfirm={handleReplace}
				open={replaceOpen}
				prompt={t('dialogs.assetEditor.replacePrompt', {
					name: meta?.name ?? ''
				})}
				variant="create"
			/>
		</>
	);

	return (
		<DialogCard
			{...props}
			className="asset-editor-dialog"
			focusOnOpen
			headerControls={
				!detached &&
				meta && (
					<PromptButton
						altSubmit={
							usedIn.length > 0
								? {
										icon: <IconWriting />,
										label: t('dialogs.assetEditor.renameUpdateScenes', {
											count: usedIn.length
										}),
										onSubmit: value => handleRename(value, true)
								  }
								: undefined
						}
						icon={<IconWriting />}
						iconOnly
						label={t('common.rename')}
						onChange={event => setRenameName(event.target.value)}
						onChangeOpen={setRenameOpen}
						onSubmit={handleRename}
						open={renameOpen}
						prompt={t('common.renamePrompt', {name: meta.name})}
						tooltipPosition="bottom"
						validate={validateRename}
						value={renameName}
					/>
				)
			}
			// The title is the asset's name, so a double click on it renames, the same
			// gesture that renames a tile's name in the asset browser.
			headerDisplayLabel={
				<span
					onDoubleClick={
						!detached && meta ? () => setRenameOpen(true) : undefined
					}
					title={!detached && meta ? t('common.rename') : undefined}
				>
					{t('dialogs.assetEditor.title', {
						name: meta?.name ?? sourceImage?.name ?? ''
					})}
				</span>
			}
			headerLabel={t('dialogs.assetEditor.title', {
				name: meta?.name ?? sourceImage?.name ?? ''
			})}
			hotkeyScope="asset-editor"
			maximizable
		>
			{error && (
				<p className="asset-editor-error" role="alert">
					{error}
				</p>
			)}
			{source && edits ? (
				<>
					<EditorToolbar
						actions={saveActions}
						dirty={dirty}
						generateHint={t(
							dirty
								? 'dialogs.assetEditor.generateWithDirtyHint'
								: 'dialogs.assetEditor.generateWithHint'
						)}
						note={
							<NoteBody kind="info" note={saveNote}>
								{detached
									? t('dialogs.assetEditor.applyNote', {
											height: edits.height,
											width: edits.width
									  })
									: t('dialogs.assetEditor.saveNote', {
											height: edits.height,
											width: edits.width
									  })}
							</NoteBody>
						}
						mode={maskMode}
						modes={maskModes}
						noteButton={
							<NoteButton
								kind="info"
								label={t('dialogs.assetEditor.save')}
								note={saveNote}
							/>
						}
						onChangeMode={setMaskMode}
						onGenerate={detached ? undefined : handleGenerate}
						onSelectTool={selectTool}
						tool={tool}
						tools={TOOL_IDS}
					/>
					<div className="asset-editor">
						<div className="asset-editor-stage">
							<div
								className={classNames('asset-editor-canvas', {picking})}
								onPointerDown={handlePointerDown}
								onPointerMove={handlePointerMove}
								onPointerUp={handlePointerUp}
								ref={canvasBox}
							>
								<canvas ref={preview} />
								{!detached && (
									<AnchorOverlay
										art={preview}
										container={canvasBox}
										label={t('components.anchorSelect.readout', {
											x: origin.x.toFixed(3),
											y: origin.y.toFixed(3)
										})}
										origin={origin}
									/>
								)}
								{/* After the anchor marker, so a vertex handle is never buried
								    under the cross. Nothing fights for the pointer: the marker
								    is `pointer-events: none`, the overlay returns null under
								    `rendered`, and the crop drag underneath is already behind a
								    `tool === 'size'` guard the mask tool does not pass. */}
								{tool === 'mask' && (
									<MaskOverlay
										art={preview}
										container={canvasBox}
										disabled={busy}
										feather={maskFeather}
										height={source.height}
										mask={mask}
										mode={maskMode}
										onChange={setMask}
										onSelect={setSelectedShape}
										op={maskOp}
										selected={selectedShape}
										tool={maskTool}
										width={source.width}
									/>
								)}
							</div>
							<p className="asset-editor-hint">
								{t(
									picking
										? 'dialogs.assetEditor.anchorHint'
										: tool === 'mask'
										? 'dialogs.assetEditor.maskHint'
										: tool === 'size'
										? 'dialogs.assetEditor.cropHint'
										: 'dialogs.assetEditor.sizeToolHint'
								)}
							</p>
						</div>
						<div className="asset-editor-controls">
							{tool === 'adjust' && (
								<EditorSection
									icon={<IconAdjustments />}
									note={adjustNote}
									title={t('dialogs.assetEditor.adjust')}
								>
									<NoteBody kind="info" note={adjustNote}>
										{t('dialogs.assetEditor.adjustNote')}
									</NoteBody>
									<AdjustSlider
										label={t('dialogs.assetEditor.brightness')}
										max={LEVEL_RANGE.max}
										min={LEVEL_RANGE.min}
										onChange={brightness => changeEdits({brightness})}
										resetLabel={t('dialogs.assetEditor.reset')}
										resetTo={0}
										step={LEVEL_RANGE.step}
										value={edits.brightness}
									/>
									<AdjustSlider
										label={t('dialogs.assetEditor.contrast')}
										max={LEVEL_RANGE.max}
										min={LEVEL_RANGE.min}
										onChange={contrast => changeEdits({contrast})}
										resetLabel={t('dialogs.assetEditor.reset')}
										resetTo={0}
										step={LEVEL_RANGE.step}
										value={edits.contrast}
									/>
									<AdjustSlider
										label={t('dialogs.assetEditor.gamma')}
										max={GAMMA_RANGE.max}
										min={GAMMA_RANGE.min}
										onChange={gamma => changeEdits({gamma})}
										resetLabel={t('dialogs.assetEditor.reset')}
										resetTo={1}
										step={GAMMA_RANGE.step}
										value={edits.gamma}
									/>
								</EditorSection>
							)}
							{tool === 'size' && (
								<>
									<EditorSection
										detail={`${edits.width}×${edits.height}`}
										icon={<IconResize />}
										note={sizeNote}
										title={t('dialogs.assetEditor.size')}
									>
										<NoteBody kind="info" note={sizeNote}>
											{t('dialogs.assetEditor.sizeNote')}
										</NoteBody>
										<div className="asset-editor-size">
											<label className="asset-editor-number">
												<span>{t('dialogs.assetEditor.width')}</span>
												<input
													min={1}
													onChange={event =>
														changeWidth(Number(event.target.value))
													}
													type="number"
													value={edits.width}
												/>
											</label>
											<label className="asset-editor-number">
												<span>{t('dialogs.assetEditor.height')}</span>
												<input
													min={1}
													onChange={event =>
														changeHeight(Number(event.target.value))
													}
													type="number"
													value={edits.height}
												/>
											</label>
										</div>
										<ButtonBar>
											<CheckboxButton
												icon={<IconLink />}
												label={t('dialogs.assetEditor.lockAspect')}
												onChange={setLockAspect}
												value={lockAspect}
											/>
											<IconButton
												disabled={
													edits.width === edits.crop.w &&
													edits.height === edits.crop.h
												}
												icon={<IconResize />}
												label={t('dialogs.assetEditor.resetSize')}
												onClick={() =>
													changeEdits({
														height: edits.crop.h,
														width: edits.crop.w
													})
												}
											/>
										</ButtonBar>
									</EditorSection>
									<EditorSection
										detail={t('dialogs.assetEditor.cropDetail', {
											height: edits.crop.h,
											width: edits.crop.w,
											x: edits.crop.x,
											y: edits.crop.y
										})}
										icon={<IconCrop />}
										title={t('dialogs.assetEditor.crop')}
									>
										<ButtonBar>
											<IconButton
												commandId="assetEditor.resetCrop"
												disabled={!cropped}
												icon={<IconCrop />}
												label={t('dialogs.assetEditor.resetCrop')}
												onClick={resetCrop}
											/>
										</ButtonBar>
									</EditorSection>
									{!detached && (
										<EditorSection
											icon={<IconTarget />}
											note={anchorNote}
											title={t('dialogs.assetEditor.anchor')}
										>
											<NoteBody kind="info" note={anchorNote}>
												{t('dialogs.assetEditor.anchorNote')}
											</NoteBody>
											<AnchorSelect
												disabled={busy}
												onChange={setOrigin}
												onChangePicking={setPicking}
												origin={origin}
												pickHint={t('dialogs.assetEditor.anchorHint')}
												picking={picking}
											/>
										</EditorSection>
									)}
								</>
							)}
							{tool === 'background' && (
								<EditorSection
									icon={<IconWand />}
									title={t('dialogs.assetEditor.background')}
								>
									<ButtonBar>
										<IconButton
											commandId="assetEditor.removeBackground"
											disabled={
												busy || hasCutout || !background?.engine
											}
											icon={<IconWand />}
											label={t('dialogs.assetEditor.removeBackground')}
											onClick={handleRemoveBackground}
										/>
										{onCpu && (
											<span data-testid="asset-editor-cpu-warning">
												<NoteButton
													kind="warning"
													label={t('dialogs.assetEditor.background')}
													note={cpuNote}
												/>
											</span>
										)}
										<NoteButton
											kind="info"
											label={t('dialogs.assetEditor.background')}
											note={engineNote}
										/>
										{progress && (
											<IconButton
												icon={<IconX />}
												label={t('common.cancel')}
												onClick={() => cancel.current?.abort()}
											/>
										)}
										{hasCutout && !progress && (
											<>
												<CheckboxButton
													commandId="assetEditor.invertCutout"
													disabled={busy}
													icon={<IconContrast />}
													label={t('dialogs.assetEditor.invertCutout')}
													onChange={toggleInvert}
													value={!!tuning.invert}
												/>
												<IconButton
													commandId="assetEditor.restoreBackground"
													disabled={busy}
													icon={<IconEraser />}
													label={t('dialogs.assetEditor.restoreBackground')}
													onClick={() => setAlpha(undefined)}
												/>
											</>
										)}
									</ButtonBar>
									{onCpu && (
										<NoteBody kind="warning" note={cpuNote}>
											{t('dialogs.assetEditor.cpuWarning', {
												reason: t(
													background?.gpuReasonKey ??
														'dialogs.assetEditor.needsWebGpu'
												),
												size: megabytes(background?.engine?.bytes ?? 0)
											})}
										</NoteBody>
									)}
									<NoteBody kind="info" note={engineNote}>
										{background?.engine
											? t(
													onCpu
														? 'dialogs.assetEditor.cpuEngineNote'
														: 'dialogs.assetEditor.engineNote',
													{
														gpu:
															webGpuDescription() ??
															t('dialogs.assetEditor.unknownGpu'),
														license: background.engine.license,
														name: background.engine.label,
														resolution: background.engine.resolution,
														size: megabytes(background.engine.bytes)
													}
											  )
											: background &&
											  t(
													background.support.reasonKey ??
														'dialogs.assetEditor.needsWebGpu'
											  )}
									</NoteBody>
									{alpha && !progress && (
										<>
											<AdjustSlider
												label={t('dialogs.assetEditor.threshold')}
												max={0.95}
												min={0.05}
												onChange={threshold => retune({...tuning, threshold})}
												resetLabel={t('dialogs.assetEditor.reset')}
												resetTo={DEFAULT_TUNING.threshold}
												step={0.01}
												value={tuning.threshold}
											/>
											<AdjustSlider
												label={t('dialogs.assetEditor.softness')}
												max={1}
												min={0.02}
												onChange={softness => retune({...tuning, softness})}
												resetLabel={t('dialogs.assetEditor.reset')}
												resetTo={DEFAULT_TUNING.softness}
												step={0.02}
												value={tuning.softness}
											/>
											<p className="asset-editor-detail">
												{t('dialogs.assetEditor.tuningNote')}
											</p>
											<p className="asset-editor-detail">
												{t('dialogs.assetEditor.invertNote')}
											</p>
										</>
									)}
									{progress && (
										<div className="asset-editor-progress" aria-busy>
											<div
												className={classNames('asset-editor-progress-track', {
													indeterminate: progress.progress === undefined
												})}
											>
												<div
													className="asset-editor-progress-bar"
													style={
														progress.progress === undefined
															? undefined
															: {
																	width: `${Math.round(
																		progress.progress * 100
																	)}%`
															  }
													}
												/>
											</div>
											<p className="asset-editor-detail" role="status">
												<span className="asset-editor-step">
													{t('dialogs.assetEditor.step', {
														step: STAGE_STEPS[progress.stage],
														steps: STAGE_COUNT
													})}
												</span>{' '}
												{t(stageKey(progress, onCpu), {
													percent: Math.round((progress.progress ?? 0) * 100)
												})}{' '}
												<span className="asset-editor-elapsed">
													{elapsedLabel(elapsed)}
												</span>
											</p>
											{elapsed >= SLOW_SECONDS && (
												<p className="asset-editor-detail">
													{t(
														onCpu
															? 'dialogs.assetEditor.cpuSlowNote'
															: 'dialogs.assetEditor.slowNote'
													)}
												</p>
											)}
										</div>
									)}
								</EditorSection>
							)}
							{tool === 'mask' && (
								<MaskTool
									disabled={busy}
									feather={maskFeather}
									mask={mask}
									mode={maskMode}
									onChange={setMask}
									onChangeFeather={setMaskFeather}
									onChangeOp={setMaskOp}
									onChangeTool={setMaskTool}
									onSelect={setSelectedShape}
									op={maskOp}
									selected={selectedShape}
									tool={maskTool}
								/>
							)}
						</div>
					</div>
				</>
			) : (
				!error && (
					<p className="sliders-empty">{t('dialogs.assetEditor.loading')}</p>
				)
			)}
		</DialogCard>
	);
};
