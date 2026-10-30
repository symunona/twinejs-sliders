import * as React from 'react';
import {isTextEntry} from '../../../hotkeys';
import {
	heldClip,
	heldClipFor,
	holdClip,
	readClip,
	SCENE_CLIP_MIME,
	SceneClip,
	subscribeClip
} from './scene-clipboard';

export interface SceneClipboardOptions {
	/** Is a copy / paste with focus on this element the stage's? */
	owns: (target: Element) => boolean;
	/** The selection as a clip, or undefined to leave the copy to the browser. */
	copy: () => SceneClip | undefined;
	/** Undefined while the stage cannot be written (locked, read only). */
	paste?: (clip: SceneClip) => void;
}

/**
 * Ctrl/Cmd+C and Ctrl/Cmd+V on the stage, as `copy` / `paste` EVENTS rather than hotkeys:
 * only the event can write a custom type to the clipboard, and a keydown command for
 * mod+v would `preventDefault` the paste a picture on the clipboard needs (`useImagePaste`).
 *
 * Typing wins: in a text field or CodeMirror, and with text selected anywhere, the browser
 * copies and pastes as it always did. A paste only takes a clip -- an image or plain text
 * passes through to whoever wants it.
 *
 * Returns the in-page copy / paste the Copy and Paste buttons use, and whether there is
 * something held to paste.
 */
export function useSceneClipboard(
	options: SceneClipboardOptions,
	doc: Document | null = typeof document === 'undefined' ? null : document
) {
	const latest = React.useRef(options);
	const [held, setHeld] = React.useState(() => !!heldClip());

	latest.current = options;

	React.useEffect(() => subscribeClip(() => setHeld(!!heldClip())), []);

	React.useEffect(() => {
		if (!doc) {
			return;
		}

		function stageTarget(event: ClipboardEvent): boolean {
			const target =
				event.target instanceof Element ? event.target : doc!.activeElement;

			return (
				!event.defaultPrevented &&
				!!target &&
				!isTextEntry(target) &&
				latest.current.owns(target)
			);
		}

		function handleCopy(event: ClipboardEvent) {
			if (!stageTarget(event) || doc!.getSelection?.()?.toString()) {
				return;
			}

			const clip = latest.current.copy();

			if (!clip) {
				return;
			}

			const text = holdClip(clip);

			event.clipboardData?.setData('text/plain', text);
			event.clipboardData?.setData(SCENE_CLIP_MIME, JSON.stringify(clip));
			event.preventDefault();
		}

		function handlePaste(event: ClipboardEvent) {
			const paste = latest.current.paste;

			if (!paste || !stageTarget(event)) {
				return;
			}

			const data = event.clipboardData;
			const clip =
				readClip(data?.getData(SCENE_CLIP_MIME)) ??
				heldClipFor(data?.getData('text/plain'));

			if (!clip) {
				return;
			}

			event.preventDefault();
			paste(clip);
		}

		doc.addEventListener('copy', handleCopy);
		doc.addEventListener('paste', handlePaste);

		return () => {
			doc.removeEventListener('copy', handleCopy);
			doc.removeEventListener('paste', handlePaste);
		};
	}, [doc]);

	/** The Copy button: held in the page, and its YAML put on the clipboard if allowed. */
	const copyNow = React.useCallback(() => {
		const clip = latest.current.copy();

		if (!clip) {
			return;
		}

		const text = holdClip(clip);

		void navigator.clipboard?.writeText?.(text).catch(() => undefined);
	}, []);

	/** The Paste button: whatever was last copied in this page. */
	const pasteNow = React.useCallback(() => {
		const clip = heldClip();

		if (clip) {
			latest.current.paste?.(clip);
		}
	}, []);

	/** Any clip, the paste way. Undefined while the stage cannot be written. */
	const pasteClip = React.useCallback(
		(clip: SceneClip) => latest.current.paste?.(clip),
		[]
	);

	return {copyNow, held, pasteClip, pasteNow};
}
