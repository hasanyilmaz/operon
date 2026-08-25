import { setIcon } from 'obsidian';
import { t } from '../../core/i18n';
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
		onToggle: (expansionKey: string) => void;
	},
): void {
	cell.addClass('operon-table-task-tree-cell');
	cell.style.setProperty('--operon-table-task-tree-depth', String(projection.depth));
	const detailed = resolveTableColumnDisplayMode(column) === 'details';
	cell.classList.toggle('is-compact', !detailed);
	cell.classList.toggle('is-detailed', detailed);
	if (!detailed) cell.addClass('operon-table-icon-only-cell');
	const content = cell.createDiv('operon-table-task-tree-content');
	content.style.setProperty('--operon-table-task-tree-number-chars', String(projection.tokenWidthChars));
	const isProjectedSubtask = projection.context && projection.depth > 0;
	const hasNumber = detailed && projection.path.length > 0;
	const hasVisual = projection.hasChildren || isProjectedSubtask || projection.baseLeaf || hasNumber;
	content.classList.toggle('has-value', hasVisual);
	const accent = resolveTableColumnCellAccent(column, task.operonId, {
		task,
		settings: options.settings,
		workflowStatusIdentityIndex: options.workflowStatusIdentityIndex,
	});
	if (accent) {
		content.style.setProperty('--operon-table-icon-only-color', accent);
		content.style.setProperty('--operon-live-hover-border', accent);
		content.style.setProperty('--operon-task-chip-hover-accent', accent);
	}
	const toggleSlot = content.createSpan('operon-table-task-tree-toggle-slot');
	if (projection.hasChildren) {
		const button = toggleSlot.createEl('button', {
			cls: 'operon-table-icon-only-button operon-table-task-tree-toggle',
			attr: {
				type: 'button',
				'aria-expanded': String(projection.expanded),
			},
		});
		setAccessibleLabelWithoutTooltip(button, t(
			'table',
			projection.expanded ? 'taskTreeCollapseAria' : 'taskTreeExpandAria',
			{ task: task.description },
		));
		setIcon(button, projection.expanded ? 'circle-chevron-down' : 'circle-chevron-right');
		button.addEventListener('click', event => {
			event.preventDefault();
			event.stopPropagation();
			options.onToggle(projection.expansionKey);
		});
		button.addEventListener('dblclick', event => {
			event.preventDefault();
			event.stopPropagation();
		});
	} else if (isProjectedSubtask) {
		const branchIcon = toggleSlot.createSpan('operon-table-icon-only-button operon-table-task-tree-branch-icon');
		branchIcon.setAttribute('aria-hidden', 'true');
		setIcon(branchIcon, 'git-commit-vertical');
	} else if (projection.baseLeaf) {
		const baseLeafIcon = toggleSlot.createSpan('operon-table-icon-only-button operon-table-task-tree-base-leaf-icon');
		baseLeafIcon.setAttribute('aria-hidden', 'true');
		setIcon(baseLeafIcon, 'dot');
	}
	if (hasNumber) {
		content.createSpan({
			cls: 'operon-table-task-tree-number',
			text: formatTableTaskTreePath(projection.path),
		});
	}
}
