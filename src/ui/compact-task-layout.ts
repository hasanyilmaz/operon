import { setIcon } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { splitTaskListValue } from '../core/task-field-patch';
import { OperonSettings, InlineTaskCompactChipItem, InlineTaskCompactChipKey, INLINE_TASK_COMPACT_CHIP_ORDER, INLINE_TASK_COMPACT_FALLBACK_ICONS } from '../types/settings';
import { isInternalCanonicalKey } from '../types/keys';
import { IndexedTask } from '../types/fields';
import { formatAssigneeDisplay } from './field-pickers/assignees-picker';
import { formatContextDisplay } from './field-pickers/contexts-picker';
import { parseExternalLinkValue } from './field-pickers/links-utils';
import { normalizeTagValue } from './field-pickers/tag-picker';
import { t } from '../core/i18n';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../core/location-coordinates';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { normalizeTaskIconValue } from '../core/task-icon-value';

export type CompactVisibleChipKey = InlineTaskCompactChipKey;

export interface LocationChipMatch {
	label: string;
	path: string;
	taskIcon?: string | null;
	taskColor?: string | null;
}

export type LocationChipResolver = (coordinateText: string) => LocationChipMatch | null;

export const COMPACT_VISIBLE_CHIP_KEYS = [
	'priority',
	'status',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'totalDuration',
	'totalEstimate',
	'links',
	'location',
] as const;

const COMPACT_INTERNAL_VISIBLE_KEYS = ['operonId', 'datetimeModified', 'taskColor', 'taskIcon'] as const;

export interface InlineTaskCompactChipEntry {
	key: InlineTaskCompactChipKey;
	label: string;
	icon: string;
	iconOnly: boolean;
	interactive: boolean;
	colorRole: 'default' | 'priority' | 'status';
	iconTone?: 'default' | 'today' | 'overdue';
	linkTarget: string | null;
	externalUrl?: string | null;
	externalRawValue?: string | null;
	locationCoordinate?: string | null;
	locationMarkerIcon?: string | null;
	locationMarkerColor?: string | null;
	taskColor?: string | null;
	tooltipTitle?: string;
	tooltipContent?: string;
}

function getCompactChipItems(
	settings: OperonSettings,
	chipItems?: InlineTaskCompactChipItem[],
): InlineTaskCompactChipItem[] {
	return chipItems ?? settings.inlineTaskCompactChips;
}

export function getInlineTaskCompactVisibleChipKeys(
	settings: OperonSettings,
	chipItems?: InlineTaskCompactChipItem[],
): InlineTaskCompactChipKey[] {
	return getCompactChipItems(settings, chipItems)
		.filter(item => item.visible)
		.map(item => item.key);
}

export function shouldResolveLocationCompactChips(
	settings: OperonSettings,
	chipItems?: InlineTaskCompactChipItem[],
): boolean {
	return getInlineTaskCompactVisibleChipKeys(settings, chipItems).includes('location');
}

export function getInlineTaskCompactVisibleKeys(
	settings: OperonSettings,
	chipItems?: InlineTaskCompactChipItem[],
): Set<string> {
	return new Set<string>([
		...getInlineTaskCompactVisibleChipKeys(settings, chipItems),
		...COMPACT_INTERNAL_VISIBLE_KEYS,
	]);
}

export const COMPACT_VISIBLE_KEYS = new Set<string>([
	...COMPACT_VISIBLE_CHIP_KEYS,
	...COMPACT_INTERNAL_VISIBLE_KEYS,
]);

export function buildInlineTaskCompactChipEntries(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
	locationResolver?: LocationChipResolver,
): InlineTaskCompactChipEntry[] {
	const entries: InlineTaskCompactChipEntry[] = [];
	const taskColor = normalizeTaskFieldColor(fieldValues['taskColor']);
	const itemMap = new Map(getCompactChipItems(settings, chipItems).map(item => [item.key, item]));
	const taskById = new Map(allTasks.map(task => [task.operonId, task]));
	for (const key of getInlineTaskCompactVisibleChipKeys(settings, chipItems)) {
		const item = itemMap.get(key);
		if (isSuppressedByTerminalDate(key, fieldValues)) continue;
		switch (key) {
			case 'priority': {
				const value = fieldValues['priority']?.trim();
				if (!value) break;
				entries.push(createEntry(settings, key, value, item?.iconOnly === true, 'priority'));
				break;
			}
			case 'status': {
				const value = fieldValues['status']?.trim();
				if (!value) break;
				entries.push(createEntry(settings, key, value, item?.iconOnly === true, 'status'));
				break;
			}
			case 'blocking':
			case 'blockedBy': {
				for (const operonId of splitTaskListValue(fieldValues[key])) {
					const dependencyTask = taskById.get(operonId);
					if (!dependencyTask) {
						const missingEntry = createEntry(settings, key, operonId, item?.iconOnly === true, 'default', false);
						missingEntry.tooltipTitle = t('taskEditor', 'dependencyMissingTask');
						missingEntry.tooltipContent = operonId;
						entries.push(missingEntry);
						continue;
					}
					const fullLabel = dependencyTask.description?.trim() || t('taskEditor', 'dependencyUntitledTask');
					const label = truncateCompactLabel(fullLabel);
					const linkTarget = dependencyTask.primary.format === 'yaml' ? dependencyTask.primary.filePath : null;
					const entry = createEntry(settings, key, label, item?.iconOnly === true, 'default', !!linkTarget, linkTarget);
					if (label !== fullLabel) {
						entry.tooltipTitle = key === 'blocking' ? t('taskEditor', 'blocking') : t('taskEditor', 'blockedBy');
						entry.tooltipContent = fullLabel;
					}
					entries.push(entry);
				}
				break;
			}
			case 'parentTask': {
				const parentTaskId = fieldValues['parentTask']?.trim();
				if (!parentTaskId) break;
				const parentTask = taskById.get(parentTaskId);
				if (!parentTask) break;
				const fullLabel = parentTask.description?.trim() || t('taskEditor', 'untitledTask');
				const label = truncateCompactLabel(fullLabel);
				const linkTarget = parentTask.primary.format === 'yaml' ? parentTask.primary.filePath : null;
				const entry = createEntry(settings, key, label, item?.iconOnly === true, 'default', !!linkTarget, linkTarget);
				if (label !== fullLabel) {
					entry.tooltipTitle = t('taskEditor', 'parentTask');
					entry.tooltipContent = fullLabel;
				}
				entries.push(entry);
				break;
			}
			case 'dateScheduled':
			case 'dateDue':
			case 'dateStarted': {
				const value = fieldValues[key]?.trim();
				if (!value) break;
				const entry = createEntry(settings, key, value, item?.iconOnly === true);
				entry.iconTone = getDateIconTone(key, value, fieldValues);
				entries.push(entry);
				break;
			}
			case 'dateCompleted':
			case 'dateCancelled': {
				const value = fieldValues[key]?.trim();
				if (!value) break;
				entries.push(createEntry(settings, key, value, item?.iconOnly === true));
				break;
			}
			case 'datetimeStart':
			case 'datetimeEnd': {
				const value = fieldValues[key]?.trim();
				if (!value) break;
				entries.push(createEntry(settings, key, formatCompactDatetimeTime(value, settings), item?.iconOnly === true));
				break;
			}
			case 'assignees': {
				for (const rawValue of splitTaskListValue(fieldValues['assignees'])) {
					entries.push(createEntry(
						settings,
						key,
						formatAssigneeDisplay(rawValue),
						item?.iconOnly === true,
						'default',
						!!extractWikiLinkTarget(rawValue),
						extractWikiLinkTarget(rawValue),
					));
				}
				break;
			}
			case 'contexts': {
				for (const rawValue of splitTaskListValue(fieldValues['contexts'])) {
					entries.push(createEntry(
						settings,
						key,
						formatContextDisplay(rawValue),
						item?.iconOnly === true,
						'default',
						!!extractWikiLinkTarget(rawValue),
						extractWikiLinkTarget(rawValue),
					));
				}
				break;
			}
			case 'links': {
				for (const rawValue of splitTaskListValue(fieldValues['links'])) {
					const parsed = parseExternalLinkValue(rawValue);
					if (!parsed) continue;
					const label = truncateCompactLabel(parsed.displayValue);
					const entry = createEntry(
						settings,
						key,
						label,
						item?.iconOnly === true,
						'default',
						true,
						null,
						parsed.url,
						parsed.rawValue,
					);
					if (label !== parsed.displayValue || parsed.isMarkdown) {
						entry.tooltipTitle = t('taskEditor', 'links');
						entry.tooltipContent = parsed.url;
					}
					entries.push(entry);
				}
				break;
			}
			case 'location': {
				const coordinate = parseLocationCoordinate(fieldValues['location']);
				if (!coordinate) break;
				const match = locationResolver?.(coordinate.canonical);
				const entry = createEntry(
					settings,
					key,
					match?.label ?? formatShortLocationCoordinate(coordinate),
					item?.iconOnly === true,
					'default',
					true,
					match?.path ?? null,
				);
				if (match?.taskIcon) {
					entry.icon = match.taskIcon;
				}
				entry.locationCoordinate = coordinate.canonical;
				entry.locationMarkerIcon = match
					? match.taskIcon ?? null
					: normalizeTaskIconValue(fieldValues['taskIcon']) || null;
				entry.locationMarkerColor = match?.taskColor ?? null;
				entry.taskColor = match?.taskColor ?? taskColor;
				entries.push(entry);
				break;
			}
			case 'duration': {
				const seconds = Number.parseInt(fieldValues['duration'] ?? '0', 10);
				if (!Number.isFinite(seconds) || seconds <= 0) break;
				entries.push(createEntry(settings, key, formatDuration(seconds), item?.iconOnly === true, 'default', false));
				break;
			}
			case 'totalDuration': {
				if (!isParentTask(fieldValues, allTasks)) break;
				const seconds = Number.parseInt(fieldValues['totalDuration'] ?? '0', 10);
				if (!Number.isFinite(seconds) || seconds <= 0) break;
				entries.push(createEntry(settings, key, formatDuration(seconds), item?.iconOnly === true, 'default', false));
				break;
			}
			case 'estimate': {
				const seconds = Number.parseInt(fieldValues['estimate'] ?? '0', 10);
				if (!Number.isFinite(seconds) || seconds <= 0) break;
				entries.push(createEntry(settings, key, formatDuration(seconds), item?.iconOnly === true));
				break;
			}
			case 'totalEstimate': {
				if (!isParentTask(fieldValues, allTasks)) break;
				const seconds = Number.parseInt(fieldValues['totalEstimate'] ?? '0', 10);
				if (!Number.isFinite(seconds) || seconds <= 0) break;
				entries.push(createEntry(settings, key, formatDuration(seconds), item?.iconOnly === true, 'default', false));
				break;
			}
			case 'tags': {
				for (const rawValue of tags.map(normalizeTagValue).filter(Boolean)) {
					entries.push(createEntry(settings, key, rawValue, item?.iconOnly === true));
				}
				break;
			}
		}
	}
	if (taskColor) {
		for (const entry of entries) {
			entry.taskColor ??= taskColor;
		}
	}
	return entries;
}

export function getInlineTaskCompactHiddenCount(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
): number {
	return getInlineTaskCompactHiddenKeys(fieldValues, tags, settings, allTasks, chipItems).length;
}

export function getInlineTaskCompactHiddenKeys(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
): string[] {
	return collectHiddenKeys(fieldValues, tags, getInlineTaskCompactVisibleKeys(settings, chipItems), allTasks);
}

export function collectHiddenKeys(
	fieldValues: Record<string, string>,
	tags: string[],
	visibleKeys: Iterable<string>,
	allTasks: IndexedTask[] = [],
): string[] {
	const visible = new Set(visibleKeys);
	const hidden = new Set<string>();

	for (const key of INLINE_TASK_COMPACT_CHIP_ORDER) {
		if (isSuppressedByTerminalDate(key, fieldValues)) continue;
		if (visible.has(key)) continue;
		if (hasCompactValue(key, fieldValues, tags, allTasks)) {
			hidden.add(key);
		}
	}

	for (const [key, rawValue] of Object.entries(fieldValues)) {
		if (!rawValue?.trim()) continue;
		if (visible.has(key)) continue;
		if (isInternalCanonicalKey(key)) continue;
		hidden.add(key);
	}

	return Array.from(hidden);
}

function hasTerminalDate(fieldValues: Record<string, string>): boolean {
	return !!fieldValues['dateCompleted']?.trim() || !!fieldValues['dateCancelled']?.trim();
}

function isSuppressedByTerminalDate(
	key: InlineTaskCompactChipKey,
	fieldValues: Record<string, string>,
): boolean {
	if (!hasTerminalDate(fieldValues)) return false;
	return key === 'status'
		|| key === 'dateScheduled'
		|| key === 'dateDue'
		|| key === 'dateStarted'
		|| key === 'datetimeStart'
		|| key === 'datetimeEnd'
		|| key === 'estimate';
}

export function createInlineTaskCompactChipElement(
	entry: InlineTaskCompactChipEntry,
	extraClasses = '',
	options?: { forceFull?: boolean; owner?: Node | null },
): HTMLElement {
	const iconOnly = entry.iconOnly && options?.forceFull !== true;
	const tagName = entry.interactive && !iconOnly ? 'button' : 'span';
	const chip = createOwnerElement(options?.owner, tagName);
	if (entry.interactive && tagName === 'button') {
		(chip as HTMLButtonElement).type = 'button';
	}
	chip.className = [
		'operon-chip',
		'operon-live-preview-chip',
		'operon-inline-compact-chip',
		entry.linkTarget || entry.externalUrl ? 'is-linked' : '',
		entry.locationCoordinate ? 'is-location' : '',
		iconOnly ? 'is-icon-only' : '',
		entry.key === 'priority' ? 'operon-chip-priority' : 'operon-chip-date',
		entry.interactive ? 'operon-chip-clickable' : 'operon-chip-readonly',
		extraClasses,
	].filter(Boolean).join(' ');

	const iconEl = createOwnerElement(chip, 'span');
	iconEl.className = 'operon-inline-compact-chip-icon';
	setIcon(iconEl, entry.icon);
	chip.appendChild(iconEl);

	const labelEl = createOwnerElement(chip, 'span');
	labelEl.className = 'operon-inline-compact-chip-label';
	labelEl.textContent = entry.label;
	chip.appendChild(labelEl);

	return chip;
}

function createEntry(
	settings: OperonSettings,
	key: InlineTaskCompactChipKey,
	label: string,
	iconOnly = false,
	colorRole: InlineTaskCompactChipEntry['colorRole'] = 'default',
	interactive = true,
	linkTarget: string | null = null,
	externalUrl: string | null = null,
	externalRawValue: string | null = null,
): InlineTaskCompactChipEntry {
	return {
		key,
		label,
		icon: getConfiguredKeyMappingIcon(key, settings.keyMappings) || INLINE_TASK_COMPACT_FALLBACK_ICONS[key],
		iconOnly,
		interactive,
		colorRole,
		linkTarget,
		externalUrl,
		externalRawValue,
	};
}

function hasCompactValue(
	key: InlineTaskCompactChipKey,
	fieldValues: Record<string, string>,
	tags: string[],
	allTasks: IndexedTask[] = [],
): boolean {
	switch (key) {
		case 'assignees':
		case 'contexts':
			return splitTaskListValue(fieldValues[key]).length > 0;
		case 'links':
			return splitTaskListValue(fieldValues['links']).some(value => !!parseExternalLinkValue(value));
		case 'location':
			return !!parseLocationCoordinate(fieldValues['location']);
		case 'tags':
			return tags.map(normalizeTagValue).filter(Boolean).length > 0;
		case 'duration':
		case 'estimate': {
			const seconds = Number.parseInt(fieldValues[key] ?? '0', 10);
			return Number.isFinite(seconds) && seconds > 0;
		}
		case 'totalDuration':
		case 'totalEstimate': {
			if (!isParentTask(fieldValues, allTasks)) return false;
			const seconds = Number.parseInt(fieldValues[key] ?? '0', 10);
			return Number.isFinite(seconds) && seconds > 0;
		}
		default:
			return !!fieldValues[key]?.trim();
	}
}

function isParentTask(
	fieldValues: Record<string, string>,
	allTasks: IndexedTask[],
): boolean {
	const operonId = fieldValues['operonId']?.trim();
	if (!operonId) return false;
	return allTasks.some(task => task.fieldValues['parentTask']?.trim() === operonId);
}

function formatDuration(totalSeconds: number): string {
	const roundedSeconds = Math.max(0, Math.round(totalSeconds));
	const hours = Math.floor(roundedSeconds / 3600);
	const minutes = Math.floor((roundedSeconds % 3600) / 60);
	if (hours > 0 && minutes > 0) return `${hours}h ${minutes}m`;
	if (hours > 0) return `${hours}h`;
	return `${Math.max(1, minutes)}m`;
}

function formatCompactDatetimeTime(value: string, settings: Pick<OperonSettings, 'timeFormat'>): string {
	const match = /(?:^|T)(\d{1,2}):(\d{2})(?::\d{2})?$/.exec(value.trim());
	if (!match) return value;
	const hour = Number.parseInt(match[1], 10);
	const minute = match[2];
	if (!Number.isFinite(hour) || hour < 0 || hour > 24) return value;
	if (settings.timeFormat !== '12h') {
		return `${String(hour).padStart(2, '0')}:${minute}`;
	}
	const normalizedHour = hour % 24;
	const displayHour = normalizedHour % 12 || 12;
	const suffix = normalizedHour >= 12 ? 'PM' : 'AM';
	return `${displayHour}:${minute} ${suffix}`;
}

function extractWikiLinkTarget(rawValue: string): string | null {
	const trimmed = rawValue.trim();
	const match = trimmed.match(/^\[\[([^\]|]+)(?:\|([^\]]+))?\]\]$/);
	return match?.[1]?.trim() || null;
}

function truncateCompactLabel(value: string, maxLength = 37): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}

function getDateIconTone(
	key: InlineTaskCompactChipKey,
	value: string,
	fieldValues: Record<string, string>,
): InlineTaskCompactChipEntry['iconTone'] {
	if (key !== 'dateScheduled' && key !== 'dateDue') return 'default';
	if (hasTerminalDate(fieldValues)) return 'default';
	if (!isValidDateKey(value)) return 'default';

	const today = localToday();
	if (value < today) return 'overdue';
	if (value === today) return 'today';
	return 'default';
}

function isValidDateKey(value: string): boolean {
	return /^\d{4}-\d{2}-\d{2}$/.test(value);
}

function localToday(): string {
	const now = new Date();
	const year = now.getFullYear();
	const month = `${now.getMonth() + 1}`.padStart(2, '0');
	const day = `${now.getDate()}`.padStart(2, '0');
	return `${year}-${month}-${day}`;
}
