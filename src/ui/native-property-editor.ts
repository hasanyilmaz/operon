import { isWideEditorSourceViewport } from './editor-source-layout';
import { Notice, setIcon, type App, type TFile } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { PropertyEditorDraft } from '../core/property-editor-draft';
import { PropertyEditorAdapter } from '../core/property-editor-adapter';
import { inferVaultPropertyEditorTypes, type PropertyEditorField } from '../core/property-editor-fields';
import type { PropertyEditorChange, PropertyEditorDocument } from '../core/property-editor-document';
import { isEmptyFilePropertyValue, readRawYamlPropertyExpectation, type RawYamlPropertyValue } from '../core/raw-yaml-property';
import { getNativePropertyIndex } from '../indexer/native-property-index';
import type { IndexedTask, ParsedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { DEFAULT_INLINE_REPEAT_COMPLETION_MODE } from '../storage/repeat-series-store';
import { EditorPropertyFields, DESKTOP_CORE_FIELDS, type EditorFileProperty } from './editor-property-fields';
import { getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import { getManagedTaskDataFieldPicker } from './task-data-field-picker';
import type { CompactMarkdownEditorSurface } from './compact-markdown-editor-surface';
import type { TaskEditorFileBodyContext } from './task-editor-content';
import { hasFloatingPanelForRoot, requestFloatingPanelCloseForRoot, resolveSurfaceFloatingHostOptions } from './field-pickers/common';
import { showSearchableFieldPicker } from './field-pickers/searchable-field-picker';
import { cleanupOperonHoverTooltips } from './operon-hover-tooltip';
import { TASK_EDITOR_AUTOSAVE_DELAY_MS } from './task-editor-source-sync';

export type PropertyEditorSaveResult =
 | { status: 'saved'; properties: PropertyEditorDocument }
 | { status: 'conflict' | 'unsupported' | 'failed' };

export interface NativePropertyEditorOptions {
 app: App;
 file: TFile;
 settings(): OperonSettings;
 tasks(): IndexedTask[];
 save(changes: readonly PropertyEditorChange[], current: () => boolean): Promise<PropertyEditorSaveResult>;
}

/** Flat layout host; all field presentation and interaction belongs to EditorPropertyFields. */
export class NativePropertyEditor extends EditorPropertyFields {
 readonly root: HTMLElement;
 private readonly rows: HTMLElement;
 private readonly empty: HTMLElement;
 private readonly add: HTMLButtonElement;
 private readonly message: HTMLElement;
 private readonly draft: PropertyEditorDraft;
 private adapter: PropertyEditorAdapter;
 private inferredTypes: Record<string, string> | null = null;
 private timer: number | null = null;
 private nextSaveAt = 0;
 private saving: Promise<boolean> | null = null;
 private readonly submitted = new Set<string>();
 protected disposed = false;
 private readonly win: Window;
 private rendering = false;
 private pendingRefresh = false;
 private readonly interactionObserver: MutationObserver;
 private readonly settleRefresh = () => {
  if (!this.pendingRefresh || this.disposed || this.hasActiveInteraction()) return;
  this.pendingRefresh = false; this.hydrate(); this.render();
 };
 private hasActiveInteraction(): boolean {
  return hasFloatingPanelForRoot(this.root) || !!this.workflowActionPickerClose || !!this.closeFilePropertyPicker || !!this.closeAddPicker
   || !!this.root.querySelector('.is-picker-open')
   || !!this.mainPanelEl.querySelector('input:focus, textarea:focus, [contenteditable="true"]:focus-within');
 }
 private readonly sourceFocusout = () => queueMicrotask(this.settleRefresh);
 private readonly clearAddingOnRowClick = (event: Event): void => {
  if ((event.target as HTMLElement).closest('[data-property-name]')) this.adding = null;
 };
 private readonly surfaces = new Map<string, { row: HTMLElement; label: HTMLButtonElement; value: HTMLElement; shared: boolean; signature: string }>();
 private readonly schedulingRefreshers = new Set<() => void>();
 private adding: string | null = null;
 private closeAddPicker: (() => void) | null = null;
 protected rootEl: HTMLElement;
 protected shellEl: HTMLElement;
 protected mainPanelEl: HTMLElement;
 protected fieldValues: Record<string, string> = {};
 protected tags: string[] = [];
 protected persistedFieldValues: Record<string, string> = {};
 protected existingTask: ParsedTask | null = null;
 protected checkbox: 'open' | 'done' | 'cancelled' = 'open';
 protected readonly taskOperonId = null;
 protected readonly getRepeatSkipDates = null;
 protected readonly onUpdateRepeatSkips = null;
 protected readonly onApplyEstimateReallocation = null;
 protected refreshEstimateReallocationControl = null;
 protected readonly readSource = undefined;
 protected readonly isPhone = false;
 protected readonly usesMobileLayout = false;
 protected readonly usesTouchDesktopLayout = false;
 protected inlineCompletionMode = DEFAULT_INLINE_REPEAT_COMPLETION_MODE;
 protected noteCompactEditor: CompactMarkdownEditorSurface | null = null;
 protected noteCompactHostEl: HTMLElement | null = null;
 protected propertyInteractionEpoch = 0;
 protected workflowActionButtons = new Map<string, HTMLButtonElement>();
 protected workflowActionPickerClose: (() => void) | null = null;
 protected workflowRowsEl: HTMLElement;
 protected desktopPropertyRows = new Map<string, { row: HTMLElement; value: HTMLElement; core: boolean; signature: string }>();
 protected filePropertyUnavailable = false;
 protected fileProperties = new Map<string, EditorFileProperty>();
 protected filePropertyRows = new Map<string, { row: HTMLElement; value: HTMLElement; action: HTMLButtonElement }>();
 protected additionalPropertyAdd: HTMLButtonElement;
 protected filePropertyPickerName: string | null = null;
 protected filePropertyPickerValue: string | null = null;
 protected closeFilePropertyPicker: (() => void) | null = null;
 protected readonly sourceCompositionEnd = () => this.notifyPropertyContentChanged();
 protected get app(): App { return this.options.app; }
 protected get settings(): OperonSettings { return this.options.settings(); }
 protected get indexer(): { getAllTasks(): IndexedTask[] } { return { getAllTasks: () => this.options.tasks() }; }
 protected get fileBodyContext(): TaskEditorFileBodyContext {
  return { filePath: this.options.file.path, format: 'yaml', initialContent: '', targetLine: null, cursorOffset: null, lineNumberOffset: 0 };
 }

 constructor(host: HTMLElement, document: PropertyEditorDocument, private readonly options: NativePropertyEditorOptions) {
  super();
  this.draft = new PropertyEditorDraft(document);
  this.adapter = this.makeAdapter();
  this.win = getOwnerWindow(host);
  const title = t('taskEditor', 'propertyEditorTitle');
  this.root = this.rootEl = host;
  host.addClass('operon-task-editor', 'operon-property-editor');
  host.setAttribute('role', 'region');
  host.tabIndex = -1;
  setAccessibleLabelWithoutTooltip(this.root, title);
  this.shellEl = this.root.createDiv('operon-task-editor-shell');
  this.mainPanelEl = this.shellEl.createDiv('operon-task-editor-main-panel');
  const main = this.mainPanelEl;
  const titleRow = main.createDiv('operon-task-editor-title-row');
  titleRow.createDiv('operon-task-editor-title-side is-left');
  titleRow.createEl('h3', { cls: 'operon-task-editor-title', text: title });
  titleRow.createDiv('operon-task-editor-title-side is-right');
  this.message = main.createDiv({ cls: 'operon-property-editor-message', attr: { role: 'status' } });
  this.message.hidden = true;
  this.empty = main.createDiv({ cls: 'operon-property-editor-empty', text: t('taskEditor', 'propertyEditorEmpty') });
  this.rows = this.workflowRowsEl = main.createDiv('operon-editor-desktop-properties operon-task-editor-workflow-values').createDiv('operon-editor-group operon-task-editor-workflow-surface operon-editor-desktop-property-group');
  this.add = this.additionalPropertyAdd = main.createEl('button', { cls: 'operon-property-editor-add operon-editor-picker-button', attr: { type: 'button' } });
  setIcon(this.add.createSpan(), 'plus');
  this.add.createSpan({ text: t('taskEditor', 'propertyEditorAdd') });
  this.add.addEventListener('click', () => this.openAddPicker());
  this.onPropertyContentChanged = () => this.root.dispatchEvent(new CustomEvent('operon-property-content-changed', { bubbles: true }));
  this.interactionObserver = new (this.win as Window & { MutationObserver: typeof MutationObserver }).MutationObserver(() => this.settleRefresh());
  this.interactionObserver.observe(this.root, { attributes: true, attributeFilter: ['class'], subtree: true });
  this.root.addEventListener('focusout', this.sourceFocusout);
  this.root.addEventListener('click', this.clearAddingOnRowClick, true);
  this.hydrate();
  this.render();
 }

 updateSourceLayout(): void {
  const modal = this.root.closest('.operon-task-editor-modal');
  this.shellEl.addClass('has-source-context');
  modal?.classList.toggle('operon-task-editor-modal-source-wide', isWideEditorSourceViewport(this.root));
  modal?.classList.add('operon-task-editor-modal-has-source-context');
 }

 get isEdited(): boolean { return this.draft.edited; }
 private makeAdapter(): PropertyEditorAdapter { return new PropertyEditorAdapter(this.draft.properties, this.settings.keyMappings, getNativePropertyIndex(this.app).getTypes(), this.inferredTypes ??= inferVaultPropertyEditorTypes(this.app)); }
 private hydrate(): void {
  this.adapter = this.makeAdapter();
  this.fieldValues = { ...this.adapter.values };
  this.tags = [...this.adapter.tags];
  this.persistedFieldValues = { ...this.adapter.values };
 }
 refresh(document: PropertyEditorDocument): void {
  this.draft.refresh(document);
  this.pendingRefresh = true;
  this.settleRefresh();
 }
 private field(name: string): PropertyEditorField { return this.adapter.fields.get(name) ?? this.adapter.resolve(name); }
 private usesSharedControl(field: PropertyEditorField): boolean {
  if (!field.mapping || field.reason) return false;
  const key = field.mapping.canonicalKey;
  // File lists and custom YAML fields use typed controls, independent of inline encoding.
  if (key === 'related' || field.mapping.isSystem === false) return false;
  return DESKTOP_CORE_FIELDS.has(key) || ['contexts', 'tags', 'links', 'assignees', 'related', 'location', 'reminderDatetimes', 'reminderRules', 'note'].includes(key)
   || !!getManagedTaskDataFieldPicker(key, this.settings.keyMappings)
   || !!getCustomFieldMapping(this.settings.keyMappings, key);
 }
 private render(): void {
  if (this.disposed || this.rendering) return;
  this.rendering = true;
  const scroll = this.mainPanelEl.scrollTop;
  const valuesBeforeRender = { ...this.fieldValues }, tagsBeforeRender = [...this.tags];
  try {
   const document = this.draft.properties;
   this.applyThemeColor();
   this.rows.hidden = !document.order.length;
   this.empty.hidden = !!document.order.length;
   for (const [name, surface] of this.surfaces) {
    if (document.order.includes(name)) continue;
    cleanupOperonHoverTooltips(surface.row); surface.row.remove(); this.surfaces.delete(name);
    const key = this.field(name).mapping?.canonicalKey;
    if (key) this.desktopPropertyRows.delete(key);
    this.filePropertyRows.delete(name); this.fileProperties.delete(name);
   }
   for (const name of document.order) {
    const field = this.field(name), key = field.mapping?.canonicalKey ?? name;
    const shared = this.usesSharedControl(field);
    let surface = this.surfaces.get(name);
    // Mapping/type changes may switch a row to the shared read-only representation.
    if (surface && surface.shared !== shared) {
     requestFloatingPanelCloseForRoot(surface.row, 'escape');
     cleanupOperonHoverTooltips(surface.row); surface.row.remove(); this.surfaces.delete(name);
     this.desktopPropertyRows.delete(key); this.filePropertyRows.delete(name); surface = undefined;
    }
    if (!surface) {
     const native = this.nativePropertyField(name, field.type);
     const built = this.createPropertyRow(this.rows, shared ? key : native.key, name, shared ? this.resolveWorkflowPickerIcon(key) : native.icon, field.type === 'list');
     surface = { ...built, shared, signature: '' }; surface.row.dataset.propertyName = name;
     this.surfaces.set(name, surface);
     if (shared) {
      const core = DESKTOP_CORE_FIELDS.has(key);
      this.desktopPropertyRows.set(key, { row: surface.row, value: surface.value, core, signature: '' });
      this.workflowActionButtons.set(key, surface.label);
      this.bindDesktopPropertyInteraction(surface.row, surface.label, surface.value,
       () => key === 'note' ? this.noteCompactEditor?.focusEnd() : this.openWorkflowPickerFromAction(key, surface!.label),
       () => key === 'note' ? this.noteCompactEditor?.focusEnd() : this.openDesktopPropertyValue(key, surface!.value, surface!.label),
       () => key !== 'datetimeEnd' || !!this.fieldValues.datetimeStart);
      if (core) {
       surface.row.addClass('operon-editor-desktop-core-property');
       this.renderDesktopCoreProperty(surface.value, key); this.addDesktopCoreClear(surface.value, key);
       for (const input of Array.from(surface.value.querySelectorAll('input'))) setAccessibleLabelWithoutTooltip(input, name);
      }
     } else {
      // The action lives in the header in Task Editor; a flat list uses its existing row label as the anchor.
      const action = this.add.ownerDocument.win.createEl('button');
      this.filePropertyRows.set(name, { ...built, action });
      action.hidden = true;
      this.bindDesktopPropertyInteraction(surface.row, surface.label, surface.value,
       () => this.openFilePropertyPicker(name, undefined, 'picker', surface!.label),
       () => this.openFilePropertyPicker(name, undefined, 'popover', surface!.value),
       () => this.canEditFileProperty(this.fileProperties.get(name)!));
     }
    }
    surface.row.toggleClass('is-list-property', field.type === 'list');
    const signature = JSON.stringify([field.type, document.frontmatter[name], key === 'tags' ? this.tags : this.fieldValues[key], key.startsWith('reminder') ? this.fieldValues : null, field.reason]);
    if (shared) {
     const populated = this.hasWorkflowPickerValue(key);
     this.refreshDesktopPropertyIcon(key, surface.row, populated);
     surface.label.disabled = key === 'datetimeEnd' && !this.fieldValues.datetimeStart;
     const clear = surface.value.querySelector<HTMLButtonElement>('.operon-editor-value-clear');
     if (clear) { clear.hidden = !populated; clear.parentElement?.toggleClass('has-visible-clear', populated); }
     if (!DESKTOP_CORE_FIELDS.has(key) && surface.signature !== signature && !surface.value.querySelector('.is-picker-open') && !surface.value.contains(this.root.ownerDocument.activeElement)) {
      cleanupOperonHoverTooltips(surface.value); surface.value.empty();
      const managed = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
      const custom = getCustomFieldMapping(this.settings.keyMappings, key);
      if (key === 'note') this.renderNote(surface.value, false);
      else if (managed) this.renderManagedTaskDataWorkflowPicker(surface.value, managed);
      else if (custom && isProjectedCustomFieldType(custom)) this.renderCustomWorkflowPicker(surface.value, custom);
      else this.renderWorkflowPicker(surface.value, key);
      surface.signature = signature;
     }
    } else {
     this.fileProperties.set(name, { field: this.nativePropertyField(name, field.type), value: document.frontmatter[name], baseline: readRawYamlPropertyExpectation(document.frontmatter, name), readonly: !!field.reason, readOnlyReason: field.reason });
     if (surface.signature !== signature && this.filePropertyPickerName !== name) {
      this.refreshFilePropertyValue(name); surface.signature = signature;
      if (field.taskOnly) for (const target of [surface.label, surface.value]) {
       cleanupOperonHoverTooltips(target);
       const content = t('taskEditor', 'propertyEditorRequiresTask', { name });
       target.setAttribute('aria-label', content);
       this.bindEditorHoverTooltip(target, { content, taskColor: () => this.getThemeColor() });
      }
     }
    }
    // Reorder only when necessary: moving focused DOM nodes would drop editor/picker focus.
    const position = document.order.indexOf(name);
    if (this.rows.children[position] !== surface.row) this.rows.insertBefore(surface.row, this.rows.children[position] ?? null);
   }
   this.refreshSchedulingDraftControls();
  } finally { this.fieldValues = valuesBeforeRender; this.tags = tagsBeforeRender; this.rendering = false; this.mainPanelEl.scrollTop = scroll; }
  this.notifyPropertyContentChanged();
 }

 markEdited(): void {
  if (this.rendering || this.disposed) return;
  // Recurrence definition dates are ordinary properties; only the task's series identity is excluded.
  delete this.fieldValues.repeatSeriesId;
  const changes = this.adapter.changes(this.fieldValues, this.tags, this.adding ?? undefined);
  if (!changes) {
   this.closePicker(false); this.add.focus({ preventScroll: true });
   for (const surface of this.surfaces.values()) surface.signature = '';
   this.hydrate(); this.render();
   new Notice(t('taskEditor', 'filePropertyTypeConflict', { name: this.adding ?? t('taskEditor', 'propertyEditorTitle') }));
   return;
  }
  let changed = false;
  for (const { name, value } of changes) changed = this.draft.set(name, value, this.submitted.has(name), readRawYamlPropertyExpectation(this.adapter.document.frontmatter, name) ?? undefined) || changed;
  this.hydrate();
  if (changed) this.scheduleEdited();
  this.render();
 }
 private scheduleEdited(): void { this.nextSaveAt = Date.now() + TASK_EDITOR_AUTOSAVE_DELAY_MS; this.scheduleSave(); }
 protected setFilePropertyValue(name: string, value: RawYamlPropertyValue): void {
  const present = this.draft.properties.order.includes(name);
  if (!present && isEmptyFilePropertyValue(value)) return;
  if (this.field(name).reason) return;
  if (!this.draft.set(name, value, this.submitted.has(name), readRawYamlPropertyExpectation(this.adapter.document.frontmatter, name) ?? undefined)) return;
  this.hydrate(); this.scheduleEdited(); this.render();
 }

 private openAddPicker(): void {
  this.closePicker();
  this.inferredTypes = inferVaultPropertyEditorTypes(this.app); this.hydrate(); this.render();
  const document = this.draft.properties;
  const names = new Set(Object.keys(getNativePropertyIndex(this.app).getTypes()));
  for (const name of Object.keys(this.inferredTypes)) names.add(name);
  const fields = new Map<string, { field: string; label: string; icon: string }>();
  for (const name of names) {
   if (document.order.includes(name)) continue;
   const field = this.field(name);
   if (field.reason) continue;
   const key = field.mapping?.canonicalKey;
   const identity = (key ?? name).toLowerCase();
   if (!fields.has(identity)) fields.set(identity, { field: name, label: name, icon: key ? this.resolveWorkflowPickerIcon(key) : this.nativePropertyField(name, field.type).icon });
  }
  const epoch = this.propertyInteractionEpoch;
  let selected: string | null = null;
  this.closeAddPicker = showSearchableFieldPicker(this.add, {
   ...resolveSurfaceFloatingHostOptions(this.add), value: null,
   fields: [...fields.values()].sort((a, b) => a.label.localeCompare(b.label)),
   placeholder: t('taskEditor', 'searchFileProperties'), ariaLabel: t('taskEditor', 'propertyEditorAdd'), noMatchesText: t('taskEditor', 'noAvailableFileProperties'),
   onSelect: option => { selected = option.field; },
   onClose: () => { this.closeAddPicker = null; queueMicrotask(() => { if (selected && !this.disposed && epoch === this.propertyInteractionEpoch) this.openAddition(selected); }); },
  });
 }
 private openAddition(name: string): void {
  const field = this.field(name);
  if (field.reason || this.draft.properties.order.includes(name)) return;
  this.adding = name;
  const key = field.mapping?.canonicalKey;
  if (key && key !== 'note' && this.usesSharedControl(field)) this.openWorkflowPickerFromAction(key, this.add);
  else {
   this.fileProperties.set(name, { field: this.nativePropertyField(name, field.type), value: undefined, baseline: { present: false, value: undefined }, pending: true });
   const staging = this.add.ownerDocument.win.createDiv();
   this.filePropertyRows.set(name, { row: staging, value: staging, action: this.add.ownerDocument.win.createEl('button') });
   this.openFilePropertyPicker(name, undefined, 'picker', this.add);
  }
 }
 closePicker(render = true): void {
  this.propertyInteractionEpoch++;
  const close = this.closeAddPicker; this.closeAddPicker = null; close?.();
  this.closeActiveWorkflowActionPicker();
  this.closeFilePropertyPicker?.();
  requestFloatingPanelCloseForRoot(this.root, 'escape');
  this.adding = null;
  if (render) this.render();
 }

 protected confirmNewFileProperty(entry: EditorFileProperty): boolean { return entry.pending === true; }
 protected getFilePropertyPickerOwner(): HTMLElement { return this.root; }
 protected hasDesktopPropertyRules(): boolean { return true; }
 protected shouldCloseWorkflowPickerOnSelect(): boolean { return !!this.adding && !this.draft.properties.order.includes(this.adding); }
 protected syncFilePropertyRowVisibility(_entry: EditorFileProperty, surface: { row: HTMLElement; action: HTMLButtonElement }): void { surface.row.hidden = false; surface.action.hidden = true; }
 protected registerSchedulingDraftRefresher(refresh: () => void): void { this.schedulingRefreshers.add(refresh); }
 protected refreshSchedulingDraftControls(): void { for (const refresh of this.schedulingRefreshers) refresh(); }
 protected refreshWorkflowActionButtonStates(): void { this.applyThemeColor(); }
 protected refreshWorkflowPickerSurfaceValues(): void { this.render(); }
 protected refreshMobileCoreButtons(): void { /* This host is desktop-only. */ }
 protected async refreshTaskSource(): Promise<void> { this.render(); }
 protected async refreshDesktopFileProperties(): Promise<void> { this.render(); }
 protected getCompactTextSourcePath(): string { return this.options.file.path; }
 protected getWorkflowActionFocusTarget(key: string): HTMLButtonElement | undefined { return this.workflowActionButtons.get(key) ?? this.add; }
 protected getManualDatePickerOptions(): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } { return this.getRepeatDayPickerPopoverOptions(); }
 protected getRepeatDayPickerPopoverOptions(): { weekStart: 'monday' | 'sunday'; showWeekNumbers: boolean } { return { weekStart: this.settings.calendarWeekStart, showWeekNumbers: this.settings.calendarSidebarShowWeekNumbers }; }
 protected autoSizeCompactTextarea(textarea: HTMLTextAreaElement): void {
  const style = this.win.getComputedStyle(textarea);
  textarea.setCssProps({ height: '0px' });
  textarea.style.height = `${Math.ceil(textarea.scrollHeight + (parseFloat(style.borderTopWidth) || 0) + (parseFloat(style.borderBottomWidth) || 0))}px`;
  this.notifyPropertyContentChanged();
 }
 protected handleCompactTextEditorIntent(): void { this.add.focus({ preventScroll: true }); }
 // Task-only capabilities are deliberately absent. No task identity or task writer is exposed to this host.
 protected ensureRepeatSeriesIdentity(): void { /* Plain notes have no series identity. */ }
 protected prepareRepeatIdentityPatch(): void { /* Plain notes have no series identity. */ }
 protected getWorkflowSubtaskIds(): string[] { return []; }
 protected getEstimateReallocationProposal(): null { return null; }
 protected getEstimateReallocationTooltip(): string { return t('taskEditor', 'filePropertyUnavailable', { name: 'Estimate' }); }
 protected async handleEstimateReallocationClick(): Promise<void> { /* No task estimate distribution. */ }
 protected renderParentTaskPicker(): void { /* Field is read-only without a task identity. */ }
 protected renderSubtaskPicker(): void { /* Field is read-only without a task identity. */ }
 protected renderTaskListPicker(): void { /* Field is read-only without a task identity. */ }
 protected openParentTaskWorkflowAction(): null { return null; }
 protected openSubtasksWorkflowAction(): null { return null; }
 protected openDependencyWorkflowAction(): null { return null; }
 private cancelTimer(): void {
  if (this.timer !== null) this.win.clearTimeout(this.timer);
  this.timer = null;
 }

 private scheduleSave(): void {
  this.cancelTimer();
  if (!this.isEdited || this.disposed) return;
  this.timer = this.win.setTimeout(() => {
   this.timer = null;
   if (!this.saving) void this.persist();
  }, Math.max(0, this.nextSaveAt - Date.now()));
 }

 private persist(): Promise<boolean> {
  if (this.saving) return this.saving;
  if (!this.isEdited) return Promise.resolve(true);
  const sent = this.draft.snapshot();
  for (const change of sent) this.submitted.add(change.name);
  this.saving = (async () => {
   const result = await this.options.save(sent, () => !this.disposed).catch((): PropertyEditorSaveResult => ({ status: 'failed' }));
   this.submitted.clear();
   this.saving = null;
   if (this.disposed) return false;
   if (result.status === 'saved') {
    this.draft.acknowledge(result.properties, sent);
    this.pendingRefresh = true;
    this.settleRefresh();
    this.message.hidden = true;
    if (this.isEdited && this.timer === null) this.scheduleSave();
    return true;
   }
   const text = t('taskEditor', result.status === 'conflict' ? 'propertyEditorConflict'
    : result.status === 'unsupported' ? 'filePropertiesUnavailable' : 'propertyEditorSaveFailed');
   if (this.message.hidden || this.message.textContent !== text) new Notice(text);
   this.message.textContent = text;
   this.message.hidden = false;
   return false;
  })();
  return this.saving;
 }

 async prepareClose(): Promise<boolean> {
  this.closePicker();
  this.cancelTimer();
  while (this.isEdited) {
   if (!await this.persist()) return false;
   this.cancelTimer();
  }
  return true;
 }

 discard(): void {
  this.cancelTimer();
  this.draft.discard();
  this.hydrate();
  this.message.hidden = true;
  this.render();
 }

 destroy(): void {
  this.disposed = true;
  this.interactionObserver.disconnect();
  this.root.removeEventListener('focusout', this.sourceFocusout);
  this.root.removeEventListener('click', this.clearAddingOnRowClick, true);
  this.closePicker();
  this.cancelTimer();
  this.noteCompactEditor?.destroy();
  cleanupOperonHoverTooltips(this.root);
  this.root.closest('.operon-task-editor-modal')?.classList.remove('operon-task-editor-modal-source-wide', 'operon-task-editor-modal-has-source-context');
  this.root.empty();
  this.root.removeClass('operon-task-editor', 'operon-property-editor');
  for (const attribute of ['role', 'tabindex', 'aria-labelledby', 'data-operon-accessible-label-id']) this.root.removeAttribute(attribute);
  this.root.style.removeProperty('--operon-task-editor-accent');
 }
}
