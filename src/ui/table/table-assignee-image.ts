import type { App } from 'obsidian';
import { bindAssigneeIconImage } from '../assignee-chip-image';
import { parseTableTaskListValue } from './table-value-adapter';

export function bindTableCompactAssigneeImage(control: HTMLElement, key: string, value: string, app: App, sourcePath: string, property: string): void {
	if (key !== 'assignees') return;
	const values = parseTableTaskListValue(key, value);
	if (values.length !== 1 || !values[0].trim().startsWith('[[')) return;
	const svg = control.querySelector('svg');
	if (!svg) return;
	const slot = control.createSpan('operon-table-assignee-image-slot');
	slot.setAttribute('aria-hidden', 'true');
	slot.appendChild(svg);
	bindAssigneeIconImage(slot, values[0], app, sourcePath, property);
}
