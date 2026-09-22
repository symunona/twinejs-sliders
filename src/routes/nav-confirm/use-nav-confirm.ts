import * as React from 'react';

export interface NavConfirmRequest {
	message: string;
	respond: (leave: boolean) => void;
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
 */
export function useNavConfirm(): UseNavConfirmResult {
	const [request, setRequest] = React.useState<NavConfirmRequest | null>(null);
	const getUserConfirmation = React.useCallback(
		(message: string, callback: (leave: boolean) => void) =>
			setRequest({
				message,
				respond: leave => {
					setRequest(null);
					callback(leave);
				}
			}),
		[]
	);

	return {getUserConfirmation, request};
}
