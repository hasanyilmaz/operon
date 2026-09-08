import { setIcon } from 'obsidian';
import type { IndexedTask } from '../../types/fields';
import type { OperonSettings } from '../../types/settings';
import type { TableColumn } from '../../types/table';
import { resolveTableColumnDisplayMode } from '../../types/table';
import { formatTableCountdown, resolveTableCountdownDate } from '../../core/table-countdown';
import { createOwnerElement, getOwnerWindow } from '../../core/dom-compat';
import { t } from '../../core/i18n';
import { toLocalDatetime } from '../../core/local-time';
import { formatUiDate } from '../../core/ui-date-format';
import { formatTableDetailedDatetimeValue } from './table-datetime-format';
import { applyTableColumnCellAccent } from './table-cell-chip';
import { bindOperonHoverTooltip, closeBoundOperonHoverTooltip } from '../operon-hover-tooltip';
import { setAccessibleLabelWithoutTooltip } from '../accessibility-label';

interface CountdownTick {
 element: HTMLElement;
 visible: boolean;
 timestamp: number;
 tooltipOpen: boolean;
 update(now: Date): void;
}

/** One clock per owner window, shared by table and embed cells. */
class TableCountdownClock {
 private readonly entries = new Set<CountdownTick>();
 private timer: number | null = null;
 private readonly observer: IntersectionObserver | null;
 private readonly wake = (): void => this.refresh();
 constructor(private readonly owner: Window) {
  const Observer = (owner as Window & { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
  this.observer = Observer ? new Observer(records => {
   for (const record of records) {
    const entry = [...this.entries].find(item => item.element === record.target);
    if (entry) {
     entry.visible = record.isIntersecting;
     if (!entry.visible) closeBoundOperonHoverTooltip(entry.element);
    }
   }
   this.refresh();
  }) : null;
  owner.document.addEventListener('visibilitychange', this.wake);
  owner.addEventListener('focus', this.wake);
  owner.addEventListener('pageshow', this.wake);
 }
 add(entry: CountdownTick): () => void {
  entry.visible = this.observer === null;
  this.entries.add(entry);
  this.observer?.observe(entry.element);
  this.refresh();
  return () => {
   this.entries.delete(entry);
   this.observer?.unobserve(entry.element);
   this.refresh();
   if (!this.entries.size) {
    this.observer?.disconnect();
    this.owner.document.removeEventListener('visibilitychange', this.wake);
    this.owner.removeEventListener('focus', this.wake);
    this.owner.removeEventListener('pageshow', this.wake);
    clocks.delete(this.owner);
   }
  };
 }
 refresh(): void {
  if (this.timer !== null) this.owner.clearTimeout(this.timer);
  this.timer = null;
  if (this.owner.document.hidden) {
   for (const entry of this.entries) closeBoundOperonHoverTooltip(entry.element);
   return;
  }
  const now = new Date();
  const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
  let delay = midnight.getTime() - now.getTime();
  let visible = false;
  for (const entry of this.entries) {
   if (!entry.visible || !entry.element.isConnected) continue;
   visible = true;
   entry.update(now);
   const interval = entry.tooltipOpen ? 1000 : 60_000;
   delay = Math.min(delay, interval - now.getTime() % interval);
   const remaining = entry.timestamp - now.getTime();
   if (remaining > 0) delay = Math.min(delay, remaining, remaining % interval || interval);
  }
  if (visible) this.timer = this.owner.setTimeout(this.wake, Math.max(1, delay));
 }
}
const clocks = new WeakMap<Window, TableCountdownClock>();

export function renderTableCountdownCell(cell: HTMLElement, task: IndexedTask, column: TableColumn, settings: OperonSettings, rows: readonly IndexedTask[] = [task]): void {
 cell.addClass('operon-table-countdown-cell');
 // This synthetic value never enters the row's editor or tracking actions.
 cell.addEventListener('click', event => event.stopPropagation());
 cell.addEventListener('dblclick', event => event.stopPropagation());
 const target = resolveTableCountdownDate(task, column.countdownTarget);
 if (!target) return;
 const detailed = resolveTableColumnDisplayMode(column) === 'details';
 cell.toggleClass('is-compact-countdown', !detailed);
 const chip = cell.createSpan(detailed
  ? 'operon-table-cell-chip operon-chip operon-live-preview-chip operon-inline-compact-chip operon-task-chip operon-chip-readonly operon-table-countdown-chip is-detailed'
  : 'operon-table-icon-only-button operon-table-compact-datetime operon-table-countdown-chip');
 chip.tabIndex = 0;
 if (detailed) {
  const icon = chip.createSpan('operon-inline-compact-chip-icon operon-table-cell-chip-icon');
  icon.setAttribute('aria-hidden', 'true');
  setIcon(icon, 'hourglass');
 }
 const label = chip.createSpan('operon-table-cell-chip-label');
 const accent = applyTableColumnCellAccent(chip, column, target.date, { task, settings, decorateAsChip: detailed });
 if (!detailed && accent) chip.style.setProperty('--operon-table-icon-only-color', accent);
 const title = target.source === 'both'
  ? `${t('settings', 'upcomingScheduledSource')} / ${t('settings', 'upcomingDueSource')}`
  : t('settings', target.source === 'scheduled' ? 'upcomingScheduledSource' : 'upcomingDueSource');
 const dateText = target.timed
  ? formatTableDetailedDatetimeValue('datetimeStart', toLocalDatetime(new Date(target.timestamp)), settings)
  : formatUiDate(target.date, settings);
 let tooltipLabel: HTMLElement | null = null;
 const owner = getOwnerWindow(cell);
 let clock = clocks.get(owner);
 if (!clock) { clock = new TableCountdownClock(owner); clocks.set(owner, clock); }
 const entry: CountdownTick = {
  element: chip, visible: false, timestamp: target.timestamp, tooltipOpen: false,
  update(now) {
   const text = formatTableCountdown(target, now, detailed ? 'details' : 'compact');
   if (label.textContent !== text) {
    label.textContent = text;
    setAccessibleLabelWithoutTooltip(chip, `${title}: ${dateText}; ${text}`);
   }
   if (detailed && chip.isConnected) {
    const width = measureCountdownColumnWidth(chip, label, rows, column, now);
    chip.style.setProperty('--operon-countdown-width', `${width}px`);
   }
   if (tooltipLabel) {
    const text = formatTableCountdown(target, now, 'tooltip');
    if (tooltipLabel.textContent !== text) tooltipLabel.textContent = text;
   }
  },
 };
 entry.update(new Date());
 const release = clock.add(entry);
 const refresh = (): void => clock.refresh();
 bindOperonHoverTooltip(chip, {
  title, titleIcon: 'hourglass', taskColor: accent,
  contentElFactory: () => {
   const content = createOwnerElement(chip, 'div');
   content.createDiv({ text: dateText });
   tooltipLabel = content.createDiv('operon-table-countdown-tooltip-value');
   entry.tooltipOpen = target.timed;
   entry.update(new Date());
   refresh();
   return content;
  },
  onClose: () => { tooltipLabel = null; entry.tooltipOpen = false; refresh(); },
  onCleanup: release,
 });
}

interface CountdownColumnWidth {
 until: number;
 width: number;
}
const columnWidths = new WeakMap<readonly IndexedTask[], Map<string, CountdownColumnWidth>>();

/** Measure all filtered rows, including rows outside the virtual viewport. */
function measureCountdownColumnWidth(chip: HTMLElement, label: HTMLElement, rows: readonly IndexedTask[], column: TableColumn, now: Date): number {
 const owner = getOwnerWindow(chip);
 const textStyle = owner.getComputedStyle(label);
 const chipStyle = owner.getComputedStyle(chip);
 const detailed = resolveTableColumnDisplayMode(column) === 'details';
 // Computed font shorthand can be empty when tabular numerals are enabled.
 const font = [textStyle.fontFamily, textStyle.fontSize, textStyle.fontWeight, textStyle.fontStyle, textStyle.getPropertyValue('font-stretch'), textStyle.fontVariantNumeric].join('|');
 const pixels = (value: string): number => Number.parseFloat(value) || 0;
 const icon = chip.querySelector<HTMLElement>('.operon-table-cell-chip-icon');
 const iconStyle = icon ? owner.getComputedStyle(icon) : null;
 const extras = pixels(chipStyle.paddingLeft) + pixels(chipStyle.paddingRight)
  + pixels(chipStyle.borderLeftWidth) + pixels(chipStyle.borderRightWidth)
  + (icon && iconStyle ? icon.getBoundingClientRect().width + pixels(chipStyle.columnGap)
   + pixels(iconStyle.marginLeft) + pixels(iconStyle.marginRight) : 0);
 const key = `${column.countdownTarget ?? 'earlier'}|${detailed}|${font}|${textStyle.letterSpacing}|${extras}`;
 let cache = columnWidths.get(rows);
 if (!cache) { cache = new Map(); columnWidths.set(rows, cache); }
 const cached = cache.get(key);
 if (cached && now.getTime() < cached.until) return cached.width;
 const midnight = new Date(now); midnight.setHours(24, 0, 0, 0);
 let until = midnight.getTime();
 const texts = new Set<string>();
 for (const task of rows) {
  const target = resolveTableCountdownDate(task, column.countdownTarget);
  if (!target) continue;
  texts.add(formatTableCountdown(target, now, detailed ? 'details' : 'compact'));
  const remaining = target.timestamp - now.getTime();
  if (target.timed && remaining > 0) {
   until = Math.min(until, now.getTime() + (remaining % 60_000 || 60_000), target.timestamp);
  }
 }
 const ruler = createOwnerElement(chip, 'span');
 ruler.className = 'operon-countdown-measure';
 ruler.setAttribute('aria-hidden', 'true');
 ruler.style.fontFamily = textStyle.fontFamily;
 ruler.style.fontSize = textStyle.fontSize;
 ruler.style.fontWeight = textStyle.fontWeight;
 ruler.style.fontStyle = textStyle.fontStyle;
 ruler.style.setProperty('font-stretch', textStyle.getPropertyValue('font-stretch'));
 ruler.style.fontVariantNumeric = textStyle.fontVariantNumeric;
 ruler.style.letterSpacing = textStyle.letterSpacing;
 chip.ownerDocument.body.appendChild(ruler);
 let textWidth = 0;
 try {
  for (const text of texts) {
   ruler.textContent = text;
   textWidth = Math.max(textWidth, ruler.getBoundingClientRect().width);
  }
 } finally { ruler.remove(); }
 const width = Math.ceil(textWidth + extras);
 cache.set(key, { until, width });
 return width;
}
