import { setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import { resolveTableColumnDisplayMode, type TableColumn } from '../../types/table';
import type { OperonSettings } from '../../types/settings';
import type { WorkflowStatusIdentityIndex } from '../../core/workflow-status-identity';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { resolveTableColumnCellAccent } from './table-column-color';
import { formatTableTaskTreePath, type TableTaskTreeProjection } from './table-task-tree';

export function renderTableTaskTreeCell(
	cell: HTMLElement,
	task: IndexedTask,
	column: TableColumn,
	projection: TableTaskTreeProjection,
	options: {
		settings: OperonSettings;
		workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
		onToggle: (taskId: string) => void;
	},
): void {
	cell.addClass('operon-table-task-tree-cell');
	cell.style.setProperty('--operon-table-task-tree-depth', String(projection.depth));
	const detailed = resolveTableColumnDisplayMode(column) === 'details';
	cell.classList.toggle('is-compact', !detailed);
	cell.classList.toggle('is-detailed', detailed);
	if (!detailed) cell.addClass('operon-table-icon-only-cell');
	const content = cell.createDiv('operon-table-task-tree-content');
	const toggleSlot = content.createSpan('operon-table-task-tree-toggle-slot');
	if (projection.hasChildren) {
		const button = toggleSlot.createEl('button', {
			cls: 'operon-table-icon-only-button operon-table-task-tree-toggle',
			attr: {
				type: 'button',
				'aria-expanded': String(projection.expanded),
			},
		});
		setAccessibleLabelWithoutTooltip(button, `${projection.expanded ? 'Collapse' : 'Expand'} subtasks for ${task.description}`);
		setIcon(button, projection.expanded ? 'chevron-down' : 'chevron-right');
		const accent = resolveTableColumnCellAccent(column, task.operonId, {
			task,
			settings: options.settings,
			workflowStatusIdentityIndex: options.workflowStatusIdentityIndex,
		});
		if (accent) {
			button.style.setProperty('--operon-table-icon-only-color', accent);
			button.style.setProperty('--operon-live-hover-border', accent);
			button.style.setProperty('--operon-task-chip-hover-accent', accent);
		}
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			options.onToggle(task.operonId);
		});
		button.addEventListener('dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		});
	}
	if (detailed && projection.path.length > 0) {
		content.createSpan({
			cls: 'operon-table-task-tree-number',
			text: formatTableTaskTreePath(projection.path),
		});
	}
}
