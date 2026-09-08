import type { OperonSettings } from '../types/settings';
import type { CheckboxState } from '../types/keys';
import { getCheckboxToggleWorkflowStatus, getNextWorkflowStatus } from '../types/pipeline';
import { t } from './i18n';

type IconSettings = Pick<OperonSettings, 'pipelines'> & Partial<Pick<OperonSettings, 'taskIconClickAction'>>;

/** Shares the existing pipeline/checkbox rules without changing either operation. */
export function resolveTaskIconAction(settings: IconSettings, status: string | undefined, checkbox: CheckboxState): {
	checkbox: CheckboxState; status: string | undefined;
} | null {
	if (settings.taskIconClickAction === 'state') {
		const next = getCheckboxToggleWorkflowStatus(settings.pipelines, status, checkbox);
		if (next.checkbox === checkbox) return null;
		return { checkbox: next.checkbox, status: status && next.workflow ? next.workflow.value : status };
	}
	const next = getNextWorkflowStatus(settings.pipelines, status);
	return next ? { checkbox: next.checkbox, status: next.value } : null;
}

export function getTaskIconActionLabel(settings: Partial<Pick<OperonSettings, 'taskIconClickAction'>>, checkbox: CheckboxState): string {
	if (settings.taskIconClickAction !== 'state') return t('tooltips', 'cycleTaskStatus');
	return t('settings', checkbox === 'open' ? 'taskIconComplete' : checkbox === 'done' ? 'taskIconCancel' : 'taskIconReopen');
}
