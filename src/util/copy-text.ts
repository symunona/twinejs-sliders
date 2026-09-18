/**
 * Put a line on the clipboard.
 *
 * `navigator.clipboard` is missing in jsdom and refused on an insecure origin, and neither
 * case is worth an unhandled rejection in a tile's click handler — the author sees nothing
 * arrive and tries the drag instead, which is the other half of every gesture this is used
 * for. Returns whether it worked, for a caller that wants to say so.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		await navigator.clipboard.writeText(text);
		return true;
	} catch {
		return false;
	}
}
