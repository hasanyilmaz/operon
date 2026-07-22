import type { IndexedTask } from '../types/fields';
import { resolveTaskDisplayIcon, type OperonSettings } from '../types/settings';
import { normalizeTaskFieldColor } from './task-color-source';
import { parseAbsoluteReminder } from './reminder-rules';
import {
	buildReminderOccurrences,
	type ReminderOccurrenceFieldKey,
} from './reminder-scheduler-model';

export const MOBILE_NOTIFICATIONS_SCHEMA_VERSION = 1;
export const MOBILE_NOTIFICATIONS_HORIZON_DAYS = 7;
const DAY_MS = 24 * 60 * 60 * 1_000;
const MINIMUM_CATCH_UP_MS = 60_000;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;

export interface MobileNotificationsSnapshot {
	schemaVersion: typeof MOBILE_NOTIFICATIONS_SCHEMA_VERSION;
	enabled: boolean;
	authoritative: true;
	generatedAt: string;
	generatedAtEpochMs: number;
	vault: { id: string; name: string };
	timezone: string;
	window: {
		start: string;
		startEpochMs: number;
		end: string;
		endEpochMs: number;
		horizonDays: typeof MOBILE_NOTIFICATIONS_HORIZON_DAYS;
		catchUpMinutes: number;
	};
	sourcePolicy: {
		reminderDatetimes: boolean;
		reminderRules: boolean;
		datetimeStart: false;
	};
	tasks: MobileNotificationsSnapshotTask[];
}

export interface MobileNotificationsSnapshotTask {
	operonId: string;
	description: string;
	taskStart: {
		localDatetime: string;
		epochMs: number;
		timezone: string;
	} | null;
	appearance: {
		taskIcon: string;
		taskColor: string | null;
	};
	source: { filePath: string };
	notifications: Array<{
		occurrenceId: string;
		triggerAt: string;
		triggerAtEpochMs: number;
		sources: Array<{ kind: 'reminderDatetime' | 'reminderRule' }>;
	}>;
}

type AppearanceSettings = Pick<
	OperonSettings,
	'fallbackStateIcons' | 'fallbackTaskIconSource' | 'pipelines' | 'priorities'
>;

export interface BuildMobileNotificationsSnapshotOptions {
	tasks: readonly IndexedTask[];
	generatedAtEpochMs: number;
	vaultId: string;
	vaultName: string;
	timezone: string;
	catchUpMinutes: number;
	appearanceSettings: AppearanceSettings;
	isDuplicateOperonId: (operonId: string) => boolean;
	isSystemReminderFieldEnabled?: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
	enabled?: boolean;
}

export interface MobileNotificationsTaskCandidate extends Omit<MobileNotificationsSnapshotTask, 'notifications'> {
	notifications: MobileNotificationsSnapshotTask['notifications'];
}

export function buildMobileNotificationsSnapshot(
	options: BuildMobileNotificationsSnapshotOptions,
): MobileNotificationsSnapshot {
	assertIanaTimezone(options.timezone);
	const candidates = options.tasks.flatMap(task => buildMobileNotificationsTaskCandidate({
		task,
		vaultTimezone: options.timezone,
		appearanceSettings: options.appearanceSettings,
		isDuplicateOperonId: options.isDuplicateOperonId,
		isSystemReminderFieldEnabled: options.isSystemReminderFieldEnabled,
	}));
	return buildMobileNotificationsSnapshotFromCandidates(options, candidates);
}

export function buildMobileNotificationsSnapshotFromCandidates(
	options: Omit<BuildMobileNotificationsSnapshotOptions, 'tasks' | 'isDuplicateOperonId'>,
	candidates: readonly MobileNotificationsTaskCandidate[],
): MobileNotificationsSnapshot {
	const generatedAtEpochMs = normalizeEpoch(options.generatedAtEpochMs, 'generatedAtEpochMs');
	const catchUpMinutes = Math.min(1_440, Math.max(0, Math.floor(options.catchUpMinutes)));
	const enabled = options.enabled !== false;
	const startEpochMs = generatedAtEpochMs - Math.max(MINIMUM_CATCH_UP_MS, catchUpMinutes * 60_000);
	const endEpochMs = generatedAtEpochMs + MOBILE_NOTIFICATIONS_HORIZON_DAYS * DAY_MS;
	const isSystemFieldEnabled = options.isSystemReminderFieldEnabled ?? (() => true);
	const sourcePolicy = enabled ? {
		reminderDatetimes: isSystemFieldEnabled('reminderDatetimes'),
		reminderRules: isSystemFieldEnabled('reminderRules'),
		datetimeStart: false as const,
	} : {
		reminderDatetimes: false,
		reminderRules: false,
		datetimeStart: false as const,
	};

	const tasks = enabled ? candidates.flatMap(candidate => {
		const notifications = candidate.notifications.filter(notification => (
			notification.triggerAtEpochMs >= startEpochMs && notification.triggerAtEpochMs < endEpochMs
		));
		return notifications.length > 0 ? [{ ...candidate, notifications }] : [];
	}) : [];
	tasks.sort((left, right) => {
		const epochDelta = left.notifications[0].triggerAtEpochMs - right.notifications[0].triggerAtEpochMs;
		return epochDelta || left.operonId.localeCompare(right.operonId);
	});

	const snapshot: MobileNotificationsSnapshot = {
		schemaVersion: MOBILE_NOTIFICATIONS_SCHEMA_VERSION,
		enabled,
		authoritative: true,
		generatedAt: formatUtcInstant(generatedAtEpochMs),
		generatedAtEpochMs,
		vault: {
			id: options.vaultId.trim().toLowerCase(),
			name: options.vaultName.trim(),
		},
		timezone: options.timezone,
		window: {
			start: formatUtcInstant(startEpochMs),
			startEpochMs,
			end: formatUtcInstant(endEpochMs),
			endEpochMs,
			horizonDays: MOBILE_NOTIFICATIONS_HORIZON_DAYS,
			catchUpMinutes,
		},
		sourcePolicy,
		tasks,
	};
	validateMobileNotificationsSnapshot(snapshot);
	return snapshot;
}

export interface BuildMobileNotificationsTaskCandidateOptions {
	task: IndexedTask;
	vaultTimezone: string;
	appearanceSettings: AppearanceSettings;
	isDuplicateOperonId: (operonId: string) => boolean;
	isSystemReminderFieldEnabled?: (fieldKey: ReminderOccurrenceFieldKey) => boolean;
}

export function buildMobileNotificationsTaskCandidate(
	options: BuildMobileNotificationsTaskCandidateOptions,
): MobileNotificationsTaskCandidate[] {
	const { task } = options;
	const isSystemFieldEnabled = options.isSystemReminderFieldEnabled ?? (() => true);
	const description = task.description.trim();
	if (task.checkbox !== 'open' || options.isDuplicateOperonId(task.operonId)) return [];

	const notifications = buildReminderOccurrences(task, isSystemFieldEnabled)
		.filter(occurrence => occurrence.epochMs >= 0)
		.map(occurrence => ({
			occurrenceId: occurrence.key,
			triggerAt: formatOffsetInstant(occurrence.epochMs, options.vaultTimezone),
			triggerAtEpochMs: occurrence.epochMs,
			sources: buildNotificationSources(occurrence.sources.map(source => source.fieldKey)),
		}));
	if (notifications.length === 0) return [];
	if (!description) throw new Error('Operon: mobile notification task description is empty');
	if (!isSafeVaultMarkdownPath(task.primary.filePath)) {
		throw new Error('Operon: unsafe mobile notification source path');
	}

	const parsedStart = parseAbsoluteReminder(task.fieldValues.datetimeStart ?? '');
	return [{
		operonId: task.operonId,
		description,
		taskStart: parsedStart.ok ? {
			localDatetime: parsedStart.value.localDatetime,
			epochMs: parsedStart.value.epochMs,
			timezone: options.vaultTimezone,
		} : null,
		appearance: {
			taskIcon: resolveTaskDisplayIcon(options.appearanceSettings, task.fieldValues, task.checkbox),
			taskColor: normalizeTaskFieldColor(task.fieldValues.taskColor),
		},
		source: { filePath: task.primary.filePath },
		notifications,
	}];
}

function buildNotificationSources(
	fieldKeys: readonly ReminderOccurrenceFieldKey[],
): Array<{ kind: 'reminderDatetime' | 'reminderRule' }> {
	const present = new Set(fieldKeys);
	return [
		...(present.has('reminderDatetimes') ? [{ kind: 'reminderDatetime' as const }] : []),
		...(present.has('reminderRules') ? [{ kind: 'reminderRule' as const }] : []),
	];
}

export function resolveMobileNotificationsTimezone(): string {
	const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone;
	if (!timezone?.trim()) throw new Error('Operon: runtime did not expose an IANA timezone');
	assertIanaTimezone(timezone);
	return timezone;
}

export function formatOffsetInstant(epochMs: number, timezone: string): string {
	const date = new Date(normalizeEpoch(epochMs, 'epochMs'));
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
		timeZoneName: 'longOffset',
	}).formatToParts(date);
	const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
	const zoneName = value('timeZoneName');
	const offset = zoneName === 'GMT' || zoneName === 'UTC'
		? 'Z'
		: zoneName.match(/^GMT([+-]\d{2}:\d{2})$/u)?.[1];
	if (!offset) throw new Error(`Operon: could not resolve UTC offset for timezone ${timezone}`);
	return `${value('year')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}${offset}`;
}

export function isSafeVaultMarkdownPath(path: string): boolean {
	if (!path.endsWith('.md') || path.startsWith('/') || path.includes('\\') || path.includes('//')) return false;
	if (/^[A-Za-z]:[\\/]/u.test(path)
		|| /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(path)
		|| /^file:/iu.test(path)) return false;
	return path.split('/').every(segment => !!segment && segment !== '.' && segment !== '..');
}

export function validateMobileNotificationsSnapshot(snapshot: MobileNotificationsSnapshot): void {
	if (snapshot.schemaVersion !== 1 || snapshot.authoritative !== true) throw new Error('Operon: invalid mobile notification contract header');
	if (!UUID_V4_PATTERN.test(snapshot.vault.id)) throw new Error('Operon: invalid mobile notification vault id');
	if (!snapshot.vault.name.trim()) throw new Error('Operon: mobile notification vault name is empty');
	assertIanaTimezone(snapshot.timezone);
	if (snapshot.generatedAt !== formatUtcInstant(snapshot.generatedAtEpochMs)) throw new Error('Operon: generated timestamp mirror mismatch');
	if (snapshot.window.start !== formatUtcInstant(snapshot.window.startEpochMs)
		|| snapshot.window.end !== formatUtcInstant(snapshot.window.endEpochMs)
		|| snapshot.window.startEpochMs !== snapshot.generatedAtEpochMs - Math.max(MINIMUM_CATCH_UP_MS, snapshot.window.catchUpMinutes * 60_000)
		|| snapshot.window.endEpochMs !== snapshot.generatedAtEpochMs + MOBILE_NOTIFICATIONS_HORIZON_DAYS * DAY_MS) {
		throw new Error('Operon: mobile notification window mismatch');
	}
	if (snapshot.window.horizonDays !== MOBILE_NOTIFICATIONS_HORIZON_DAYS
		|| !Number.isInteger(snapshot.window.catchUpMinutes)
		|| snapshot.window.catchUpMinutes < 0
		|| snapshot.window.catchUpMinutes > 1_440) throw new Error('Operon: invalid mobile notification window policy');
	if (!snapshot.enabled && (snapshot.tasks.length > 0
		|| snapshot.sourcePolicy.reminderDatetimes
		|| snapshot.sourcePolicy.reminderRules
		|| snapshot.sourcePolicy.datetimeStart)) {
		throw new Error('Operon: invalid disabled mobile notification snapshot');
	}
	let previousTask: [number, string] | null = null;
	const occurrenceIds = new Set<string>();
	const taskIds = new Set<string>();
	for (const task of snapshot.tasks) {
		if (!task.operonId.trim() || !task.description.trim() || !task.appearance.taskIcon.trim()) {
			throw new Error('Operon: invalid mobile notification task identity');
		}
		if (taskIds.has(task.operonId)) throw new Error('Operon: duplicate mobile notification task id');
		taskIds.add(task.operonId);
		if (!isSafeVaultMarkdownPath(task.source.filePath)) throw new Error('Operon: unsafe mobile notification source path');
		if (task.appearance.taskColor !== null && !/^#[0-9a-fA-F]{6}$/u.test(task.appearance.taskColor)) {
			throw new Error('Operon: invalid mobile notification task color');
		}
		if (task.taskStart) {
			assertIanaTimezone(task.taskStart.timezone);
			if (!Number.isSafeInteger(task.taskStart.epochMs)
				|| Math.abs(task.taskStart.epochMs) > 8_640_000_000_000_000
				|| formatLocalDatetimeInTimezone(task.taskStart.epochMs, task.taskStart.timezone) !== task.taskStart.localDatetime
				|| task.taskStart.timezone !== snapshot.timezone) {
				throw new Error('Operon: invalid mobile notification task start');
			}
		}
		if (task.notifications.length === 0) throw new Error('Operon: mobile notification task has no occurrences');
		let previousNotification: [number, string] | null = null;
		for (const notification of task.notifications) {
			const order: [number, string] = [notification.triggerAtEpochMs, notification.occurrenceId];
			if (previousNotification && compareOrder(order, previousNotification) < 0) throw new Error('Operon: notifications are not sorted');
			previousNotification = order;
			if (notification.occurrenceId !== `${task.operonId}@${notification.triggerAtEpochMs}`
				|| occurrenceIds.has(notification.occurrenceId)
				|| notification.triggerAt !== formatOffsetInstant(notification.triggerAtEpochMs, snapshot.timezone)
				|| notification.triggerAtEpochMs < snapshot.window.startEpochMs
				|| notification.triggerAtEpochMs >= snapshot.window.endEpochMs) {
				throw new Error('Operon: invalid mobile notification occurrence');
			}
			occurrenceIds.add(notification.occurrenceId);
			const kinds = notification.sources.map(source => source.kind);
			if (kinds.length === 0 || new Set(kinds).size !== kinds.length
				|| kinds.join(',') !== [...kinds].sort((a, b) => sourceOrder(a) - sourceOrder(b)).join(',')) {
				throw new Error('Operon: invalid mobile notification sources');
			}
			if ((kinds.includes('reminderDatetime') && !snapshot.sourcePolicy.reminderDatetimes)
				|| (kinds.includes('reminderRule') && !snapshot.sourcePolicy.reminderRules)) {
				throw new Error('Operon: mobile notification source policy mismatch');
			}
		}
		const taskOrder: [number, string] = [task.notifications[0].triggerAtEpochMs, task.operonId];
		if (previousTask && compareOrder(taskOrder, previousTask) < 0) throw new Error('Operon: mobile notification tasks are not sorted');
		previousTask = taskOrder;
	}
}

export interface ExistingMobileNotificationsProducerState {
	vaultId: string;
	lastGeneratedAtEpochMs: number;
}

export function parseExistingMobileNotificationsProducerState(
	raw: string,
): ExistingMobileNotificationsProducerState | null {
	try {
		const value = JSON.parse(raw) as MobileNotificationsSnapshot;
		validateMobileNotificationsSnapshot(value);
		return {
			vaultId: value.vault.id,
			lastGeneratedAtEpochMs: value.generatedAtEpochMs,
		};
	} catch {
		return null;
	}
}

export function parseExistingMobileNotificationsVaultId(raw: string): string | null {
	return parseExistingMobileNotificationsProducerState(raw)?.vaultId ?? null;
}

function sourceOrder(kind: 'reminderDatetime' | 'reminderRule'): number {
	return kind === 'reminderDatetime' ? 0 : 1;
}

function compareOrder(left: [number, string], right: [number, string]): number {
	return left[0] - right[0] || left[1].localeCompare(right[1]);
}

function assertIanaTimezone(timezone: string): void {
	if (!timezone.trim()) throw new Error('Operon: mobile notification timezone is empty');
	try {
		new Intl.DateTimeFormat('en', { timeZone: timezone }).format(0);
	} catch {
		throw new Error(`Operon: invalid mobile notification timezone ${timezone}`);
	}
}

function formatLocalDatetimeInTimezone(epochMs: number, timezone: string): string {
	const parts = new Intl.DateTimeFormat('en-CA', {
		timeZone: timezone,
		year: 'numeric', month: '2-digit', day: '2-digit',
		hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
	}).formatToParts(new Date(epochMs));
	const value = (type: Intl.DateTimeFormatPartTypes): string => parts.find(part => part.type === type)?.value ?? '';
	return `${value('year').padStart(4, '0')}-${value('month')}-${value('day')}T${value('hour')}:${value('minute')}:${value('second')}`;
}

function formatUtcInstant(epochMs: number): string {
	return new Date(normalizeEpoch(epochMs, 'epochMs')).toISOString();
}

function normalizeEpoch(value: number, label: string): number {
	if (!Number.isSafeInteger(value) || value < 0 || value > 8_640_000_000_000_000) {
		throw new Error(`Operon: invalid mobile notification ${label}`);
	}
	return value;
}
