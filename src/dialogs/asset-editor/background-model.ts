/**
 * Facts about the background removal model, kept apart from the code that runs
 * it. The dialog needs to describe the model before the author asks for it, and
 * importing `remove-background` to do that would pull the whole ONNX runtime
 * into the main bundle.
 */

/**
 * U²-Net Lite, the small variant of the U²-Net saliency model. Picked over the
 * better-known background removers because it's the most permissively licensed
 * one that runs in a browser: U²-Net is Apache-2.0, while RMBG-1.4 and MODNet
 * both ship their weights non-commercial. BiRefNet is MIT but 25× the download.
 *
 * It runs on this machine. No image ever leaves it.
 */
export const BACKGROUND_MODEL = {
	bytes: 4574861,
	license: 'Apache-2.0',
	name: 'U²-Net Lite',
	url: 'https://huggingface.co/Heliosoph/u2net-onnx/resolve/main/u2netp.onnx'
};

export interface BackgroundProgress {
	/** `download` is the one-off model fetch; `run` is the model thinking. */
	stage: 'download' | 'start' | 'run';
	/** 0 to 1, during the download only. */
	progress?: number;
}

export type BackgroundProgressHandler = (progress: BackgroundProgress) => void;
