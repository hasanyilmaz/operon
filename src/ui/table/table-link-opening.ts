import { resolveTaskTextLink } from '../task-text-link-opening';
import { parseTableTaskListValue } from './table-value-adapter';
import { bindOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';
import { getNativePropertyIndex } from '../../indexer/native-property-index';
import type { IndexedTask } from '../../types/fields';
import { getTaskDisplayTitle } from '../../core/task-display-title';
import type { TableFilePropertyField } from './table-file-property';
import { Platform, type App } from 'obsidian';
import { bindResolvedChipOpening, isDesktopOpeningChip, resolveChipOpening, type ChipOpeningContext, type ChipOpeningDecision } from '../links-chip-action';
import { parseCompactWikiLinkValue } from '../compact-task-layout';
import { type CompactTaskMarkdownLink } from '../compact-task-markdown-renderer';
import { resolveLightboxFile, type LightboxTarget } from '../lightbox-opening';

export interface TableOpeningContext extends ChipOpeningContext {
 onPicker: () => void;
}

/** Table contributes identity and editor ownership; opening stays in the shared host. */
function bind(chip: HTMLElement, context: TableOpeningContext, resolve: () => ChipOpeningDecision, media = false, parent = false): void {
 chip.dataset.operonTableLink = 'true';
 if (!chip.getAttribute('aria-labelledby')) setAccessibleLabelWithoutTooltip(chip, chip.getAttribute('aria-label') || chip.textContent || '');
 chip.draggable = false;
 chip.addEventListener('dragstart', event => event.preventDefault());
 chip.addEventListener('dblclick', event => { event.preventDefault(); event.stopPropagation(); });
 bindResolvedChipOpening(chip, { ...context, resolve, media, missingSourceUsesPicker: parent, stopPointerDown: true });
}

export function bindTableTaskOpening(chip: HTMLElement, key: string, rawValue: string, context: TableOpeningContext): boolean {
 const canonicalKey = key === 'source' ? 'taskInfo.source' : key;
 if (!isDesktopOpeningChip(canonicalKey, context.getSettings())) return false;
 bind(chip, context, () => resolveChipOpening({ key: canonicalKey, rawValue }, { ...context, listValues: parseTableTaskListValue }),
  key === 'taskImage' || key === 'taskGallery', key === 'parentTask');
 return true;
}

export function resolveTableWikiOpening(context: TableOpeningContext, raw: unknown): ChipOpeningDecision {
 const task = context.getTask();
 if (!task) return { kind: 'missing' };
 const wiki = typeof raw === 'string' ? parseCompactWikiLinkValue(raw) : null;
 if (!wiki) return { kind: 'picker' };
 const target: LightboxTarget = { kind: 'local', linktext: wiki.linkTarget, sourcePath: task.primary.filePath };
 return resolveLightboxFile(context.app, target) ? { kind: 'target', target } : { kind: 'picker' };
}

/** Native properties retain their real identity and typed values, not canonical-key aliases. */
export function bindTablePropertyOpening(chip: HTMLElement, context: TableOpeningContext, currentValue: () => unknown): boolean {
 if (!Platform.isDesktopApp) return false;
 bind(chip, context, () => resolveTableWikiOpening(context, currentValue()));
 return true;
}

export function bindTableMarkdownOpening(chip: HTMLElement, link: CompactTaskMarkdownLink, key: 'description' | 'note', context: TableOpeningContext): void {
 const destination = link.type === 'wikilink' ? link.target : link.destination;
 if (link.type === 'markdown-link' && link.external) {
  bindOperonHoverTooltip(chip, { title: link.label, content: destination, taskColor: null });
  setAccessibleLabelWithoutTooltip(chip, `${link.label}: ${destination}`);
 }
 bind(chip, context, () => {
  const task = context.getTask();
  if (!task) return { kind: 'missing' };
  const value = key === 'description' ? getTaskDisplayTitle(task, context.getSettings().fileTaskDisplayTitleEnabled) : task.fieldValues.note ?? '';
  const decision = resolveTaskTextLink(context.app, link, {value, sourcePath:task.primary.filePath});
  return decision.kind === 'missing' ? {kind:'picker'} : decision;
 });
}

export function readTablePropertyLinkValue(app: App, task: IndexedTask | null | undefined, field: TableFilePropertyField, member?: unknown): unknown {
 const index = getNativePropertyIndex(app);
 if (!task || !index.isReady([task])) return undefined;
 const row = index.getTask(task);
 const property = row.available ? row.properties.get(field.propertyName.toLowerCase()) : undefined;
 if (property?.type !== field.type || !property.present) return undefined;
 return field.type === 'list' ? Array.isArray(property.value) && typeof member === 'string' && property.value.includes(member) ? member : undefined : property.value;
}
