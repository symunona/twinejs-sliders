import * as React from 'react';
import {CSSTransition} from 'react-transition-group';
import {usePopper} from 'react-popper';
import {Placement} from '@popperjs/core';
import './tooltip.css';

export interface TooltipProps {
	anchor: HTMLElement | null;
	label: string;
	position?: Placement;
}

// This component is intentionally limited in functionality. It should *only* be
// used to duplicate content that is only perceivable by screen readers or other
// assistive technology, e.g. through an `aria-label` attribute. The one use
// case right now in the app are icon-only buttons.
//
// Content in these components is *not* accessible to screen readers and should
// not be. That content should be placed in an `aria-label` attribute instead.

export const Tooltip: React.FC<TooltipProps> = props => {
	const {anchor, label, position = 'top'} = props;
	const [tooltipEl, setTooltipEl] = React.useState<HTMLDivElement | null>(null);
	const [arrowEl, setArrowEl] = React.useState<HTMLDivElement | null>(null);
	const [visible, setVisible] = React.useState(false);
	// A ref, not state: the timer is bookkeeping, and holding it in state re-ran the effect
	// below on every hover, tearing the anchor's listeners down and rebuilding them.
	const appearTimeout = React.useRef<number>();
	const {styles, attributes} = usePopper(anchor, tooltipEl, {
		modifiers: [{name: 'arrow', options: {element: arrowEl}}, {name: 'flip'}],
		placement: position,
		strategy: 'fixed'
	});

	React.useEffect(() => {
		const clearAppear = () => {
			if (appearTimeout.current !== undefined) {
				window.clearTimeout(appearTimeout.current);
				appearTimeout.current = undefined;
			}
		};
		const handleOnEnter = () => {
			clearAppear();
			appearTimeout.current = window.setTimeout(() => {
				appearTimeout.current = undefined;
				setVisible(true);
			}, 500);
		};
		const handleOnLeave = () => {
			clearAppear();
			setVisible(false);
		};

		if (!anchor) {
			return;
		}

		anchor.addEventListener('pointerenter', handleOnEnter);
		anchor.addEventListener('pointerleave', handleOnLeave);

		// The timer has to die with the component, not only with a pointerleave. A button
		// that is unmounted or reparented while the pointer is still on it — the scene
		// preview portalling itself to the body when it goes full screen — never gets one,
		// and the pending timer would then set state on something that is gone.
		return () => {
			clearAppear();
			anchor.removeEventListener('pointerenter', handleOnEnter);
			anchor.removeEventListener('pointerleave', handleOnLeave);
		};
	}, [anchor]);

	return (
		<CSSTransition
			classNames="fade-in-out"
			in={visible}
			mountOnEnter
			timeout={200}
			unmountOnExit
		>
			<div
				aria-hidden
				className="tooltip"
				ref={setTooltipEl}
				role="tooltip"
				style={styles.popper}
				{...attributes.popper}
			>
				<div className="tooltip-arrow" ref={setArrowEl} style={styles.arrow} />
				<div className="tooltip-label">{label}</div>
			</div>
		</CSSTransition>
	);
};
