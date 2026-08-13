import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { getTaskSourceOpenModifierLabel } from '../task-source-open-modifier';
import { formatTableParentTaskTooltipContent } from './table-parent-task-tooltip-content';

export function bindTableParentTaskTooltip(
	target: HTMLElement,
	parentDescription: string,
	parentTaskId: string,
	taskColor: string | null,
): void {
	if (!parentTaskId.trim()) return;
	bindOperonHoverTooltip(target, {
		title: parentDescription.trim() || parentTaskId.trim(),
		content: formatTableParentTaskTooltipContent(parentTaskId, getTaskSourceOpenModifierLabel()),
		taskColor,
		preferredHorizontal: 'center',
	});
}
