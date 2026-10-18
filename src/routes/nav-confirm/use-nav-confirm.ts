import * as React from 'react';
import {consumeLeaveWithoutAsking} from '../../util/leave-without-asking';

export interface NavConfirmRequest {
	message: string;
	/**
	 * Answer the router. Only the first answer counts: the modal's focus trap reports
	 * "no" again as it unmounts, and a second `false` would make history revert a
	 * navigation twice.
	 */
	respond: (leave: boolean) => void;
	/**
	 * Close without answering. For when the caller puts the URL back itself -- history
	 * is never told, so it neither moves nor reverts anything. `false` if already
	 * answered.
	 */
	cancel: () => boolean;
}

export interface UseNavConfirmResult {
	/**
	 * Pass to <HashRouter getUserConfirmation>. Stable for the life of the app,
	 * which matters: the router hands this to its history object once, at mount,
	 * so it can never see a later closure.
	 */
	getUserConfirmation: (
		message: string,
		callback: (leave: boolean) => void
	) => void;
	request: NavConfirmRequest | null;
}

/**
 * Replaces the `window.confirm` that react-router uses for <Prompt> with a
 * request a component can render. history's confirmation callback is async, so
 * answering it from a modal instead of a blocking dialog is allowed.
 *
 * A navigation sent through `leaveWithoutAsking` (the toolbar's Back button) is let
 * through without a modal.
 */
export function useNavConfirm(): UseNavConfirmResult {
	const [request, setRequest] = React.useState<NavConfirmRequest | null>(null);
	const getUserConfirmation = React.useCallback(
		(message: string, callback: (leave: boolean) => void) => {
			if (consumeLeaveWithoutAsking()) {
				callback(true);
				return;
			}

			let answered = false;
			const answer = () => {
				if (answered) {
					return false;
				}

				answered = true;
				setRequest(null);
				return true;
			};

			setRequest({
				message,
				cancel: answer,
				respond: leave => {
					if (answer()) {
						callback(leave);
					}
				}
			});
		},
		[]
	);

	return {getUserConfirmation, request};
}
