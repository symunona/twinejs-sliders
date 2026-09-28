import {LibraryEngine} from '@sliders/asset-library';
import * as React from 'react';

export interface BlobPreviewProps {
	alt: string;
	engine: LibraryEngine;
	/** Blob sha. Old revs' blobs are fetched on demand; the server keeps them. */
	sha?: string;
}

/** A picture by blob sha, not by asset: a rev, a conflict side, a Versions row. */
export const BlobPreview: React.FC<BlobPreviewProps> = props => {
	const {alt, engine, sha} = props;
	const [url, setUrl] = React.useState<string>();
	const [failed, setFailed] = React.useState(false);
	// A fetch that failed offline is retried once the engine hears the network again.
	const [attempt, setAttempt] = React.useState(0);

	React.useEffect(() => {
		if (!failed) {
			return;
		}

		// Only on the offline → online edge: a blob that is really gone must not loop.
		let offline = engine.status().offline;

		return engine.onStatus(status => {
			if (offline && !status.offline) {
				setAttempt(value => value + 1);
			}

			offline = status.offline;
		});
	}, [engine, failed]);

	React.useEffect(() => {
		let live = true;

		setUrl(undefined);
		setFailed(false);

		if (sha) {
			engine.blobUrl(sha).then(
				result => live && setUrl(result),
				() => live && setFailed(true)
			);
		}

		return () => {
			live = false;
		};
	}, [engine, sha, attempt]);

	return (
		<span className="asset-preview library-blob-preview" data-sha={sha}>
			{url ? (
				<img alt={alt} src={url} />
			) : (
				<span className="asset-preview-empty">{failed ? '?' : ''}</span>
			)}
		</span>
	);
};
