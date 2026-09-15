import * as React from 'react';
import {useTranslation} from 'react-i18next';

export interface TileUsesProps {
	/** Passage names that write this asset's name. Empty means nothing does. */
	passages: string[];
}

/**
 * The scenes a tile's art appears in, on ONE line.
 *
 * A tile is 160px wide and there can be twenty passages, so the list is ellipsized and the
 * full thing lives in the tooltip. The count leads: "how many" is readable at a glance even
 * when the names are cut after the first, and it is the number that decides whether deleting
 * this is safe.
 */
export const TileUses: React.FC<TileUsesProps> = props => {
	const {passages} = props;
	const {t} = useTranslation();

	if (passages.length === 0) {
		return null;
	}

	const names = passages.join(', ');

	return (
		<div
			className="sliders-tile-uses"
			title={t('dialogs.slidersAssets.usedInTitle', {
				count: passages.length,
				names
			})}
		>
			<span className="sliders-tile-uses-count">{passages.length}</span> {names}
		</div>
	);
};
