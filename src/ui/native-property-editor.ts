import { propertyReadOnlyWarningText } from './property-readonly-warning';
import { bindPropertyIcon } from './property-icon-presentation';
import { isWideEditorSourceViewport } from './editor-source-layout';
import { Notice, Platform, setIcon, type App, type TFile } from 'obsidian';
import { setAccessibleLabelWithoutTooltip } from './accessibility-label';
import { getOwnerWindow } from '../core/dom-compat';
import { t } from '../core/i18n';
import { PropertyEditorDraft } from '../core/property-editor-draft';
import { PropertyEditorAdapter } from '../core/property-editor-adapter';
import { editorPropertyCandidateNames, inferVaultPropertyEditorTypes, type PropertyEditorField } from '../core/property-editor-fields';
import { planPropertyEditorWrite, type PropertyEditorChange, type PropertyEditorDocument } from '../core/property-editor-document';
import { isEmptyFilePropertyValue, readRawYamlPropertyExpectation, type RawYamlPropertyValue } from '../core/raw-yaml-property';
import { getNativePropertyIndex } from '../indexer/native-property-index';
import type { IndexedTask, ParsedTask } from '../types/fields';
import { normalizeTaskEditorWorkflowPickers, type OperonSettings } from '../types/settings';
import { getVisiblePropertyName } from '../core/yaml-fields';
import { DEFAULT_INLINE_REPEAT_COMPLETION_MODE } from '../storage/repeat-series-store';
import { EditorPropertyFields, DESKTOP_CORE_FIELDS, type EditorFileProperty } from './editor-property-fields';
import { getCustomFieldMapping, isProjectedCustomFieldType } from './custom-field-surfaces';
import { getManagedTaskDataFieldPicker } from './task-data-field-picker';
import type { CompactMarkdownEditorSurface } from './compact-markdown-editor-surface';
import type { TaskEditorFileBodyContext } from './task-editor-content';
import type { TaskEditorSectionId } from '../types/task-editor-sections';
import { resolveTaskEditorLayout, type TaskEditorLayout } from '../core/task-editor-layout';
import { createCompactEditorWorkflow, createEditorPropertyGroup, createEditorSectionHosts, createEditorTextSection, createEditorTitle, editorSectionLabel } from './editor-sections-layout';
import { bindEditorInteractionState } from './editor-interaction-state';
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
 canConvert?(): boolean;
 convert?(): Promise<void>;
 save(changes: readonly PropertyEditorChange[], current: () => boolean, expectedSource?: string): Promise<PropertyEditorSaveResult>;
}

/** YAML draft and save lifecycle for the shared editor layout. */
export class NativePropertyEditor extends EditorPropertyFields {
 readonly root: HTMLElement;
 private readonly groups = new Map<TaskEditorSectionId, { group: HTMLElement; actions?: HTMLElement }>();
 private readonly sectionLayout: TaskEditorLayout;
 private readonly stopInteraction: () => void;
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
 private conversionCommitted = false;
 private autosavePaused = false;
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
 private readonly headerActions = new Map<string, HTMLButtonElement>();
 private noteSurface: { name: string; row: HTMLElement; value: string } | null = null;
 private readonly surfaces = new Map<string, { row: HTMLElement; label: HTMLButtonElement; value: HTMLElement; shared: boolean; signature: string; action?: HTMLButtonElement; key: string }>();
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
 protected readonly isPhone = Platform.isPhone;
 protected readonly usesMobileLayout: boolean;
 protected readonly usesTouchDesktopLayout: boolean;
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
  this.sectionLayout = resolveTaskEditorLayout(this.settings.taskEditorSections, this.settings.keyMappings);
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
  this.usesMobileLayout = this.isPhone && this.settings.taskEditorUseMobileLayout;
  this.usesTouchDesktopLayout = !this.usesMobileLayout && (this.isPhone || Platform.isTablet);
  host.toggleClass('operon-task-editor-mobile', this.usesMobileLayout);
  host.toggleClass('operon-task-editor-phone-desktop', this.isPhone && !this.usesMobileLayout);
  host.toggleClass('operon-task-editor-touch-desktop', this.usesTouchDesktopLayout);
  this.stopInteraction = bindEditorInteractionState(host, this.usesTouchDesktopLayout);
  createEditorTitle(main, title);
  this.message = main.createDiv({ cls: 'operon-property-editor-message', attr: { role: 'status' } });
  this.message.hidden = true;
  const layout = this.usesMobileLayout ? null : createEditorSectionHosts(main, this.sectionLayout.sections);
  const compact = layout ? null : main.createDiv('operon-task-editor-mobile-body');
  this.workflowRowsEl = layout?.root ?? compact!;
  const label = (id: TaskEditorSectionId) => editorSectionLabel(this.sectionLayout.sections, id);
  if (layout) for (const target of Array.from(layout.root.children)) (target as HTMLElement).hidden = true;
  const compactPrimary = compact?.createDiv('operon-task-editor-mobile-primary');
  const textHost = (id: 'description' | 'notes') => {
   const target = layout?.host(id) ?? compactPrimary!;
   if (layout) target.addClass('operon-task-editor-primary-fields');
   return target;
  };
  if (options.canConvert?.() && options.convert) {
   const target = textHost('description');
   target.hidden = false;
   const { group } = createEditorTextSection(target, 'description', label('description'));
   const convert = group.createEl('button', { text: t('taskEditor', 'convertNoteToFileTask'), cls: 'operon-editor-picker-button', attr: { type: 'button' } });
   convert.addEventListener('click', () => {
    if (convert.disabled || !options.canConvert?.() || !options.convert) return;
    convert.disabled = true;
    void options.convert().finally(() => {
     if (!this.disposed) { convert.disabled = this.conversionCommitted || !options.canConvert?.(); if (!convert.disabled) convert.focus({ preventScroll: true }); }
    });
   });
  }
  this.groups.set('notes', createEditorTextSection(textHost('notes'), 'notes', label('notes')));
  if (layout) {
   for (const { id } of this.sectionLayout.groups) {
    const target = layout.host(id);
    target.addClass('operon-editor-desktop-properties', 'operon-task-editor-workflow-values');
    this.groups.set(id, createEditorPropertyGroup(target, id, label(id)));
   }
  } else {
   const surface = createCompactEditorWorkflow(compact!.createDiv('operon-task-editor-mobile-workflow'), t('settings', 'taskEditorWorkflowPickers'));
   this.groups.set('additional', { group: surface.rows, actions: surface.actions });
  }
  const actions = this.groups.get('additional')!.actions!;
  this.add = this.additionalPropertyAdd = actions.createEl('button', { cls: 'operon-task-editor-workflow-action-button operon-editor-file-property-add', attr: { type: 'button' } });
  setIcon(this.add, 'plus');
  const addLabel = t('taskEditor', 'addFileProperty');
  setAccessibleLabelWithoutTooltip(this.add, addLabel);
  this.bindEditorHoverTooltip(this.add, { content: addLabel, taskColor: () => this.getThemeColor() });
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
 setConversionCommitted(): void {
  this.conversionCommitted = true;
  this.closePicker(false);
  this.mainPanelEl.inert = true;
 }
 private makeAdapter(): PropertyEditorAdapter { return new PropertyEditorAdapter(this.draft.properties, this.settings.keyMappings, getNativePropertyIndex(this.app).getTypes(), this.inferredTypes ??= inferVaultPropertyEditorTypes(this.app), this.settings.inlinePropertyDefinitions); }
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
  if (field.control === 'native') return false;
  return DESKTOP_CORE_FIELDS.has(key) || key === 'note' || this.canRenderWorkflowPickerKey(key);
 }
 private render(): void {
  if (this.disposed || this.rendering) return;
  this.rendering = true;
  const scroll = this.mainPanelEl.scrollTop;
  const valuesBeforeRender = { ...this.fieldValues }, tagsBeforeRender = [...this.tags];
  try {
   const document = this.draft.properties;
   this.applyThemeColor();
   if (this.noteSurface && (!document.order.includes(this.noteSurface.name) || !this.usesSharedControl(this.field(this.noteSurface.name)))) {
    this.noteCompactEditor?.destroy(); this.noteCompactEditor = null;
    this.noteSurface.row.remove(); this.noteSurface = null;
    this.updateEmptyPropertyRemoval(this.groups.get('notes')!.group, '', false, () => {});
   }
   const positions = new Map<HTMLElement, number>();
   for (const [name, surface] of this.surfaces) {
    if (document.order.includes(name)) continue;
    this.removeSurface(name, surface);
   }
   this.refreshHeaderActions();
   const order = document.order.map(name => {
    const field = this.field(name);
    const { section, rank } = this.sectionLayout.position(this.sectionLayout.referenceForName(name));
    const id = field.mapping?.canonicalKey === 'note' ? 'notes' : this.usesMobileLayout ? 'additional' : section;
    return { name, field, id, rank };
   });
   if (!this.usesMobileLayout) order.sort((a, b) => a.rank - b.rank);
   for (const { name, field, id } of order) {
    const key = field.mapping?.canonicalKey ?? name;
    const shared = this.usesSharedControl(field);
    const { group } = this.groups.get(id)!;
    if (shared && key === 'note') {
     const value = this.fieldValues.note ?? '';
     if (!this.noteSurface || this.noteSurface.value !== value && !this.noteSurface.row.contains(this.root.ownerDocument.activeElement)) {
      this.noteSurface?.row.remove();
      const row = this.renderNote(group, false);
      row.dataset.propertyName = name;
      this.noteSurface = { name, row, value };
     }
     positions.set(group, 1);
     this.updateEmptyPropertyRemoval(group, this.getWorkflowPickerLabel(key), isEmptyFilePropertyValue(document.frontmatter[name]), () => this.removeFileProperty(name));
     continue;
    }
    let surface = this.surfaces.get(name);
    // Mapping/type changes may switch a row to the shared read-only representation.
    if (surface && (surface.shared !== shared || surface.key !== key)) {
     this.removeSurface(name, surface);
     surface = undefined;
    }
    if (!surface) {
     const native = this.nativePropertyField(name, field.type);
     const label = field.mapping ? this.getWorkflowPickerLabel(key) : name;
     const icon = () => shared ? this.resolveWorkflowPickerIcon(key) : this.resolveNativePropertyIcon(name, field.type);
     const built = this.createPropertyRow(group, shared ? key : native.key, label, icon, field.type === 'list');
     const action = this.headerActions.get(name);
     surface = { ...built, shared, signature: '', action, key };
     surface.row.dataset.propertyName = name;
     this.surfaces.set(name, surface);
     if (shared) {
      const core = DESKTOP_CORE_FIELDS.has(key);
      this.desktopPropertyRows.set(key, { row: surface.row, value: surface.value, core, signature: '' });
      this.workflowActionButtons.set(key, action ?? surface.label);
      this.bindDesktopPropertyInteraction(surface.row, surface.label, surface.value,
       () => this.openWorkflowPickerFromAction(key, surface!.label),
       () => this.openDesktopPropertyValue(key, surface!.value, surface!.label),
       () => !this.workflowActionDisabled(key));
      if (core) {
       surface.row.addClass('operon-editor-desktop-core-property');
       this.renderDesktopCoreProperty(surface.value, key); this.addDesktopCoreClear(surface.value, key);
       for (const input of Array.from(surface.value.querySelectorAll('input'))) setAccessibleLabelWithoutTooltip(input, name);
      }
     } else {
      const propertyAction = action ?? built.label;
      this.filePropertyRows.set(name, { ...built, action: propertyAction });
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
     surface.label.disabled = this.workflowActionDisabled(key);
     if (surface.action) surface.action.disabled = surface.label.disabled;
     const clear = surface.value.querySelector<HTMLButtonElement>('.operon-editor-value-clear');
     if (clear) { clear.hidden = !populated; clear.parentElement?.toggleClass('has-visible-clear', populated); }
     if (!DESKTOP_CORE_FIELDS.has(key) && surface.signature !== signature && !surface.value.querySelector('.is-picker-open') && !surface.value.contains(this.root.ownerDocument.activeElement)) {
      cleanupOperonHoverTooltips(surface.value); surface.value.empty();
      const managed = getManagedTaskDataFieldPicker(key, this.settings.keyMappings);
      const custom = getCustomFieldMapping(this.settings.keyMappings, key);
      if (populated) {
       if (managed) this.renderManagedTaskDataWorkflowPicker(surface.value, managed);
       else if (custom && isProjectedCustomFieldType(custom)) this.renderCustomWorkflowPicker(surface.value, custom);
       else this.renderWorkflowPicker(surface.value, key);
      }
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
    if (this.usesMobileLayout) {
     surface.row.toggleClass('has-compact-picker', !!surface.value.querySelector('.operon-editor-picker-anchor'));
    }
    const position = positions.get(group) ?? (this.usesMobileLayout && id !== 'notes' ? 0 : 1);
    if (group.children[position] !== surface.row) group.insertBefore(surface.row, group.children[position] ?? null);
    positions.set(group, position + 1);
    this.updateEmptyPropertyRemoval(surface.row, name, !field.reason && isEmptyFilePropertyValue(document.frontmatter[name]), () => this.removeFileProperty(name));
   }
   for (const [id, { group, actions }] of this.groups) {
    const hidden = id !== 'additional' && !positions.has(group) && !actions?.childElementCount;
    group.hidden = hidden;
    const host = group.closest<HTMLElement>('.operon-task-editor-section-host');
    if (host) host.hidden = hidden;
   }
   this.refreshSchedulingDraftControls();
  } finally { this.fieldValues = valuesBeforeRender; this.tags = tagsBeforeRender; this.rendering = false; this.mainPanelEl.scrollTop = scroll; }
  this.notifyPropertyContentChanged();
 }

 private refreshHeaderActions(): void {
  const document = this.draft.properties;
  const fields = new Set(document.order.filter(name => this.field(name).mapping?.canonicalKey !== 'note'));
  const items = this.usesMobileLayout ? this.settings.taskEditorWorkflowPickers
   : normalizeTaskEditorWorkflowPickers(undefined, undefined, this.settings.keyMappings);
  const keys = new Set(items.filter(item => item.visible).map(item => item.key));
  if (!this.usesMobileLayout) for (const key of DESKTOP_CORE_FIELDS) keys.add(key);
  for (const key of keys) {
   if (key === 'note') continue;
   const existing = document.order.find(name => this.field(name).mapping?.canonicalKey === key || name.toLowerCase() === key.toLowerCase());
   fields.add(existing ?? getVisiblePropertyName(key, this.settings.keyMappings));
  }
  if (!this.usesMobileLayout) for (const name of this.sectionLayout.assignedPropertyNames) {
   if (!Array.from(fields).some(field => this.sectionLayout.identify(this.sectionLayout.referenceForName(field)) === this.sectionLayout.identify(this.sectionLayout.referenceForName(name)))) fields.add(name);
  }
  for (const [name, button] of this.headerActions) if (!fields.has(name)) {
   requestFloatingPanelCloseForRoot(button, 'escape'); cleanupOperonHoverTooltips(button); button.remove(); this.headerActions.delete(name);
  }
  const ordered = Array.from(fields).sort((a, b) => this.sectionLayout.position(this.sectionLayout.referenceForName(a)).rank - this.sectionLayout.position(this.sectionLayout.referenceForName(b)).rank);
  const positions = new Map<HTMLElement, number>();
  for (const name of ordered) {
   const field = this.field(name);
   const id = this.usesMobileLayout ? 'additional' : this.sectionLayout.position(this.sectionLayout.referenceForName(name)).section;
   const actions = this.groups.get(id)?.actions;
   if (!actions) continue;
   let button = this.headerActions.get(name);
   if (!button) {
    button = actions.createEl('button', { cls: 'operon-task-editor-workflow-action-button', attr: { type: 'button' } });
    this.headerActions.set(name, button);
    const anchor = button;
    button.addEventListener('click', () => {
     const current = this.field(name);
     if (current.reason || current.mapping && this.workflowActionDisabled(current.mapping.canonicalKey)) return;
     if (!this.draft.properties.order.includes(name)) this.openAddition(name, anchor);
     else if (this.usesSharedControl(current) && current.mapping) this.openWorkflowPickerFromAction(current.mapping.canonicalKey, anchor);
     else this.openFilePropertyPicker(name, undefined, 'picker', anchor);
    });
   }
   const key = field.mapping?.canonicalKey;
   if (this.usesSharedControl(field) && key) {
    bindPropertyIcon(button, () => this.resolveWorkflowPickerIcon(key));
    this.syncPropertyActionState(button, this.hasWorkflowPickerValue(key), this.workflowActionDisabled(key), !!field.reason);
   } else this.refreshFilePropertyAction(name, button, { field: this.nativePropertyField(name, field.type), value: document.frontmatter[name], baseline: readRawYamlPropertyExpectation(document.frontmatter, name) ?? { present: false, value: undefined }, readonly: !!field.reason, readOnlyReason: field.reason });
   const displayName = key ? this.getWorkflowPickerLabel(key) : name;
   const label = field.taskOnly ? t('taskEditor', 'propertyEditorRequiresTask', { name: displayName }) : displayName;
   if (button.getAttribute('aria-label') !== label) {
    setAccessibleLabelWithoutTooltip(button, label);
    cleanupOperonHoverTooltips(button);
    this.bindEditorHoverTooltip(button, { content: label, taskColor: () => this.getThemeColor() });
   }
   if (key) this.workflowActionButtons.set(key, button);
   const position = positions.get(actions) ?? 0;
   if (actions.children[position] !== button) actions.insertBefore(button, actions.children[position] ?? null);
   positions.set(actions, position + 1);
  }
 }

 protected removeFileProperty(name: string): void {
  if (this.field(name).reason || !this.draft.remove(name, this.submitted.has(name))) return;
  const focus = this.headerActions.get(name) ?? this.add;
  this.hydrate(); this.scheduleEdited(); this.render(); (focus.isConnected ? focus : this.add).focus({ preventScroll: true });
 }

 private removeSurface(name: string, surface: { row: HTMLElement; action?: HTMLButtonElement; key: string; shared: boolean }): void {
  requestFloatingPanelCloseForRoot(surface.row, 'escape');
  if (surface.action) requestFloatingPanelCloseForRoot(surface.action, 'escape');
  cleanupOperonHoverTooltips(surface.row);
  surface.row.remove();
  this.surfaces.delete(name);
  if (surface.shared) {
   this.desktopPropertyRows.delete(surface.key);
   this.workflowActionButtons.delete(surface.key);
  }
  this.filePropertyRows.delete(name);
  this.fileProperties.delete(name);
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
  const names = editorPropertyCandidateNames(this.settings.keyMappings, getNativePropertyIndex(this.app).getTypes(), Object.keys(this.inferredTypes), document.order);
  const fields = new Map<string, { field: string; label: string; icon: string }>();
  for (const name of names) {
   if (this.inferredTypes[name] === 'unsupported') continue;
   if (document.order.includes(name) && !isEmptyFilePropertyValue(document.frontmatter[name])) continue;
   const field = this.field(name);
   if (field.reason && field.reason !== 'automatic' || field.control === 'workflow' && !this.usesSharedControl(field)) continue;
   const key = field.mapping?.canonicalKey;
   const identity = (key ?? name).toLowerCase();
   if (!fields.has(identity)) fields.set(identity, { field: name, label: key ? this.getWorkflowPickerLabel(key) : name, icon: field.reason === 'automatic' ? 'shield-alert' : key ? this.resolveWorkflowPickerIcon(key) : this.nativePropertyField(name, field.type).icon });
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
 private openAddition(name: string, anchor: HTMLButtonElement = this.add): void {
  const field = this.field(name);
  if (field.reason) { new Notice(propertyReadOnlyWarningText(name, field.reason)); return; }
  if (this.draft.properties.order.includes(name)) {
   const surface = this.surfaces.get(name);
   if (field.mapping && this.usesSharedControl(field)) this.openWorkflowPickerFromAction(field.mapping.canonicalKey, surface?.label ?? anchor);
   else this.openFilePropertyPicker(name, undefined, 'picker', surface?.label ?? anchor);
   return;
  }
  this.adding = name;
  const key = field.mapping?.canonicalKey;
  if (key && key !== 'note' && this.usesSharedControl(field)) this.openWorkflowPickerFromAction(key, anchor);
  else {
   this.fileProperties.set(name, { field: this.nativePropertyField(name, field.type), value: undefined, baseline: { present: false, value: undefined }, pending: true });
   const staging = this.add.ownerDocument.win.createDiv();
   this.filePropertyRows.set(name, { row: staging, value: staging, action: this.add.ownerDocument.win.createEl('button') });
   this.openFilePropertyPicker(name, undefined, 'picker', anchor);
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

 protected workflowFieldReadOnlyReason(key: string) {
  const name = this.draft.properties.order.find(name => this.field(name).mapping?.canonicalKey === key) ?? getVisiblePropertyName(key, this.settings.keyMappings);
  return this.field(name).reason;
 }
 protected getFilePropertyPickerOwner(): HTMLElement { return this.root; }
 protected hasDesktopPropertyRules(): boolean { return true; }
 protected syncFilePropertyRowVisibility(_entry: EditorFileProperty, surface: { row: HTMLElement; action: HTMLButtonElement }): void { surface.row.hidden = false; }
 protected registerSchedulingDraftRefresher(refresh: () => void): void { this.schedulingRefreshers.add(refresh); }
 protected refreshSchedulingDraftControls(): void { for (const refresh of this.schedulingRefreshers) refresh(); }
 protected refreshWorkflowActionButtonStates(): void { this.applyThemeColor(); }
 protected refreshWorkflowPickerSurfaceValues(): void { this.render(); }
 protected refreshMobileCoreButtons(): void { /* Plain notes have no task toolbar. */ }
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
 protected async persistExplicitEditorChanges(): Promise<void> { this.cancelTimer(); await this.persist(); }
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
  if (!this.isEdited || this.disposed || this.autosavePaused) return;
  this.timer = this.win.setTimeout(() => {
   this.timer = null;
   if (!this.saving) void this.persist();
  }, Math.max(0, this.nextSaveAt - Date.now()));
 }

 private persist(expectedSource?: string): Promise<boolean> {
  if (this.saving) return this.saving;
  if (!this.isEdited) return Promise.resolve(true);
  const sent = this.draft.snapshot();
  for (const change of sent) this.submitted.add(change.name);
  this.saving = (async () => {
   const result = await this.options.save(sent, () => !this.disposed, expectedSource).catch((): PropertyEditorSaveResult => ({ status: 'failed' }));
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
   this.showSaveFailure(result.status);
   return false;
  })();
  return this.saving;
 }

 private showSaveFailure(status: Exclude<PropertyEditorSaveResult['status'], 'saved'>): void {
  const text = t('taskEditor', status === 'conflict' ? 'propertyEditorConflict'
   : status === 'unsupported' ? 'filePropertiesUnavailable' : 'propertyEditorSaveFailed');
  if (this.message.hidden || this.message.textContent !== text) new Notice(text);
  this.message.textContent = text;
  this.message.hidden = false;
 }

 async pauseAutosave(): Promise<boolean> {
  this.autosavePaused = true;
  this.closePicker(false);
  this.cancelTimer();
  return this.saving ?? true;
 }

 resumeAutosave(): void {
  this.autosavePaused = false;
  if (this.message.hidden) this.scheduleSave();
 }

 async prepareConversion(before: string): Promise<string | null> {
  const plan = planPropertyEditorWrite(before, this.settings.keyMappings, this.draft.snapshot());
  if (plan.status !== 'ready') { this.showSaveFailure(plan.status); return null; }
  return await this.persist(before) && !this.isEdited ? plan.text : null;
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
  this.stopInteraction?.();
  this.root.removeEventListener('focusout', this.sourceFocusout);
  this.root.removeEventListener('click', this.clearAddingOnRowClick, true);
  this.closePicker();
  this.cancelTimer();
  this.noteCompactEditor?.destroy();
  cleanupOperonHoverTooltips(this.root);
  this.root.closest('.operon-task-editor-modal')?.classList.remove('operon-task-editor-modal-source-wide', 'operon-task-editor-modal-has-source-context');
  this.root.empty();
  this.root.removeClass('operon-task-editor', 'operon-property-editor', 'operon-task-editor-mobile', 'operon-task-editor-phone-desktop', 'operon-task-editor-touch-desktop');
  for (const attribute of ['role', 'tabindex', 'aria-labelledby', 'data-operon-accessible-label-id', 'data-editor-input']) this.root.removeAttribute(attribute);
  this.root.style.removeProperty('--operon-task-editor-accent');
 }
}
