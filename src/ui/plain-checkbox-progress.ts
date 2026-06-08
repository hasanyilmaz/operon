import { t } from '../core/i18n';
import { PlainCheckboxProgress } from '../types/fields';

export type PlainCheckboxProgressIndicator =
	| { kind: 'none' }
	| { kind: 'count'; completed: number; total: number; text: string; tooltipContent: string; allCompleted: boolean };

export function computePlainCheckboxProgressIndicator(
	progress: PlainCheckboxProgress | null | undefined,
): PlainCheckboxProgressIndicator {
	if (!progress || progress.total <= 0) return { kind: 'none' };
	const total = progress.total;
	const completed = Math.min(Math.max(progress.completed, 0), total);
	return {
		kind: 'count',
		completed,
		total,
		text: `${completed}/${total}`,
		tooltipContent: buildPlainCheckboxProgressTooltipContent(completed, total),
		allCompleted: completed === total,
	};
}

function buildPlainCheckboxProgressTooltipContent(completed: number, total: number): string {
	const percent = Math.round((completed / total) * 100);
	if (percent === 0) return t('tooltips', 'plainCheckboxesNotStarted');
	if (completed === total) return t('tooltips', 'plainCheckboxesComplete');
	return t('tooltips', 'plainCheckboxesPercentComplete', { percent: String(percent) });
}
