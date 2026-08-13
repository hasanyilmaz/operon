import { t } from '../../core/i18n';

export function formatTableParentTaskTooltipContent(parentTaskId: string, modifier: string): string {
	return `${parentTaskId.trim()}\n${t('table', 'parentTaskSourceTabHint', {
		modifier,
	})}`;
}
