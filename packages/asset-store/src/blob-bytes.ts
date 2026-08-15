/**
 * Reads a Blob's bytes. `Blob.arrayBuffer()` is the fast path, but it's missing in some
 * older WebViews (and in jsdom), so fall back to FileReader rather than fail an upload.
 */
export function blobBytes(blob: Blob): Promise<ArrayBuffer> {
	if (typeof blob.arrayBuffer === 'function') {
		return blob.arrayBuffer();
	}

	return new Promise((resolve, reject) => {
		const reader = new FileReader();

		reader.onload = () => resolve(reader.result as ArrayBuffer);
		reader.onerror = () => reject(reader.error);
		reader.readAsArrayBuffer(blob);
	});
}
