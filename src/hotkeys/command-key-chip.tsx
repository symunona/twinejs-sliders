import * as React from 'react';
import {useHotkeysContext} from './hotkeys-context';
import {KeyChip} from './key-chip';

/**
 * The key a command is currently bound to, as a key string--or undefined if
 * the command has no binding, either because the keymap never gave it one or
 * because the user unbound it. Only the first binding is returned: a command
 * can have several (`mod+]` and `mod+up` both raise an entity), and showing
 * all of them in a tooltip is noise.
 */
export function useCommandKeyString(commandId?: string): string | undefined {
	const {keymap} = useHotkeysContext();

	if (!commandId) {
		return undefined;
	}

	return keymap[commandId]?.bindings[0] || undefined;
}

export interface CommandKeyChipProps {
	commandId?: string;
}

/**
 * Renders the key a command is bound to, or nothing if it has none.
 */
export const CommandKeyChip: React.FC<CommandKeyChipProps> = ({commandId}) => {
	const {platform} = useHotkeysContext();
	const keyString = useCommandKeyString(commandId);

	if (!keyString) {
		return null;
	}

	return <KeyChip keyString={keyString} platform={platform} />;
};
