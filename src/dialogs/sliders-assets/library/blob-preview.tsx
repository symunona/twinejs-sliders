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
	}, [engine, sha]);

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
