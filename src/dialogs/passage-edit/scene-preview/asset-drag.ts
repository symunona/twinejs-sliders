/**
 * The drag payload that carries a tile from the asset manager onto the stage (spec 07,
 * "Drag from asset panel onto stage").
 *
 * The payload carries a `ref`, which is the token that will be WRITTEN into the YAML: an
 * asset's NAME or a character's id. Never a store id. Scene YAML addresses assets by name
 * because ids like `a_8f21` are unwritable, and `use-preview-resolver` accepting either is a
 * courtesy to hand-written text, not a licence to generate ids. Deciding this at the drag
 * SOURCE, where the name is in hand, means the drop target cannot get it wrong.
 *
 * A dedicated MIME type rather than `text/plain`, so that dragging a file in from the
 * desktop and dragging a tile from the panel are never confused. `text/plain` is set as well
 * — dropping a tile into the passage text then pastes the scene fragment, which costs
 * nothing and is what an author would expect to happen.
 */

export const ASSET_DRAG_MIME = 'application/x-sliders-asset';

export interface AssetDragPayload {
	/** What the drop writes: a `cast:` entry, a `props:` entry, or `bg:`. */
	target: 'cast' | 'prop' | 'bg';
	/** Exactly the token that goes into the text — a character id, or an asset NAME. */
	ref: string;
	/** For the drag image and the drop hint only. Never written. */
	label?: string;
}

/** Attach a payload to a dragstart. */
export function setAssetDragData(
	dataTransfer: DataTransfer,
	payload: AssetDragPayload,
	fragment?: string
): void {
	dataTransfer.effectAllowed = 'copy';
	dataTransfer.setData(ASSET_DRAG_MIME, JSON.stringify(payload));

	if (fragment) {
		dataTransfer.setData('text/plain', fragment);
	}
}

/**
 * Is this drag one of ours? Checked against `types` rather than the data, because during
 * `dragover` the browser refuses to hand over `getData` at all — only the type list is
 * readable until the drop actually happens.
 */
export function isAssetDrag(types: readonly string[] | undefined): boolean {
	return !!types && Array.prototype.includes.call(types, ASSET_DRAG_MIME);
}

/**
 * Image types the stage will take off the desktop.
 *
 * The list is the upload pipeline's, not the renderer's: PNG, JPEG and GIF are what people
 * actually have on disk, and `prepareUpload` already knows which of them to re-encode and
 * which to store verbatim (spec 03). SVG has no header magic worth trusting, so it is
 * matched by extension as well as by type.
 */
const IMAGE_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|svg)$/i;

function isImageFile(file: File): boolean {
	return (
		file.type.startsWith('image/') ||
		(!file.type && IMAGE_EXTENSIONS.test(file.name))
	);
}

/**
 * Is this drag carrying files from outside the app?
 *
 * `dragover` refuses to hand over the files themselves, so — exactly as with our own MIME —
 * the type list is all there is to go on until the drop actually happens.
 */
export function isFileDrag(types: readonly string[] | undefined): boolean {
	return !!types && Array.prototype.includes.call(types, 'Files');
}

/** The dropped images, in drop order. Empty when the drag carried none. */
export function imageFilesFrom(dataTransfer: DataTransfer | null): File[] {
	if (!dataTransfer) {
		return [];
	}

	return Array.from(dataTransfer.files ?? []).filter(isImageFile);
}

/** The payload, or undefined for anything that is not ours or has been mangled. */
export function readAssetDragData(
	dataTransfer: DataTransfer | null
): AssetDragPayload | undefined {
	if (!dataTransfer) {
		return undefined;
	}

	try {
		const raw = dataTransfer.getData(ASSET_DRAG_MIME);

		if (!raw) {
			return undefined;
		}

		const payload = JSON.parse(raw) as AssetDragPayload;

		if (
			typeof payload?.ref !== 'string' ||
			payload.ref === '' ||
			!['cast', 'prop', 'bg'].includes(payload?.target)
		) {
			return undefined;
		}

		return payload;
	} catch {
		return undefined;
	}
}
