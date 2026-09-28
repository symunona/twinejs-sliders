/**
 * Asset records open in an editor right now. The Library toasts a remote delete only
 * for these (plan 2, "Toasts": remote delete of something open).
 */
const open = new Map<string, number>();

/** Marks an asset open; call the returned function when it closes. */
export function markAssetOpen(id: string): () => void {
	open.set(id, (open.get(id) ?? 0) + 1);

	return () => {
		const count = (open.get(id) ?? 1) - 1;

		if (count > 0) {
			open.set(id, count);
		} else {
			open.delete(id);
		}
	};
}

export function isAssetOpen(id: string): boolean {
	return open.has(id);
}
