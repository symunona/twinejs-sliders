import {IconPlus} from '@tabler/icons';
import * as React from 'react';
import {useTranslation} from 'react-i18next';
import {GhostPassage} from '../../util/broken-link-ghosts';
import './ghost-passage-card.css';

export interface GhostPassageCardProps {
	ghost: GhostPassage;
	onCreate: (ghost: GhostPassage) => void;
}

/**
 * A passage that is linked to but does not exist yet, drawn where it would land.
 *
 * Not a `PassageCard`: it has no id to select, drag, edit or lock, and every one of
 * those affordances would have to be disabled one at a time. It is a button, and the
 * only thing it does is become a real passage.
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

		return (
			<button
				className="ghost-passage-card"
				data-testid={`ghost-passage-${ghost.name}`}
				onClick={() => onCreate(ghost)}
				style={style}
				title={t('components.ghostPassageCard.create', {name: ghost.name})}
				type="button"
			>
				<span className="ghost-passage-name">{ghost.name}</span>
				<span className="ghost-passage-hint">
					<IconPlus />
					{t('components.ghostPassageCard.label')}
				</span>
			</button>
		);
	}
);

GhostPassageCard.displayName = 'GhostPassageCard';
