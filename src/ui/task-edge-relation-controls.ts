import { Component, Notice, setIcon } from 'obsidian';
import type { IndexedTaskSnapshot } from '../indexer/indexer';
import { t } from '../core/i18n';
import { createOwnerElement } from '../core/dom-compat';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { INLINE_TASK_COMPACT_FALLBACK_ICONS, TASK_CREATOR_FALLBACK_FIELD_ICONS, type KeyMapping } from '../types/settings';
import { edgeRelationship, edgeRelationSnapshot, type EdgeRelationIssue, type EdgeRelationKind } from '../systems/canvas-edge-relations';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { bindOperonHoverTooltip, cleanupOperonHoverTooltips } from './operon-hover-tooltip';

export interface TaskEdgeRelationOperations {
 relationIssue?: (from: string, to: string, kind: EdgeRelationKind) => EdgeRelationIssue | null;
 changeRelation?: (from: string, to: string, kind: EdgeRelationKind, snapshot: string, allowed: () => boolean) => Promise<boolean>;
}
export interface TaskEdgeRelationControl {
 id: string; icon: string; title: string; lines: string[]; snapshot: string;
 active: boolean; unavailable: boolean; existingParent: boolean;
 run: () => void;
}
interface RelationControlContext extends TaskEdgeRelationOperations {
 a: IndexedTaskSnapshot; b: IndexedTaskSnapshot; keyMappings: KeyMapping[];
 surface: 'Canvas' | 'Excalidraw'; readOnly: boolean; locked?: boolean;
 parentName(id: string): string;
 isBusy(): boolean;
 setBusy(busy: boolean): void;
 allowed(): boolean;
}
export const taskEdgeRelationUnavailable = 'Relation editing is currently unavailable.';
export function taskEdgeRelationIcon(key: EdgeRelationKind | 'blockedBy' | 'subtasks', mappings: KeyMapping[]): string {
 return getConfiguredKeyMappingIcon(key, mappings)
  || (key === 'parentTask' || key === 'subtasks' ? TASK_CREATOR_FALLBACK_FIELD_ICONS[key] : INLINE_TASK_COMPACT_FALLBACK_ICONS[key]);
}

/** Canvas and Excalidraw share the exact operation order, preflight, labels and click lifecycle. */
export function taskEdgeRelationControls(context: RelationControlContext): TaskEdgeRelationControl[] {
 const { a, b, surface } = context;
 return ([['parentTask', false], ['parentTask', true], ['blocking', false], ['blocking', true]] as const).map(([kind, reverse]) => {
  const source = reverse ? b : a, target = reverse ? a : b;
  const snapshot = edgeRelationSnapshot(source, target);
  const active = edgeRelationship(source, target, kind), reversed = edgeRelationship(target, source, kind);
  const parent = kind === 'parentTask' && !active ? target.fieldValues.parentTask?.trim() : '';
  const issue = context.relationIssue?.(source.operonId, target.operonId, kind) ?? (reversed ? 'reverse' : parent ? 'parent' : null);
  const busy = context.isBusy();
  const unavailable = busy || context.readOnly || !!context.locked || !context.changeRelation || !!issue;
  const title = busy ? 'Updating Relation…' : context.readOnly ? `${surface} Is Read-only`
   : issue === 'parent-missing' || issue === 'missing' ? 'Cannot Verify Relation'
   : unavailable ? active ? 'Cannot Update Relation' : 'Cannot Add Relation' : active ? 'Current Relation' : 'Add Relation';
  const roles = kind === 'parentTask' ? ['Parent', 'Child'] : ['Blocked by', 'Blocking'];
  const lines = [`${roles[0]}: ${source.description || source.operonId}`, `${roles[1]}: ${target.description || target.operonId}`];
  const messages = {
   reverse: 'A relation already exists in the opposite direction. Remove it before reversing the relationship.',
   'parent-cycle': 'This would create a parent–child loop. Remove the conflicting parent relation first.',
   'dependency-cycle': 'This would create a dependency loop. Remove a conflicting blocking relation first.',
   'parent-missing': 'A task in the parent chain could not be found. Restore it or correct the parent reference.',
   missing: `A source task could not be found. Restore it or reconnect the ${surface} card.`,
   duplicate: 'Multiple tasks share the same Operon ID. Resolve the duplicate ID before changing this relation.',
   parent: '',
  };
  if (busy) lines.push('Wait for the current change to finish.');
  else if (context.readOnly) lines.push(`Switch this ${surface} to editing mode to change relations.`);
  else if (context.locked) lines.push('Unlock the arrow and connected cards to change relations.');
  else if (!context.changeRelation) lines.push(taskEdgeRelationUnavailable);
  else if (issue && issue !== 'parent') lines.push(messages[issue]);
  else if (parent) lines.push(`This child already has a parent: ${context.parentName(parent)}.`, t('settings', 'edgeRelationsParent'));
  return {
   id: `operon-edge-${kind}-${reverse ? 'reverse' : 'forward'}`,
   icon: taskEdgeRelationIcon(kind === 'parentTask' && reverse ? 'subtasks' : kind === 'blocking' && reverse ? 'blockedBy' : kind, context.keyMappings),
   title, lines, snapshot, active, unavailable, existingParent: !!parent,
   run: () => {
    if (unavailable || context.isBusy()) return;
    const allowed = () => context.allowed();
    if (!allowed()) { new Notice(t('settings', 'edgeRelationsFailed')); return; }
    context.setBusy(true);
    void (async () => {
     try { if (!allowed() || !await context.changeRelation!(source.operonId, target.operonId, kind, snapshot, allowed)) new Notice(t('settings', 'edgeRelationsFailed')); }
     catch { new Notice(t('settings', 'edgeRelationsFailed')); }
     finally { context.setBusy(false); }
    })();
   },
  };
 });
}
export function taskEdgeRelationControlSignature(controls: readonly TaskEdgeRelationControl[]): string {
 return JSON.stringify(controls.map(control => [control.id, control.snapshot, control.icon, control.title, control.lines, control.active, control.unavailable]));
}

/** Decorate only an owned button; native Excalidraw already dispatches its action. */
export function bindTaskEdgeRelationControl(button: HTMLButtonElement, control: TaskEdgeRelationControl, life: Component,
 options: { nativeClick?: boolean; bindTheme?: (tooltip: HTMLElement) => () => void } = {}): void {
 button.setAttribute('data-operon-edge-relation', control.id);
 button.setAttribute('aria-pressed', String(control.active)); button.setAttribute('aria-disabled', String(control.unavailable));
 button.classList.toggle('is-active', control.active); button.classList.toggle('is-unavailable', control.existingParent);
 setAccessibleLabelWithoutTooltip(button, `${control.title}. ${control.lines.join('. ')}`);
 bindOperonHoverTooltip(button, {
  title: control.title, taskColor: null, bindTheme: options.bindTheme,
  contentElFactory: () => {
   const content = createOwnerElement(button, 'div');
   for (const line of control.lines) content.createDiv().textContent = line;
   return content;
  },
 });
 life.register(() => cleanupOperonHoverTooltips(button));
 life.registerDomEvent(button, 'pointerdown', event => event.stopPropagation());
 life.registerDomEvent(button, 'keydown', event => { if (event.key === 'Enter' || event.key === ' ') event.stopPropagation(); });
 if (!options.nativeClick) life.registerDomEvent(button, 'click', event => { event.preventDefault(); event.stopPropagation(); control.run(); });
}
export function mountTaskEdgeRelationControl(host: HTMLElement, control: TaskEdgeRelationControl, life: Component): void {
 const button = host.createEl('button', { cls: 'clickable-icon', attr: { type: 'button' } });
 setIcon(button, control.icon); bindTaskEdgeRelationControl(button, control, life);
}
