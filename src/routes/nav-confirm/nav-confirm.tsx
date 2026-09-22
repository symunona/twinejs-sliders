import {IconArrowLeft, IconX} from '@tabler/icons';
import FocusTrap from 'focus-trap-react';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {ButtonBar} from '../../components/container/button-bar';
import {Card, CardContent} from '../../components/container/card';
import {IconButton} from '../../components/control/icon-button';
import {NavConfirmRequest} from './use-nav-confirm';
import './nav-confirm.css';

export interface NavConfirmProps {
	request: NavConfirmRequest | null;
}

/**
 * The modal shown when a <Prompt> blocks navigation. Rendered above everything
 * else, and outside the route being left--the route is still mounted while this
 * is open, and stays mounted if the answer is no.
 */
export const NavConfirm: React.FC<NavConfirmProps> = ({request}) => {
	const {t} = useTranslation();

	if (!request) {
		return null;
	}

	return (
		<div className="nav-confirm-backdrop">
			{/* Escape and clicks outside deactivate the trap, which is the same as
			answering no--the safe choice. */}
			<FocusTrap
				focusTrapOptions={{
					clickOutsideDeactivates: true,
					onDeactivate: () => request.respond(false)
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
								onClick={() => request.respond(false)}
								variant="primary"
							/>
						</ButtonBar>
					</Card>
				</div>
			</FocusTrap>
		</div>
	);
};
