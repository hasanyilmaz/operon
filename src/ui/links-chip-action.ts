import { transferLightboxOpening, getLightboxOrigin } from './lightbox';
import { Notice, Platform, TFile, type App } from 'obsidian';
import { isTaskSourceOpenModifierClick } from './task-source-open-modifier';
import { openLightboxTarget, resolveLightboxFile, type LightboxTarget } from './lightbox-opening';

import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { findInlinePropertyTask } from '../core/inline-property-source';
import { resolveInlineTaskDescriptionCursorCh } from '../core/parser';
import { isRecord, isUnknownFunction } from '../core/unknown-value';
import { getOwnerDocument } from '../core/dom-compat';
import { splitTaskListValue } from '../core/task-field-patch';
import { getTaskMediaReferenceAlias, parseTaskMediaReferenceList, resolveTaskMediaReference } from '../core/task-media-reference';
import { parseCompactWikiLinkValue, type InlineTaskCompactChipEntry } from './compact-task-layout';
import { getCustomFieldMapping } from './custom-field-surfaces';
import { parseExternalLinkValue } from './field-pickers/links-utils';
import { openTaskFieldPicker, type TaskFieldPickerDispatchOptions } from './task-field-picker-dispatch';
import { bindCurrentChipPreview, resolveExternalTaskMediaPreviewSource } from './compact-chip-link-preview';
import { createOwnedLightboxLeaf, getLightboxOwnerLeaf, lightboxFileState, prepareLightboxTab } from './web-lightbox';

const OPENING_FIELDS = new Set(['links', 'taskImage', 'taskGallery', 'assignees', 'contexts', 'taskType', 'parentTask', 'taskInfo.source']);
export function isDesktopOpeningChip(key: string, settings: OperonSettings): boolean {
 if (!Platform.isDesktopApp) return false;
 if (OPENING_FIELDS.has(key)) return true;
 const custom = getCustomFieldMapping(settings.keyMappings, key);
 return custom?.type === 'text' || custom?.type === 'list';
}
export interface ChipOpeningContext {
 app: App;
 getSettings: () => OperonSettings;
 getTask: () => IndexedTask | null | undefined;
 getTaskById: (id: string) => IndexedTask | null | undefined;
 getAllTasks: () => IndexedTask[];
 listValues?: (key: string, value: string) => readonly string[];
 canActivate?: () => boolean;
 picker: (task: IndexedTask) => Pick<TaskFieldPickerDispatchOptions, 'onCommit'> & Partial<TaskFieldPickerDispatchOptions> | null;
}
export type ChipOpeningDecision = { kind: 'picker' } | { kind: 'missing' } | { kind: 'target'; target: LightboxTarget; sourceTask?: IndexedTask };

/** Read fresh fields at activation; a removed list item cannot silently become its neighbour. */
export function resolveChipOpening(entry: Pick<InlineTaskCompactChipEntry, 'key' | 'rawValue' | 'externalRawValue'>, context: ChipOpeningContext): ChipOpeningDecision {
 const task = context.getTask();
 if (!task || !isDesktopOpeningChip(entry.key, context.getSettings())) return { kind: 'missing' };
 const key = entry.key;
 if (key === 'taskInfo.source' || key === 'parentTask') {
  const source = key === 'parentTask' ? context.getTaskById(task.fieldValues.parentTask?.trim() ?? '') : task;
  if (!source || !(context.app.vault.getAbstractFileByPath(source.primary.filePath) instanceof TFile)) return { kind: key === 'parentTask' ? 'picker' : 'missing' };
  return { kind: 'target', sourceTask: source, target: { kind: 'local', operonId: source.operonId, linktext: source.primary.filePath, sourcePath: source.primary.filePath, line: source.primary.format === 'inline' ? source.primary.lineNumber : undefined } };
 }
 const mapping = getCustomFieldMapping(context.getSettings().keyMappings, key);
 const isList = ['links', 'assignees', 'contexts', 'taskGallery'].includes(key) || mapping?.type === 'list';
 const value = task.fieldValues[key] ?? '';
 const member = entry.rawValue ?? entry.externalRawValue;
 const values = context.listValues?.(key, value) ?? (key === 'taskGallery' ? parseTaskMediaReferenceList(value) : splitTaskListValue(value));
 const raw = isList ? member && values.includes(member) ? member : '' : value;
 const media = key === 'taskImage' || key === 'taskGallery';
 if (key === 'links') {
  const parsed = parseExternalLinkValue(raw);
  return parsed ? { kind: 'target', target: { kind: 'web', url: parsed.url } } : { kind: 'picker' };
 }
 if (media) {
  const label = getTaskMediaReferenceAlias(raw) ?? parseCompactWikiLinkValue(raw)?.displayValue ?? raw.trim();
  const reference = resolveTaskMediaReference(raw);
  if (!reference.target || !reference.isOpenable) return { kind: 'missing' };
  if (reference.kind === 'http-url') return { kind: 'target', target: { kind: 'web', url: reference.target, media: resolveExternalTaskMediaPreviewSource(reference.target, label) ?? undefined } };
  const target: LightboxTarget = { kind: 'local', linktext: reference.target, sourcePath: task.primary.filePath, label };
  return resolveLightboxFile(context.app, target) ? { kind: 'target', target } : { kind: 'missing' };
 }
 const wiki = parseCompactWikiLinkValue(raw);
 if (!wiki) return { kind: 'picker' };
 const target: LightboxTarget = { kind: 'local', linktext: wiki.linkTarget, sourcePath: task.primary.filePath };
 return resolveLightboxFile(context.app, target) ? { kind: 'target', target } : { kind: 'picker' };
}

/** Only the approved desktop chip renderers call this; cell and draft editors retain their routes. */
export function bindDesktopChipOpening(chip: HTMLElement, entry: InlineTaskCompactChipEntry, context: ChipOpeningContext): boolean {
 if (!isDesktopOpeningChip(entry.key, context.getSettings())) return false;
 let pickerOpen = false;
 const showPicker = (): void => {
  if (pickerOpen || context.canActivate?.() === false) return;
  const task = context.getTask();
  if (!task) return;
  const options = context.picker(task);
  if (!options) return;
  pickerOpen = true;
  try {
   const close = openTaskFieldPicker({ app: context.app, settings: context.getSettings(), allTasks: context.getAllTasks(),
    canonicalKey: entry.key, anchor: chip, currentFieldValues: task.fieldValues,
    getCurrentFieldValues: () => context.getTask()?.fieldValues ?? {}, currentTaskId: task.operonId,
    currentTags: task.tags, sourcePath: task.primary.filePath, taskFormat: task.primary.format,
    ...options, onClose: () => { pickerOpen = false; options.onClose?.(); } });
   if (!close) pickerOpen = false;
  } catch (error) { pickerOpen = false; throw error; }
 };
 bindResolvedChipOpening(chip, {
  ...context, resolve: () => resolveChipOpening(entry, context),
  canActivate: () => !pickerOpen && context.canActivate?.() !== false,
  onPicker: showPicker, missingSourceUsesPicker: entry.key === 'parentTask',
  media: entry.key === 'taskImage' || entry.key === 'taskGallery',
 });
 return true;
}

/** Shared event, current-target, source-line, native fallback and preview lifecycle. */
export interface ResolvedOpeningContext {
 app: App;
 getSettings?: () => OperonSettings;
 resolve: () => ChipOpeningDecision;
 canActivate?: () => boolean;
 onPicker?: () => void;
 missingSourceUsesPicker?: boolean;
 media?: boolean;
 stopPointerDown?: boolean;
}

export async function activateResolvedOpening(
 chip: HTMLElement,
 context: ResolvedOpeningContext,
 event: Pick<MouseEvent, 'button' | 'type' | 'detail' | 'metaKey' | 'ctrlKey'> = { button: 0, type: 'click', detail: 0, metaKey: false, ctrlKey: false },
): Promise<void> {
 const external = event.button === 1 && event.type === 'auxclick';
 if ((event.button !== 0 && !external) || event.detail > 1 || context.canActivate?.() === false) return;
 try {
   const decision = context.resolve();
   if (external) {
    if (Platform.isDesktopApp && !context.media && decision.kind === 'target' && decision.target.kind === 'web') {
     await openLightboxTarget(context.app, chip, decision.target, 'external');
    }
    return;
   }
   if (decision.kind === 'picker') { context.onPicker?.(); return; }
   if (decision.kind === 'missing') { new Notice('Link target not found.'); return; }
   const target = decision.target;
   if (decision.sourceTask?.primary.format === 'inline' && target.kind === 'local') {
    if (!context.getSettings) return;
    const source = decision.sourceTask;
    const file = context.app.vault.getAbstractFileByPath(source.primary.filePath);
    if (!(file instanceof TFile)) { new Notice('Link target not found.'); return; }
    const content = await context.app.vault.read(file);
    const match = findInlinePropertyTask(content, file.path, source.operonId, context.getSettings().keyMappings);
    const fresh = context.resolve();
    if (fresh.kind !== 'target' || fresh.sourceTask?.operonId !== source.operonId || fresh.sourceTask?.primary.filePath !== file.path) return;
    if (!match) { if (context.missingSourceUsesPicker) context.onPicker?.(); else new Notice('Link target not found.'); return; }
    target.line = match.index;
    target.caretCh = resolveInlineTaskDescriptionCursorCh(match.parsed!);
   }
   if (context.canActivate?.() === false) return;
   const mode = event.detail !== 0 && isTaskSourceOpenModifierClick(event) ? 'tab' : 'lightbox';
   const result = await openLightboxTarget(context.app, chip, target, mode);
   if (result === 'missing') new Notice('Link target not found.');
   else if (result === 'unsupported' && target.kind === 'local') {
    const resolved = resolveLightboxFile(context.app, target);
    if (!resolved) { new Notice('Link target not found.'); return; }
    // openFile delegates unregistered extensions to the OS; this fallback is native-only.
    const registry = (context.app as App & { viewRegistry?: unknown }).viewRegistry;
    if (!isRecord(registry) || !isUnknownFunction(registry.getTypeByExtension) || !isUnknownFunction(registry.getViewCreatorByType)) {
     new Notice('This file type cannot be opened inside Obsidian.'); return;
    }
    const viewType = registry.getTypeByExtension(resolved.file.extension);
    if (typeof viewType !== 'string' || !viewType || typeof registry.getViewCreatorByType(viewType) !== 'function') {
     new Notice('This file type cannot be opened inside Obsidian.'); return;
    }
    const doc = getOwnerDocument(chip);
    const origin = getLightboxOrigin(chip) ?? getLightboxOwnerLeaf(context.app, doc);
    if (mode === 'tab') {
     await transferLightboxOpening(chip, () => prepareLightboxTab(context.app, doc, async leaf => {
      await leaf.openFile(resolved.file, {active: false, eState: lightboxFileState(resolved)});
      await leaf.loadIfDeferred();
      if (leaf.view.containerEl.ownerDocument !== doc || leaf.view.getViewType() !== viewType) throw new Error('Unavailable target view');
     }, 'tab', origin));
     return;
    }
    const owned = origin.getViewState().pinned === true;
    const leaf = owned ? createOwnedLightboxLeaf(context.app, doc) : origin;
    try {
     if (leaf.view.containerEl.ownerDocument !== doc) throw new Error('Wrong window');
     await leaf.openFile(resolved.file, { active: true, eState: lightboxFileState(resolved) });
     context.app.workspace.setActiveLeaf(leaf, { focus: true });
    } catch (error) { if (owned) leaf.detach(); throw error; }
   }
 } catch { new Notice('Could not open this link. Please try again.'); }
}

export function bindResolvedChipOpening(chip: HTMLElement, context: ResolvedOpeningContext): void {
 let opening = false;
 const activate = async (event: MouseEvent): Promise<void> => {
  if (opening) return;
  opening = true;
  try { await activateResolvedOpening(chip, context, event); } finally {opening = false;}
 };
 const isWebLink = (): boolean => {
  if (!Platform.isDesktopApp || context.media) return false;
  const decision = context.resolve();
  return decision.kind === 'target' && decision.target.kind === 'web' && !decision.target.media;
 };
 if (context.stopPointerDown) chip.addEventListener('pointerdown', event => { if (event.button === 0 || event.button === 1 && isWebLink()) { event.preventDefault(); event.stopPropagation(); } });
 chip.addEventListener('mousedown', event => { event.preventDefault(); event.stopPropagation(); });
 chip.addEventListener('click', event => { event.preventDefault(); event.stopPropagation(); void activate(event); });
 chip.addEventListener('auxclick', event => {
  if (event.button !== 1 || !isWebLink()) return;
  event.preventDefault(); event.stopPropagation(); void activate(event);
 });
 const nativeButton = chip.tagName === 'BUTTON';
 if (!nativeButton) { chip.tabIndex = 0; chip.setAttribute('role', 'button'); }
 chip.addEventListener('keydown', event => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.stopPropagation();
  if (!nativeButton || event.repeat) event.preventDefault();
  if (!nativeButton && !event.repeat) chip.click();
 });
 bindCurrentChipPreview(context.app, chip, () => {
  if (context.canActivate?.() === false) return null;
  const decision = context.resolve();
  return decision.kind === 'target' ? decision.target : null;
 }, context.media === true, event => { void activate(event); });
}


/** Existing Table Links route. Table field routing is deliberately outside the chip stage. */
export function handleLinksChipClick(app: App, chip: HTMLElement, entry: { key: string; externalUrl?: string | null }, event: MouseEvent): boolean {
	if (!Platform.isDesktopApp || entry.key !== 'links' || !entry.externalUrl) return false;
	const external = event.button === 1 && event.type === 'auxclick';
	if ((event.button !== 0 && !external) || event.detail > 1) return true;
	void openLightboxTarget(app, chip, { kind: 'web', url: entry.externalUrl },
		external ? 'external' : event.detail !== 0 && isTaskSourceOpenModifierClick(event) ? 'tab' : 'lightbox');
	return true;
}

export function bindLinksChipKeyboard(chip: HTMLElement, key: string): void {
	if (!Platform.isDesktopApp || key !== 'links' || chip.tagName === 'BUTTON') return;
	chip.tabIndex = 0;
	chip.setAttribute('role', 'button');
	chip.addEventListener('keydown', event => {
		if (event.key !== 'Enter' && event.key !== ' ') return;
		event.preventDefault();
		event.stopPropagation();
		if (!event.repeat) chip.click();
	});
}
