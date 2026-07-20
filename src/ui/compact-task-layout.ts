import { type App, setIcon } from 'obsidian';
import { createOwnerElement } from '../core/dom-compat';
import { getConfiguredKeyMappingIcon } from '../core/key-mapping-icons';
import { calculateNextRepeatDate, parseRepeatRule, type RepeatRule } from '../core/repeat-rule';
import { formatRepeatRuleSummaryI18n } from '../core/repeat-rule-i18n';
import { splitTaskListValue } from '../core/task-field-patch';
import type { ReminderPickerFieldKey } from '../core/reminder-list-mutation';
import { OperonSettings, InlineTaskCompactChipItem, InlineTaskCompactChipKey, INLINE_TASK_COMPACT_CHIP_ORDER, INLINE_TASK_COMPACT_FALLBACK_ICONS, KeyMapping } from '../types/settings';
import { isInternalCanonicalKey, isReminderStorageKey } from '../types/keys';
import { IndexedTask } from '../types/fields';
import { formatAssigneeDisplay } from './field-pickers/assignees-picker';
import { formatContextDisplay } from './field-pickers/contexts-picker';
import { parseExternalLinkValue } from './field-pickers/links-utils';
import { normalizeTagValue } from './field-pickers/tag-picker';
import { t } from '../core/i18n';
import { formatShortLocationCoordinate, parseLocationCoordinate } from '../core/location-coordinates';
import { normalizeTaskFieldColor } from '../core/task-color-source';
import { normalizeTaskIconValue } from '../core/task-icon-value';
import { resolveTaskDateTone } from '../core/task-date-tone';
import {
	resolveConfiguredStatusIdentity,
	type WorkflowStatusIdentityIndex,
} from '../core/workflow-status-identity';
import {
	getCustomFieldIcon,
	getCustomFieldLabel,
	getCustomFieldMapping,
	isProjectedCustomFieldType,
	normalizeCustomFieldRawValue,
} from './custom-field-surfaces';
import { formatReminderDisplayItem, type ReminderDisplayState } from './reminder-display';

export type CompactVisibleChipKey = string;

export interface LocationChipMatch {
	label: string;
	path: string;
	taskIcon?: string | null;
	taskColor?: string | null;
}

export type LocationChipResolver = (coordinateText: string) => LocationChipMatch | null;
export type RepeatSkipDateResolver = (repeatSeriesId: string) => string[];

export interface CompactTaskLookupContext {
	taskById: ReadonlyMap<string, IndexedTask>;
	parentTaskIds: ReadonlySet<string>;
}

export interface CompactChipEntryBuildOptions {
	app?: App | null;
	nowEpochMs?: number;
	repeatSkipDateResolver?: RepeatSkipDateResolver;
	taskLookup?: CompactTaskLookupContext;
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex;
}

export const COMPACT_VISIBLE_CHIP_KEYS = [
	'priority',
	'status',
	'dateScheduled',
	'dateDue',
	'dateCompleted',
	'dateCancelled',
	'datetimeStart',
	'datetimeEnd',
	'repeat',
	'reminderDatetimes',
	'reminderRules',
	'totalDuration',
	'totalEstimate',
	'links',
	'location',
] as const;

const COMPACT_INTERNAL_VISIBLE_KEYS = ['operonId', 'datetimeModified', 'taskColor', 'taskIcon'] as const;

export interface InlineTaskCompactChipEntry {
	key: string;
	label: string;
	icon: string;
	iconOnly: boolean;
	interactive: boolean;
	colorRole: 'default' | 'priority' | 'status';
	iconTone?: 'default' | 'today' | 'overdue';
	linkTarget: string | null;
	previewLinkTarget?: string | null;
	externalUrl?: string | null;
	externalRawValue?: string | null;
	locationCoordinate?: string | null;
	locationMarkerIcon?: string | null;
	locationMarkerColor?: string | null;
	taskColor?: string | null;
	tooltipTitle?: string;
	tooltipContent?: string;
	ariaLabel?: string;
	reminderItem?: CompactReminderItemRef;
	reminderState?: ReminderDisplayState;
}

export interface CompactReminderItemRef {
	fieldKey: ReminderPickerFieldKey;
	index: number;
	rawValue: string;
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
): string[] {
	return getCompactChipItems(settings, chipItems)
		.filter(item => item.visible)
		.map(item => item.key)
		.filter(key => isRenderableCompactSurfaceKey(settings, key));
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

export function createCompactTaskLookup(allTasks: IndexedTask[] = []): CompactTaskLookupContext {
	const taskById = new Map<string, IndexedTask>();
	const parentTaskIds = new Set<string>();
	for (const task of allTasks) {
		taskById.set(task.operonId, task);
		const parentTaskId = task.fieldValues['parentTask']?.trim();
		if (parentTaskId) parentTaskIds.add(parentTaskId);
	}
	return { taskById, parentTaskIds };
}

export function buildInlineTaskCompactChipEntries(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
	locationResolver?: LocationChipResolver,
	options?: CompactChipEntryBuildOptions,
): InlineTaskCompactChipEntry[] {
	const entries: InlineTaskCompactChipEntry[] = [];
	const taskColor = normalizeTaskFieldColor(fieldValues['taskColor']);
	const itemMap = new Map(getCompactChipItems(settings, chipItems).map(item => [item.key, item]));
	const taskLookup = options?.taskLookup ?? createCompactTaskLookup(allTasks);
	const taskById = taskLookup.taskById;
	for (const key of getInlineTaskCompactVisibleChipKeys(settings, chipItems)) {
		const item = itemMap.get(key);
		const customMapping = getCustomFieldMapping(settings.keyMappings, key);
		if (customMapping && isProjectedCustomFieldType(customMapping)) {
			pushCustomChipEntries(entries, customMapping, fieldValues, settings, item?.iconOnly === true);
			continue;
		}
		if (!isBuiltInCompactChipKey(key)) continue;
		if (isSuppressedByTerminalDate(key, fieldValues, options?.workflowStatusIdentityIndex)) continue;
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
				entry.iconTone = resolveTaskDateTone(key, value, fieldValues);
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
			case 'repeat': {
				const rawValue = fieldValues['repeat']?.trim();
				if (!rawValue) break;
				const rule = parseRepeatRule(rawValue);
				const entry = createEntry(
					settings,
					key,
					rule ? formatRepeatRuleSummaryI18n(rule) : rawValue,
					item?.iconOnly === true,
				);
				entry.tooltipTitle = rule
					? t('taskEditor', 'repeatChipNextOccurrenceTitle')
					: t('taskEditor', 'repeatChipRuleTitle');
				entry.tooltipContent = rule
					? buildRepeatChipTooltipContent(rule, fieldValues, options?.repeatSkipDateResolver)
					: [
						rawValue,
						t('taskEditor', 'repeatChipUnsupportedByPicker'),
					].join('\n');
				entries.push(entry);
				break;
			}
			case 'reminderDatetimes':
			case 'reminderRules': {
				for (const [index, rawValue] of splitTaskListValue(fieldValues[key]).entries()) {
					const display = formatReminderDisplayItem({
						app: options?.app,
						settings,
						fieldKey: key,
						rawValue,
						fieldValues,
						nowEpochMs: options?.nowEpochMs,
					});
					const entry = createEntry(settings, key, display.text, item?.iconOnly === true);
					entry.ariaLabel = display.ariaLabel;
					entry.reminderItem = { fieldKey: key, index, rawValue };
					entry.reminderState = display.state;
					entry.tooltipTitle = display.tooltipTitle;
					entry.tooltipContent = display.tooltipContent;
					entries.push(entry);
				}
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
				if (!isParentTask(fieldValues, allTasks, taskLookup)) break;
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
				if (!isParentTask(fieldValues, allTasks, taskLookup)) break;
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

function buildRepeatChipTooltipContent(
	rule: RepeatRule,
	fieldValues: Record<string, string>,
	repeatSkipDateResolver?: RepeatSkipDateResolver,
): string | undefined {
	const lines: string[] = [];
	const repeatEnd = extractDatePart(fieldValues['datetimeRepeatEnd']);

	if (rule.mode === 'done') {
		lines.push(t('taskEditor', 'repeatChipNextWhenDone'));
	} else if (rule.mode === 'count' && (rule.count ?? 0) <= 1) {
		lines.push(t('taskEditor', 'repeatChipNoNextOccurrence'));
	} else {
		const anchorDate = resolveRepeatChipAnchorDate(fieldValues);
		if (anchorDate) {
			const nextDate = calculateNextRepeatDate(rule, {
				anchorDate,
				repeatEnd: fieldValues['datetimeRepeatEnd'],
				skipDates: resolveRepeatSkipDates(fieldValues, repeatSkipDateResolver),
			});
			lines.push(nextDate
				? t('taskEditor', 'repeatChipNextOccurrence', { date: nextDate })
				: t('taskEditor', 'repeatChipNoNextOccurrence'));
		}
	}

	if (repeatEnd) {
		lines.push(t('taskEditor', 'repeatChipEndsOn', { date: repeatEnd }));
	}

	return lines.length > 0 ? lines.join('\n') : undefined;
}

function resolveRepeatChipAnchorDate(fieldValues: Record<string, string>): string {
	return extractDatePart(fieldValues['repeatOccurrenceDate'])
		|| extractDatePart(fieldValues['dateScheduled'])
		|| extractDatePart(fieldValues['dateDue'])
		|| extractDatePart(fieldValues['dateStarted'])
		|| extractDatePart(fieldValues['datetimeStart'])
		|| extractDatePart(fieldValues['datetimeEnd']);
}

function resolveRepeatSkipDates(
	fieldValues: Record<string, string>,
	repeatSkipDateResolver?: RepeatSkipDateResolver,
): string[] {
	const repeatSeriesId = fieldValues['repeatSeriesId']?.trim();
	if (!repeatSeriesId || !repeatSkipDateResolver) return [];
	return repeatSkipDateResolver(repeatSeriesId)
		.map(extractDatePart)
		.filter(Boolean);
}

function isBuiltInCompactChipKey(key: string): key is InlineTaskCompactChipKey {
	return (INLINE_TASK_COMPACT_CHIP_ORDER as readonly string[]).includes(key);
}

function isRenderableCompactSurfaceKey(settings: OperonSettings, key: string): boolean {
	if (isBuiltInCompactChipKey(key)) return true;
	const mapping = getCustomFieldMapping(settings.keyMappings, key);
	return !!mapping && isProjectedCustomFieldType(mapping);
}

function pushCustomChipEntries(
	entries: InlineTaskCompactChipEntry[],
	mapping: KeyMapping,
	fieldValues: Record<string, string>,
	settings: Pick<OperonSettings, 'timeFormat'>,
	iconOnly: boolean,
): void {
	const rawValue = normalizeCustomFieldRawValue((fieldValues as Record<string, unknown>)[mapping.canonicalKey]);
	if (!rawValue) return;
	if (mapping.type === 'list') {
		for (const value of splitTaskListValue(rawValue)) {
			const wikiLink = parseCompactWikiLinkValue(value);
			const displayValue = wikiLink?.displayValue ?? value;
			const label = truncateCompactLabel(displayValue);
			const entry = createCustomEntry(mapping, label, iconOnly, wikiLink?.linkTarget ?? null);
			if (label !== displayValue) {
				entry.tooltipTitle = getCustomFieldLabel(mapping);
				entry.tooltipContent = displayValue;
			}
			entries.push(entry);
		}
		return;
	}
	const wikiLink = mapping.type === 'text' ? parseCompactWikiLinkValue(rawValue) : null;
	const displayValue = mapping.type === 'datetime'
		? formatCompactDatetimeTime(rawValue, settings)
		: wikiLink?.displayValue ?? rawValue;
	const label = truncateCompactLabel(displayValue);
	const entry = createCustomEntry(mapping, label, iconOnly, null, wikiLink?.linkTarget ?? null);
	if (label !== displayValue) {
		entry.tooltipTitle = getCustomFieldLabel(mapping);
		entry.tooltipContent = displayValue;
	}
	entries.push(entry);
}

export function getInlineTaskCompactHiddenCount(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
	options?: CompactChipEntryBuildOptions,
): number {
	return getInlineTaskCompactHiddenKeys(fieldValues, tags, settings, allTasks, chipItems, options).length;
}

export function getInlineTaskCompactHiddenKeys(
	fieldValues: Record<string, string>,
	tags: string[],
	settings: OperonSettings,
	allTasks: IndexedTask[] = [],
	chipItems?: InlineTaskCompactChipItem[],
	options?: CompactChipEntryBuildOptions,
): string[] {
	return collectHiddenKeys(
		fieldValues,
		tags,
		getInlineTaskCompactVisibleKeys(settings, chipItems),
		allTasks,
		options?.taskLookup,
		options?.workflowStatusIdentityIndex,
		settings.keyMappings,
	);
}

export function collectHiddenKeys(
	fieldValues: Record<string, string>,
	tags: string[],
	visibleKeys: Iterable<string>,
	allTasks: IndexedTask[] = [],
	taskLookup?: CompactTaskLookupContext,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
	keyMappings?: readonly KeyMapping[],
): string[] {
	const visible = new Set(visibleKeys);
	const hidden = new Set<string>();

	for (const key of INLINE_TASK_COMPACT_CHIP_ORDER) {
		if (isSuppressedByTerminalDate(key, fieldValues, workflowStatusIdentityIndex)) continue;
		if (visible.has(key)) continue;
		if (isSystemReminderCompactKey(key, keyMappings)) continue;
		if (hasCompactValue(key, fieldValues, tags, allTasks, taskLookup)) {
			hidden.add(key);
		}
	}

	for (const [key, rawValue] of Object.entries(fieldValues)) {
		if (!rawValue?.trim()) continue;
		if (visible.has(key)) continue;
		if (isInternalCanonicalKey(key)) continue;
		if (isSystemReminderCompactKey(key, keyMappings)) continue;
		if (
			isBuiltInCompactChipKey(key)
			&& isSuppressedByTerminalDate(key, fieldValues, workflowStatusIdentityIndex)
		) continue;
		hidden.add(key);
	}

	return Array.from(hidden);
}

function isSystemReminderCompactKey(key: string, keyMappings?: readonly KeyMapping[]): boolean {
	if (!isReminderStorageKey(key)) return false;
	const mapping = keyMappings?.find(candidate => candidate.canonicalKey === key);
	return !mapping || mapping.isSystem !== false;
}

function hasTerminalDate(fieldValues: Record<string, string>): boolean {
	return !!fieldValues['dateCompleted']?.trim() || !!fieldValues['dateCancelled']?.trim();
}

function isSuppressedByTerminalDate(
	key: InlineTaskCompactChipKey,
	fieldValues: Record<string, string>,
	workflowStatusIdentityIndex?: WorkflowStatusIdentityIndex,
): boolean {
	if (!hasTerminalDate(fieldValues)) return false;
	if (workflowStatusIdentityIndex) {
		const statusIdentity = resolveConfiguredStatusIdentity(
			fieldValues['status'],
			workflowStatusIdentityIndex,
		);
		if (
			statusIdentity.kind === 'configured'
			&& !statusIdentity.status.isFinished
			&& !statusIdentity.status.isCancelled
		) {
			return false;
		}
	}
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
	const tagName = entry.interactive && (!iconOnly || entry.reminderItem) ? 'button' : 'span';
	const chip = createOwnerElement(options?.owner, tagName);
	if (entry.interactive && tagName === 'button') {
		(chip as HTMLButtonElement).type = 'button';
	}
	chip.className = [
		'operon-chip',
		'operon-live-preview-chip',
		'operon-inline-compact-chip',
		entry.linkTarget || entry.previewLinkTarget || entry.externalUrl ? 'is-linked' : '',
		entry.locationCoordinate ? 'is-location' : '',
		entry.reminderItem ? 'is-reminder' : '',
		entry.reminderState ? `is-${entry.reminderState}` : '',
		iconOnly ? 'is-icon-only' : '',
		entry.key === 'priority' ? 'operon-chip-priority' : 'operon-chip-date',
		entry.interactive ? 'operon-chip-clickable' : 'operon-chip-readonly',
		extraClasses,
	].filter(Boolean).join(' ');
	const ariaLabel = entry.reminderItem && !entry.interactive
		? [entry.label, entry.tooltipContent].filter(Boolean).join('. ')
		: entry.ariaLabel;
	if (ariaLabel) chip.setAttribute('aria-label', ariaLabel);

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
		previewLinkTarget: linkTarget,
		externalUrl,
		externalRawValue,
	};
}

function createCustomEntry(
	mapping: KeyMapping,
	label: string,
	iconOnly = false,
	linkTarget: string | null = null,
	previewLinkTarget: string | null = linkTarget,
): InlineTaskCompactChipEntry {
	return {
		key: mapping.canonicalKey,
		label,
		icon: getCustomFieldIcon(mapping),
		iconOnly,
		interactive: true,
		colorRole: 'default',
		linkTarget,
		previewLinkTarget,
		tooltipTitle: getCustomFieldLabel(mapping),
	};
}

function hasCompactValue(
	key: InlineTaskCompactChipKey,
	fieldValues: Record<string, string>,
	tags: string[],
	allTasks: IndexedTask[] = [],
	taskLookup?: CompactTaskLookupContext,
): boolean {
	switch (key) {
		case 'assignees':
		case 'contexts':
		case 'reminderDatetimes':
		case 'reminderRules':
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
			if (!isParentTask(fieldValues, allTasks, taskLookup)) return false;
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
	taskLookup?: CompactTaskLookupContext,
): boolean {
	const operonId = fieldValues['operonId']?.trim();
	if (!operonId) return false;
	if (taskLookup) return taskLookup.parentTaskIds.has(operonId);
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

function extractDatePart(value: string | null | undefined): string {
	if (!value) return '';
	const trimmed = value.trim();
	if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
	if (/^\d{4}-\d{2}-\d{2}T/.test(trimmed)) return trimmed.slice(0, 10);
	return '';
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

interface CompactWikiLinkValue {
	linkTarget: string;
	displayValue: string;
}

function parseCompactWikiLinkValue(rawValue: string): CompactWikiLinkValue | null {
	const trimmed = rawValue.trim();
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!match) return null;
	const body = match[1]?.trim() ?? '';
	if (!body) return null;
	const pipeIndex = body.indexOf('|');
	if (pipeIndex < 0) {
		return {
			linkTarget: body,
			displayValue: formatCompactWikiLinkTargetLabel(body) || trimmed,
		};
	}
	const linkTarget = body.slice(0, pipeIndex).trim();
	if (!linkTarget) return null;
	const alias = body.slice(pipeIndex + 1).trim();
	return {
		linkTarget,
		displayValue: alias || formatCompactWikiLinkTargetLabel(linkTarget) || trimmed,
	};
}

function formatCompactWikiLinkTargetLabel(linkTarget: string): string {
	const lastSegment = linkTarget.split('/').pop()?.trim() ?? linkTarget.trim();
	return lastSegment.replace(/\.md$/i, '');
}

function truncateCompactLabel(value: string, maxLength = 37): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, Math.max(0, maxLength - 3)).trimEnd()}...`;
}
