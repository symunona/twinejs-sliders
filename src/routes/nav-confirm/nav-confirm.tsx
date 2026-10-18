import {IconArrowLeft, IconX} from '@tabler/icons';
import FocusTrap from 'focus-trap-react';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {useHistory} from 'react-router-dom';
import {ButtonBar} from '../../components/container/button-bar';
import {Card, CardContent} from '../../components/container/card';
import {IconButton} from '../../components/control/icon-button';
import {NavConfirmRequest} from './use-nav-confirm';
import './nav-confirm.css';

/** Mouse: left button only. Touch and pen presses have no other button. */
function isPrimaryPress(event: MouseEvent | TouchEvent) {
	return !('button' in event) || event.button === 0;
}

export interface NavConfirmProps {
	request: NavConfirmRequest | null;
}

/**
 * The modal shown when a <Prompt> blocks navigation. Rendered above everything
 * else, and outside the route being left--the route is still mounted while this
 * is open, and stays mounted if the answer is no.
 */
export const NavConfirm: React.FC<NavConfirmProps> = ({request}) => {
	const history = useHistory();
	const {t} = useTranslation();

	if (!request) {
		return null;
	}

	// Staying after a back or forward has to put the URL back: the browser moved it
	// before anyone asked. history's own revert counts steps in a list of paths it has
	// seen since page load, so after a reload it knows none, reverts nothing, and leaves
	// the editor on screen under the story list's URL -- the next back then walks out of
	// the app without a word. Under a hash router, re-push the URL of what is still on
	// screen instead and never tell history: it needs no revert, and the next back is an
	// ordinary POP to the story list that asks again.
	const stay = () => {
		const href = history?.createHref(history.location);

		if (!href?.startsWith('#') || window.location.hash === href) {
			request.respond(false);
			return;
		}

		if (request.cancel()) {
			window.history.pushState(window.history.state, '', href);
		}
	};

	return (
		<div className="nav-confirm-backdrop">
			{/* Escape and clicks outside deactivate the trap, which is the same as
			answering no--the safe choice. Left clicks only: the right-button tail of a
			mouse gesture, or a context click, is not an answer. */}
			<FocusTrap
				focusTrapOptions={{
					clickOutsideDeactivates: isPrimaryPress,
					onDeactivate: stay
				}}
			>
				<div aria-label={request.message} className="nav-confirm" role="dialog">
					<Card floating>
						<CardContent>
							<p>{request.message}</p>
						</CardContent>
						<ButtonBar>
							<IconButton
								icon={<IconArrowLeft />}
								label={t('routes.navConfirm.leave')}
								onClick={() => request.respond(true)}
								variant="danger"
							/>
							<IconButton
								icon={<IconX />}
								label={t('routes.navConfirm.stay')}
								onClick={stay}
								variant="primary"
							/>
						</ButtonBar>
					</Card>
				</div>
			</FocusTrap>
		</div>
	);
};
