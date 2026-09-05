import * as React from 'react';
import {useHotkeysContext} from '../../../hotkeys';

/** Height of the docked window the first time it opens. The author can resize it after. */
const DEFAULT_HEIGHT = 420;

const POPOUT_NAME = 'sliders-scene-preview';

/**
 * Copies every stylesheet the main document has (`<link rel="stylesheet">` and inline
 * `<style>`) into the popup's head, and keeps that in sync--Vite code-splits CSS, so a
 * stylesheet can show up after the popup already opened.
 */
function mirrorStylesheets(popoutDocument: Document): () => void {
	function clone(node: Element) {
		popoutDocument.head.appendChild(node.cloneNode(true));
	}

	function isStylesheet(node: Node): node is Element {
		return (
			node instanceof Element &&
			(node.tagName === 'STYLE' ||
				(node.tagName === 'LINK' &&
					node.getAttribute('rel') === 'stylesheet'))
		);
	}

	document.head.querySelectorAll('style, link[rel="stylesheet"]').forEach(clone);

	const observer = new MutationObserver(mutations => {
		for (const mutation of mutations) {
			mutation.addedNodes.forEach(node => {
				if (isStylesheet(node)) {
					clone(node);
				}
			});
		}
	});

	observer.observe(document.head, {childList: true});

	return () => observer.disconnect();
}

/**
 * Mirrors the theme markers `src/store/theme-setter.tsx` sets on the main document onto the
 * popup, so it isn't stuck in whatever theme happened to be current the moment it opened.
 */
function mirrorTheme(popoutDocument: Document): () => void {
	function apply() {
		popoutDocument.body.dataset.appTheme = document.body.dataset.appTheme;
		popoutDocument.documentElement.style.setProperty(
			'color-scheme',
			document.documentElement.style.getPropertyValue('color-scheme')
		);
	}

	apply();

	const observer = new MutationObserver(apply);

	observer.observe(document.body, {attributeFilter: ['data-app-theme']});
	observer.observe(document.documentElement, {attributeFilter: ['style']});

	return () => observer.disconnect();
}

/**
 * Opens (and tears down) a separate browser window carrying a live portal target, for the
 * scene preview's stage. Because the stage is portaled rather than copied, it is the SAME
 * React tree--state, and the live CodeMirror editor the stage writes through, are shared with
 * the passage editor for free. No messaging between windows is needed.
 *
 * Docks at the bottom of the screen the first time it opens (D: "open by default to the
 * bottom"), matching the fact that the preview already sits at the bottom of the passage
 * editor's own column.
 */
export function usePopoutWindow(
	open: boolean,
	title: string,
	/** Called when the author closes the popup window itself, e.g. via its titlebar. */
	onClosed?: () => void
): {container: HTMLElement | null; popout: Window | null} {
	const {registerDocument} = useHotkeysContext();
	const [container, setContainer] = React.useState<HTMLElement | null>(null);
	const [popout, setPopout] = React.useState<Window | null>(null);
	const titleRef = React.useRef(title);
	const onClosedRef = React.useRef(onClosed);

	titleRef.current = title;
	onClosedRef.current = onClosed;

	React.useEffect(() => {
		if (!open) {
			return;
		}

		// `availLeft`/`availTop` are missing from TS's `Screen` type (they're Firefox-era
		// additions most browsers still support), so they're read through a loose cast.
		const screen = window.screen as Screen & {
			availLeft?: number;
			availTop?: number;
		};
		const height = Math.min(DEFAULT_HEIGHT, screen.availHeight);
		const features = [
			`width=${screen.availWidth}`,
			`height=${height}`,
			`left=${screen.availLeft ?? 0}`,
			`top=${(screen.availTop ?? 0) + screen.availHeight - height}`
		].join(',');

		const win = window.open('', POPOUT_NAME, features);

		if (!win) {
			// Popup blocked. Nothing to portal into; the caller stays inline.
			return;
		}

		const root = win.document.createElement('div');

		root.className = 'scene-preview-popout-root';
		win.document.title = titleRef.current;

		// The stage fills this window, so the default body margin would show as a
		// border of page background around it--and percentage heights need a chain
		// of heights above them to resolve against.
		win.document.documentElement.style.height = '100%';
		win.document.body.style.height = '100%';
		win.document.body.style.margin = '0';
		win.document.body.style.overflow = 'hidden';
		win.document.body.appendChild(root);

		const cleanups = [
			mirrorStylesheets(win.document),
			mirrorTheme(win.document),
			registerDocument(win.document)
		];

		setPopout(win);
		setContainer(root);

		// There's no cross-browser reliable "this window closed" event, so poll for it.
		// The timer has to belong to THIS window: one created in the popup stops running
		// the moment the popup closes, which is the only thing it exists to notice.
		const poll = window.setInterval(() => {
			if (win.closed) {
				window.clearInterval(poll);
				setPopout(null);
				setContainer(null);
				onClosedRef.current?.();
			}
		}, 500);

		// Reloading or leaving the main window tears down the React tree that draws
		// into the popup, but the popup itself would survive--showing a stage that
		// no longer updates. Take it with us.
		const closePopout = () => win.close();

		window.addEventListener('pagehide', closePopout);

		return () => {
			window.clearInterval(poll);
			window.removeEventListener('pagehide', closePopout);

			for (const cleanup of cleanups) {
				cleanup();
			}

			setPopout(null);
			setContainer(null);

			if (!win.closed) {
				win.close();
			}
		};
	}, [open, registerDocument]);

	return {container, popout};
}
