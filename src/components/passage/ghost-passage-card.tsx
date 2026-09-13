import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {CardContent} from '../container/card';
import {SelectableCard} from '../container/card/selectable-card';
import {GhostPassage} from '../../util/broken-link-ghosts';
import './ghost-passage-card.css';

export interface GhostPassageCardProps {
	ghost: GhostPassage;
	onCreate: (ghost: GhostPassage) => void;
}

/**
 * A passage that is linked to but does not exist yet, drawn where it would land.
 *
 * Deliberately the same card as an empty passage — `.passage-card.empty` is already the
 * dashed, translucent look this needs, and the map should not teach two different shapes
 * for "a passage". It is not a `PassageCard` only because it has no passage: nothing to
 * select, drag, rename, lock or badge, and every one of those would have to be switched
 * off one at a time. Click or Enter makes it real, after which the real card takes over.
 */
export const GhostPassageCard: React.FC<GhostPassageCardProps> = React.memo(
	props => {
		const {ghost, onCreate} = props;
		const {t} = useTranslation();
		const style = React.useMemo(
			() => ({
				height: ghost.height,
				left: ghost.left,
				top: ghost.top,
				width: ghost.width
			}),
			[ghost.height, ghost.left, ghost.top, ghost.width]
		);
		const handleCreate = React.useCallback(() => onCreate(ghost), [
			ghost,
			onCreate
		]);

		return (
			<div
				className="passage-card empty ghost-passage-card"
				data-testid={`ghost-passage-${ghost.name}`}
				style={style}
			>
				<SelectableCard
					label={ghost.name}
					onDoubleClick={handleCreate}
					onSelect={handleCreate}
				>
					<h2>{ghost.name}</h2>
					<CardContent>
						<span className="placeholder">
							{t('components.ghostPassageCard.placeholder')}
						</span>
					</CardContent>
				</SelectableCard>
			</div>
		);
	}
);

GhostPassageCard.displayName = 'GhostPassageCard';
