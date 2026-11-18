import type { TaskEditorSection, TaskEditorSectionId } from '../types/task-editor-sections';
import { taskEditorSectionDefaultLabel } from './task-editor-section-label';

export function editorSectionLabel(sections: readonly TaskEditorSection[] | undefined, id: TaskEditorSectionId): string {
 return sections?.find(section => section.id === id)?.name.trim() || taskEditorSectionDefaultLabel(id);
}

export function createEditorTitle(container: HTMLElement, title: string): void {
 const row = container.createDiv('operon-task-editor-title-row');
 row.createDiv('operon-task-editor-title-side is-left');
 row.createEl('h3', { text: title, cls: 'operon-task-editor-title' });
 row.createDiv('operon-task-editor-title-side is-right');
}

export function createEditorSectionHosts(container: HTMLElement, sections: readonly TaskEditorSection[]) {
 const root = container.createDiv('operon-task-editor-section-layout');
 const hosts = new Map<TaskEditorSectionId, HTMLElement>();
 for (const section of sections) {
  if (section.removed) continue;
  const target = root.createDiv('operon-task-editor-section-host');
  target.dataset.editorSection = section.id;
  target.toggleClass('is-section-disabled', section.enabled === false);
  hosts.set(section.id, target);
 }
 return { root, host: (id: TaskEditorSectionId) => hosts.get(id)! };
}

export function createEditorPropertyGroup(root: HTMLElement, key: TaskEditorSectionId, title: string) {
 const group = root.createDiv('operon-editor-group operon-task-editor-workflow-surface operon-editor-desktop-property-group');
 group.dataset.propertyGroup = key;
 const header = group.createDiv('operon-editor-desktop-group-header');
 header.createDiv({ text: title, cls: 'operon-editor-core-title-badge operon-editor-desktop-group-title' });
 const actions = header.createDiv('operon-task-editor-workflow-actions');
 return { group, actions };
}

export function createCompactEditorWorkflow(container: HTMLElement, title: string) {
 const section = container.createDiv('operon-editor-group operon-task-editor-workflow-surface');
 const header = section.createDiv('operon-task-editor-workflow-header');
 header.createDiv({ text: title, cls: 'operon-editor-core-title-badge operon-task-editor-workflow-title' });
 return {
  actions: section.createDiv('operon-task-editor-workflow-actions'),
  rows: section.createDiv('operon-task-editor-workflow-values'),
 };
}

export function createEditorTextSection(host: HTMLElement, id: 'description' | 'notes', title: string) {
 const section = host.createDiv('operon-editor-text-fields');
 const group = section.createDiv('operon-editor-text-field-group is-' + id);
 const header = group.createDiv('operon-editor-desktop-group-header');
 header.createEl('h6', { cls: 'operon-editor-core-title-badge operon-editor-text-field-title operon-editor-desktop-group-title', text: title });
 return { group, header };
}
