import * as React from 'react';

export interface TestIdProps {
	children: React.ReactNode;
	/** Which descendant to stamp. Defaults to the first button. */
	selector?: string;
	testId: string;
}

/**
 * Stamps a `data-testid` onto a child of a shared control that doesn't take arbitrary DOM
 * props. Cheaper than widening `IconButton` and friends for the Playwright suite.
 */
export const TestId: React.FC<TestIdProps> = ({children, selector, testId}) => {
	const ref = React.useRef<HTMLSpanElement>(null);

	React.useEffect(() => {
		ref.current
			?.querySelector(selector ?? 'button')
			?.setAttribute('data-testid', testId);
	});

	return <span ref={ref}>{children}</span>;
};

/** True if a rejected server action means "that ID is already on the server". */
export function isConflictError(error: unknown): boolean {
	if (!error || typeof error !== 'object') {
		return false;
	}

	const candidate = error as {
		code?: string;
		conflict?: boolean;
		status?: number;
	};

	return (
		candidate.conflict === true ||
		candidate.code === 'conflict' ||
		candidate.status === 409 ||
		candidate.status === 412
	);
}
