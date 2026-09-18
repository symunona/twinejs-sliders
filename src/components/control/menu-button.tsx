import * as React from 'react';
import {createPortal} from 'react-dom';
import {usePopper} from 'react-popper';
import type {Placement} from '@popperjs/core';
import {CSSTransition} from 'react-transition-group';
import {ButtonBar, ButtonBarSeparator} from '../container/button-bar';
import {ButtonCard} from '../container/button-card';
import {IconEmpty} from '../image/icon';
import {IconButton, IconButtonProps} from './icon-button';
import './menu-button.css';
import {CheckboxButton} from './checkbox-button';
import {IconCheck} from '@tabler/icons';
import {useControlledOpen} from './use-controlled-open';

export interface UncheckableLabeledMenuItem {
	/**
	 * The command this item runs, if it has one--see `IconButtonProps`.
	 */
	commandId?: string;
	disabled?: boolean;
	label: string;
	onClick: () => void;
	/**
	 * Pointer enter (`true`) and leave (`false`) on this item, for a menu whose items
	 * PREVIEW their effect before they are chosen.
	 *
	 * The menu can vanish out from under the pointer -- a click elsewhere closes it and no
	 * leave event follows -- so a consumer that turns a preview on here must also turn it
	 * off from `onChangeOpen`. Nothing in the menu can do that for it: the items are gone
	 * by the time anyone could ask.
	 */
	onHover?: (hovering: boolean) => void;
	separator?: undefined;
	variant?: IconButtonProps['variant'];
}

export interface CheckableLabeledMenuItem extends UncheckableLabeledMenuItem {
	checkable: true;
	checked: boolean;
}

export type LabeledMenuItem =
	| UncheckableLabeledMenuItem
	| CheckableLabeledMenuItem;

export interface MenuSeparator {
	separator: true;
}

export interface MenuButtonProps extends Omit<IconButtonProps, 'onClick'> {
	items: (LabeledMenuItem | MenuSeparator)[];
	/**
	 * Called when the menu opens or closes. Only needed if a parent wants to
	 * control this--see `open`.
	 */
	onChangeOpen?: (value: boolean) => void;
	/**
	 * Is the menu open? Leave undefined to let the button manage itself.
	 * Setting it lets a parent open the menu programmatically, e.g. from a
	 * keyboard shortcut.
	 */
	open?: boolean;
	/**
	 * Where the menu hangs, if not below the button.
	 *
	 * For a menu that must not cover what it is about: the scene editor's frame menu opens
	 * upward, because dropping it down would land it on the very sprite whose pose the
	 * items are previewing. Popper still flips when the side it was asked for has no room.
	 */
	placement?: Placement;
}

export const MenuButton: React.FC<MenuButtonProps> = props => {
	const {
		items,
		onChangeOpen,
		open: controlledOpen,
		placement = 'bottom-end',
		...other
	} = props;
	const [buttonEl, setButtonEl] = React.useState<HTMLButtonElement | null>(
		null
	);
	const [menuEl, setMenuEl] = React.useState<HTMLDivElement | null>(null);
	const [open, setOpen] = useControlledOpen(controlledOpen, onChangeOpen);
	const {styles, attributes} = usePopper(buttonEl, menuEl, {
		// Right-aligned to the button by default, not centred under it. Popper's own default
		// is `bottom`, which hangs a wide menu off both sides of a narrow toolbar button and
		// pushes it past whatever panel edge is nearest.
		placement,
		strategy: 'fixed'
	});

	/**
	 * Closed by a click anywhere, through a ref rather than `setOpen` itself.
	 *
	 * `setOpen` changes identity whenever `onChangeOpen` does, and a caller passing an
	 * inline arrow -- the ordinary thing to write -- changes it on EVERY render. With
	 * `setOpen` in the dependency list this listener was then torn down and re-added while a
	 * click was still being dispatched: the DOM fixes a target's listener list when dispatch
	 * reaches it, so the removed one no longer ran and the freshly added one was not called
	 * either. The menu stayed open for exactly the callers whose items change state, which
	 * is most of them. The listener's lifetime is `open`, and nothing else.
	 */
	const setOpenRef = React.useRef(setOpen);

	setOpenRef.current = setOpen;

	React.useEffect(() => {
		if (!open) {
			return;
		}

		const closer = () => setOpenRef.current(false);

		document.addEventListener('click', closer);

		return () => document.removeEventListener('click', closer);
	}, [open]);

	return (
		<span className="menu-button">
			<IconButton
				{...other}
				onClick={() => setOpen(!open)}
				ref={setButtonEl}
			/>
			{/*
				Portalled to the body, not rendered in place.

				`.menu-button-menu` is z-index 2000, but that number is only ever compared
				against its siblings: the dialog stack sits inside `.dialog-transform-setter`,
				whose inline `transform` makes it a stacking context, inside `.dialogs`, which
				is `position: fixed` with no z-index of its own. From the root's point of view
				the whole dialog subtree paints at level 0, so anything portalled to the body
				with a z-index -- the full-screen scene editor at 1000 -- covered every menu
				opened from a dialog toolbar, 2000 or not.

				Raising `.dialogs` instead would put the dialog stack over the full-screen
				editor, which is backwards. `strategy: 'fixed'` was already set, so the
				popper's coordinates are viewport coordinates and survive the move unchanged.

				`CardButton` and `Tooltip` are trapped in exactly the same way.
			*/}
			{createPortal(
				<CSSTransition
					classNames="fade-out"
					in={open}
					mountOnEnter
					timeout={200}
					unmountOnExit
				>
					<div
						className="menu-button-menu"
						ref={setMenuEl}
						style={styles.popper}
						{...attributes.popper}
					>
						<ButtonCard floating>
							<ButtonBar orientation="vertical">
								{items.map((item, index) => {
									if (item.separator) {
										return <ButtonBarSeparator key={index} />;
									}

									return 'checkable' in item ? (
										<CheckboxButton
											checkedIcon={<IconCheck />}
											commandId={item.commandId}
											disabled={item.disabled}
											key={index}
											label={item.label}
											onChange={item.onClick}
											onPointerEnter={() => item.onHover?.(true)}
											onPointerLeave={() => item.onHover?.(false)}
											uncheckedIcon={<IconEmpty />}
											value={item.checked}
										/>
									) : (
										<IconButton
											commandId={item.commandId}
											disabled={item.disabled}
											icon={<IconEmpty />}
											key={index}
											label={item.label}
											onClick={item.onClick}
											onPointerEnter={() => item.onHover?.(true)}
											onPointerLeave={() => item.onHover?.(false)}
											variant={item.variant}
										/>
									);
								})}
							</ButtonBar>
						</ButtonCard>
					</div>
				</CSSTransition>,
				document.body
			)}
		</span>
	);
};
