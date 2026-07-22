import { createHash } from 'node:crypto';

const ROOT_KEYS = [
	'schemaVersion',
	'enabled',
	'authoritative',
	'generatedAt',
	'generatedAtEpochMs',
	'vault',
	'timezone',
	'window',
	'sourcePolicy',
	'tasks',
];
const UTC_INSTANT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$/u;
const OFFSET_INSTANT_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:Z|[+-][0-9]{2}:[0-9]{2})$/u;
const LOCAL_DATETIME_PATTERN = /^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}$/u;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u;
const COLOR_PATTERN = /^#[0-9A-Fa-f]{6}$/u;
const SOURCE_ORDER = new Map([
	['reminderDatetime', 0],
	['reminderRule', 1],
]);
const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;
const ON_TIME_TOLERANCE_MS = 60_000;
const MAX_DATE_EPOCH_MS = 8_640_000_000_000_000;
export const MAX_FUTURE_SKEW_MS = 5 * 60_000;

export class MobileNotificationsContractError extends Error {
	constructor(code, path, message) {
		super(`${code} at ${path}: ${message}`);
		this.name = 'MobileNotificationsContractError';
		this.code = code;
		this.path = path;
	}
}

function fail(code, path, message) {
	throw new MobileNotificationsContractError(code, path, message);
}

function isPlainObject(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function expectObject(value, path) {
	if (!isPlainObject(value)) fail('INVALID_SHAPE', path, 'expected an object');
}

function expectExactKeys(value, expectedKeys, path) {
	expectObject(value, path);
	const actualKeys = Object.keys(value).sort();
	const normalizedExpected = [...expectedKeys].sort();
	if (actualKeys.length !== normalizedExpected.length
		|| actualKeys.some((key, index) => key !== normalizedExpected[index])) {
		fail('INVALID_SHAPE', path, `expected keys ${normalizedExpected.join(', ')}`);
	}
}

function expectBoolean(value, path) {
	if (typeof value !== 'boolean') fail('INVALID_SHAPE', path, 'expected a boolean');
}

function expectNonBlankString(value, path) {
	if (typeof value !== 'string' || value.trim().length === 0) {
		fail('INVALID_SHAPE', path, 'expected a non-blank string');
	}
}

function expectEpoch(value, path, allowNegative = false) {
	if (!Number.isSafeInteger(value)
		|| value > MAX_DATE_EPOCH_MS
		|| value < (allowNegative ? -MAX_DATE_EPOCH_MS : 0)) {
		fail('INVALID_EPOCH', path, allowNegative
			? 'expected a signed epoch inside the supported Date range'
			: 'expected a non-negative epoch inside the supported Date range');
	}
}

function expectInstant(value, epochMs, path, pattern) {
	if (typeof value !== 'string' || !pattern.test(value)) {
		fail('INVALID_TIMESTAMP', path, 'invalid timestamp format');
	}
	if (Date.parse(value) !== epochMs) {
		fail('TIMESTAMP_MISMATCH', path, 'timestamp does not match its epoch');
	}
	if (pattern === UTC_INSTANT_PATTERN && new Date(epochMs).toISOString() !== value) {
		fail('INVALID_TIMESTAMP', path, 'timestamp is not a canonical UTC instant');
	}
	if (pattern === OFFSET_INSTANT_PATTERN) {
		const suffix = value.endsWith('Z') ? 'Z' : value.slice(-6);
		let offsetMinutes = 0;
		if (suffix !== 'Z') {
			const sign = suffix[0] === '-' ? -1 : 1;
			const hours = Number(suffix.slice(1, 3));
			const minutes = Number(suffix.slice(4, 6));
			if (hours > 18 || minutes > 59 || (hours === 18 && minutes !== 0)) {
				fail('INVALID_TIMESTAMP', path, 'invalid UTC offset');
			}
			offsetMinutes = sign * (hours * 60 + minutes);
		}
		const expectedLocal = new Date(epochMs + offsetMinutes * 60_000).toISOString().slice(0, 19);
		if (`${expectedLocal}${suffix}` !== value) {
			fail('INVALID_TIMESTAMP', path, 'timestamp is not a canonical offset instant');
		}
	}
}

function expectTimezone(value, path) {
	expectNonBlankString(value, path);
	try {
		new Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
	} catch {
		fail('INVALID_TIMEZONE', path, 'expected an IANA timezone');
	}
}

function formatLocalDatetime(epochMs, timezone) {
	const parts = new Intl.DateTimeFormat('en-US', {
		timeZone: timezone,
		year: 'numeric',
		month: '2-digit',
		day: '2-digit',
		hour: '2-digit',
		minute: '2-digit',
		second: '2-digit',
		hourCycle: 'h23',
	}).formatToParts(new Date(epochMs));
	const byType = Object.fromEntries(parts.map(part => [part.type, part.value]));
	return `${byType.year.padStart(4, '0')}-${byType.month}-${byType.day}T${byType.hour}:${byType.minute}:${byType.second}`;
}

function formatTimezoneOffset(epochMs, timezone) {
	const local = formatLocalDatetime(epochMs, timezone);
	const match = LOCAL_DATETIME_PATTERN.exec(local);
	if (!match) fail('INVALID_TIMEZONE', 'timezone', 'could not resolve timezone offset');
	const [datePart, timePart] = local.split('T');
	const [year, month, day] = datePart.split('-').map(Number);
	const [hour, minute, second] = timePart.split(':').map(Number);
	const localAsUtc = new Date(0);
	localAsUtc.setUTCFullYear(year, month - 1, day);
	localAsUtc.setUTCHours(hour, minute, second, 0);
	const offsetMinutes = Math.round((localAsUtc.getTime() - epochMs) / 60_000);
	if (offsetMinutes === 0) return 'Z';
	const sign = offsetMinutes < 0 ? '-' : '+';
	const absolute = Math.abs(offsetMinutes);
	return `${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function expectVaultPath(value, path) {
	expectNonBlankString(value, path);
	if (!value.endsWith('.md')
		|| value.startsWith('/')
		|| value.includes('\\')
		|| /^[A-Za-z]:[\\/]/u.test(value)
		|| /^[A-Za-z][A-Za-z0-9+.-]*:\/\//u.test(value)
		|| /^file:/iu.test(value)) {
		fail('UNSAFE_PATH', path, 'expected an unencoded vault-relative Markdown path');
	}
	const segments = value.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
		fail('UNSAFE_PATH', path, 'path contains an empty, dot, or parent segment');
	}
}

function validateTaskStart(value, path) {
	if (value === null) return;
	expectExactKeys(value, ['localDatetime', 'epochMs', 'timezone'], path);
	if (typeof value.localDatetime !== 'string' || !LOCAL_DATETIME_PATTERN.test(value.localDatetime)) {
		fail('INVALID_TIMESTAMP', `${path}.localDatetime`, 'invalid local datetime format');
	}
	expectEpoch(value.epochMs, `${path}.epochMs`, true);
	expectTimezone(value.timezone, `${path}.timezone`);
	if (formatLocalDatetime(value.epochMs, value.timezone) !== value.localDatetime) {
		fail('TIMESTAMP_MISMATCH', `${path}.localDatetime`, 'local datetime does not match epoch and timezone');
	}
}

function validateAppearance(value, path) {
	expectExactKeys(value, ['taskColor', 'taskIcon'], path);
	expectNonBlankString(value.taskIcon, `${path}.taskIcon`);
	if (value.taskColor !== null && (typeof value.taskColor !== 'string' || !COLOR_PATTERN.test(value.taskColor))) {
		fail('INVALID_COLOR', `${path}.taskColor`, 'expected null or #RRGGBB');
	}
}

function validateSourcePolicy(value, enabled) {
	expectExactKeys(value, ['datetimeStart', 'reminderDatetimes', 'reminderRules'], 'sourcePolicy');
	expectBoolean(value.reminderDatetimes, 'sourcePolicy.reminderDatetimes');
	expectBoolean(value.reminderRules, 'sourcePolicy.reminderRules');
	if (value.datetimeStart !== false) {
		fail('UNSUPPORTED_SOURCE', 'sourcePolicy.datetimeStart', 'datetimeStart must be false in v1');
	}
	if (!enabled && (value.reminderDatetimes || value.reminderRules)) {
		fail('INVALID_DISABLED_SNAPSHOT', 'sourcePolicy', 'disabled snapshots must disable every source');
	}
}

function validateNotification(value, task, taskIndex, notificationIndex, root, seenOccurrenceIds, seenEpochs) {
	const path = `tasks[${taskIndex}].notifications[${notificationIndex}]`;
	expectExactKeys(value, ['occurrenceId', 'sources', 'triggerAt', 'triggerAtEpochMs'], path);
	expectNonBlankString(value.occurrenceId, `${path}.occurrenceId`);
	expectEpoch(value.triggerAtEpochMs, `${path}.triggerAtEpochMs`);
	expectInstant(value.triggerAt, value.triggerAtEpochMs, `${path}.triggerAt`, OFFSET_INSTANT_PATTERN);
	const expectedTriggerAt = `${formatLocalDatetime(value.triggerAtEpochMs, root.timezone)}${formatTimezoneOffset(value.triggerAtEpochMs, root.timezone)}`;
	if (value.triggerAt !== expectedTriggerAt) {
		fail('TIMESTAMP_MISMATCH', `${path}.triggerAt`, 'trigger does not match epoch and snapshot timezone');
	}
	if (value.occurrenceId !== `${task.operonId}@${value.triggerAtEpochMs}`) {
		fail('OCCURRENCE_ID_MISMATCH', `${path}.occurrenceId`, 'occurrenceId must be operonId@triggerAtEpochMs');
	}
	if (seenOccurrenceIds.has(value.occurrenceId)) {
		fail('DUPLICATE_OCCURRENCE', `${path}.occurrenceId`, 'occurrenceId must be unique within the vault snapshot');
	}
	seenOccurrenceIds.add(value.occurrenceId);
	if (seenEpochs.has(value.triggerAtEpochMs)) {
		fail('DUPLICATE_OCCURRENCE', `${path}.triggerAtEpochMs`, 'a task may have only one occurrence per epoch');
	}
	seenEpochs.add(value.triggerAtEpochMs);
	if (value.triggerAtEpochMs < root.window.startEpochMs || value.triggerAtEpochMs >= root.window.endEpochMs) {
		fail('TRIGGER_OUTSIDE_WINDOW', `${path}.triggerAtEpochMs`, 'trigger must be inside [window start, window end)');
	}
	if (!Array.isArray(value.sources) || value.sources.length === 0) {
		fail('INVALID_SHAPE', `${path}.sources`, 'expected at least one source');
	}
	const seenKinds = new Set();
	let previousOrder = -1;
	for (const [sourceIndex, source] of value.sources.entries()) {
		const sourcePath = `${path}.sources[${sourceIndex}]`;
		expectExactKeys(source, ['kind'], sourcePath);
		if (!SOURCE_ORDER.has(source.kind)) {
			fail('UNSUPPORTED_SOURCE', `${sourcePath}.kind`, 'unsupported v1 notification source');
		}
		if (seenKinds.has(source.kind)) {
			fail('DUPLICATE_SOURCE', sourcePath, 'source kinds must be unique');
		}
		seenKinds.add(source.kind);
		const order = SOURCE_ORDER.get(source.kind);
		if (order < previousOrder) fail('NON_DETERMINISTIC_ORDER', sourcePath, 'sources are not sorted');
		previousOrder = order;
		if (source.kind === 'reminderDatetime' && !root.sourcePolicy.reminderDatetimes) {
			fail('SOURCE_POLICY_MISMATCH', sourcePath, 'reminderDatetimes source is disabled');
		}
		if (source.kind === 'reminderRule' && !root.sourcePolicy.reminderRules) {
			fail('SOURCE_POLICY_MISMATCH', sourcePath, 'reminderRules source is disabled');
		}
	}
}

function validateTask(value, taskIndex, root, seenTaskIds, seenOccurrenceIds) {
	const path = `tasks[${taskIndex}]`;
	expectExactKeys(value, ['appearance', 'description', 'notifications', 'operonId', 'source', 'taskStart'], path);
	expectNonBlankString(value.operonId, `${path}.operonId`);
	if (seenTaskIds.has(value.operonId)) fail('DUPLICATE_TASK', `${path}.operonId`, 'operonId must be unique');
	seenTaskIds.add(value.operonId);
	expectNonBlankString(value.description, `${path}.description`);
	validateTaskStart(value.taskStart, `${path}.taskStart`);
	validateAppearance(value.appearance, `${path}.appearance`);
	expectExactKeys(value.source, ['filePath'], `${path}.source`);
	expectVaultPath(value.source.filePath, `${path}.source.filePath`);
	if (!Array.isArray(value.notifications) || value.notifications.length === 0) {
		fail('INVALID_SHAPE', `${path}.notifications`, 'tasks must contain at least one notification');
	}
	const seenEpochs = new Set();
	let previous = null;
	for (const [notificationIndex, notification] of value.notifications.entries()) {
		validateNotification(notification, value, taskIndex, notificationIndex, root, seenOccurrenceIds, seenEpochs);
		const orderKey = [notification.triggerAtEpochMs, notification.occurrenceId];
		if (previous && (orderKey[0] < previous[0] || (orderKey[0] === previous[0] && orderKey[1] < previous[1]))) {
			fail('NON_DETERMINISTIC_ORDER', `${path}.notifications`, 'notifications are not sorted');
		}
		previous = orderKey;
	}
}

export function validateMobileNotificationsSnapshot(value) {
	expectExactKeys(value, ROOT_KEYS, '$');
	if (value.schemaVersion !== 1) fail('UNSUPPORTED_SCHEMA', 'schemaVersion', 'expected schemaVersion 1');
	expectBoolean(value.enabled, 'enabled');
	if (value.authoritative !== true) fail('NON_AUTHORITATIVE', 'authoritative', 'v1 snapshots must be authoritative');
	expectEpoch(value.generatedAtEpochMs, 'generatedAtEpochMs');
	expectInstant(value.generatedAt, value.generatedAtEpochMs, 'generatedAt', UTC_INSTANT_PATTERN);
	expectExactKeys(value.vault, ['id', 'name'], 'vault');
	if (typeof value.vault.id !== 'string' || !UUID_V4_PATTERN.test(value.vault.id)) {
		fail('INVALID_VAULT_ID', 'vault.id', 'expected a lowercase UUID v4');
	}
	expectNonBlankString(value.vault.name, 'vault.name');
	expectTimezone(value.timezone, 'timezone');
	expectExactKeys(value.window, ['catchUpMinutes', 'end', 'endEpochMs', 'horizonDays', 'start', 'startEpochMs'], 'window');
	expectEpoch(value.window.startEpochMs, 'window.startEpochMs');
	expectEpoch(value.window.endEpochMs, 'window.endEpochMs');
	expectInstant(value.window.start, value.window.startEpochMs, 'window.start', UTC_INSTANT_PATTERN);
	expectInstant(value.window.end, value.window.endEpochMs, 'window.end', UTC_INSTANT_PATTERN);
	if (value.window.horizonDays !== 7) fail('INVALID_WINDOW', 'window.horizonDays', 'v1 horizon must be seven days');
	if (!Number.isInteger(value.window.catchUpMinutes)
		|| value.window.catchUpMinutes < 0
		|| value.window.catchUpMinutes > 1440) {
		fail('INVALID_WINDOW', 'window.catchUpMinutes', 'catch-up must be an integer from 0 through 1440');
	}
	const expectedStart = value.generatedAtEpochMs
		- Math.max(ON_TIME_TOLERANCE_MS, value.window.catchUpMinutes * 60_000);
	if (value.window.startEpochMs !== expectedStart
		|| value.window.endEpochMs !== value.generatedAtEpochMs + SEVEN_DAYS_MS
		|| value.window.startEpochMs >= value.window.endEpochMs) {
		fail('INVALID_WINDOW', 'window', 'window does not match generation time, catch-up, and seven-day horizon');
	}
	validateSourcePolicy(value.sourcePolicy, value.enabled);
	if (!Array.isArray(value.tasks)) fail('INVALID_SHAPE', 'tasks', 'expected an array');
	if (!value.enabled && value.tasks.length > 0) {
		fail('INVALID_DISABLED_SNAPSHOT', 'tasks', 'disabled snapshots must be empty');
	}
	const seenTaskIds = new Set();
	const seenOccurrenceIds = new Set();
	let previousTask = null;
	for (const [taskIndex, task] of value.tasks.entries()) {
		validateTask(task, taskIndex, value, seenTaskIds, seenOccurrenceIds);
		const firstNotification = task.notifications[0];
		const orderKey = [firstNotification.triggerAtEpochMs, task.operonId];
		if (previousTask && (orderKey[0] < previousTask[0]
			|| (orderKey[0] === previousTask[0] && orderKey[1] < previousTask[1]))) {
			fail('NON_DETERMINISTIC_ORDER', 'tasks', 'tasks are not sorted by earliest occurrence then operonId');
		}
		previousTask = orderKey;
	}
	return value;
}

export function parseMobileNotificationsSnapshot(text) {
	let value;
	try {
		value = JSON.parse(text);
	} catch {
		fail('INVALID_JSON', '$', 'could not parse JSON');
	}
	return validateMobileNotificationsSnapshot(value);
}

function canonicalizeValue(value) {
	if (Array.isArray(value)) return value.map(canonicalizeValue);
	if (!isPlainObject(value)) return value;
	return Object.fromEntries(
		Object.keys(value).sort().map(key => [key, canonicalizeValue(value[key])]),
	);
}

export function canonicalSnapshotJson(snapshot) {
	return JSON.stringify(canonicalizeValue(validateMobileNotificationsSnapshot(snapshot)));
}

export function hashMobileNotificationsSnapshot(snapshot) {
	return createHash('sha256').update(canonicalSnapshotJson(snapshot)).digest('hex');
}

export function decideMobileNotificationsSnapshot(snapshot, state) {
	validateMobileNotificationsSnapshot(snapshot);
	if (!Number.isSafeInteger(state.nowMs) || state.nowMs < 0) {
		throw new TypeError('state.nowMs must be a non-negative safe integer');
	}
	const contentHash = hashMobileNotificationsSnapshot(snapshot);
	if (snapshot.generatedAtEpochMs > state.nowMs + MAX_FUTURE_SKEW_MS) {
		return { action: 'preserve', reason: 'FUTURE_SNAPSHOT' };
	}
	if (state.lastGeneratedAtEpochMs === undefined) {
		if (snapshot.enabled && snapshot.window.endEpochMs <= state.nowMs) {
			return { action: 'preserve', reason: 'EXPIRED_SNAPSHOT' };
		}
		return { action: 'apply', contentHash };
	}
	if (!Number.isSafeInteger(state.lastGeneratedAtEpochMs) || state.lastGeneratedAtEpochMs < 0) {
		throw new TypeError('state.lastGeneratedAtEpochMs must be a non-negative safe integer when provided');
	}
	if (snapshot.generatedAtEpochMs < state.lastGeneratedAtEpochMs) {
		return { action: 'preserve', reason: 'STALE_SNAPSHOT' };
	}
	if (snapshot.generatedAtEpochMs === state.lastGeneratedAtEpochMs) {
		if (contentHash === state.lastContentHash) return { action: 'noop', contentHash };
		return { action: 'preserve', reason: 'SNAPSHOT_CONFLICT' };
	}
	if (snapshot.enabled && snapshot.window.endEpochMs <= state.nowMs) {
		return { action: 'preserve', reason: 'EXPIRED_SNAPSHOT' };
	}
	return { action: 'apply', contentHash };
}

export function evaluateMobileNotificationsText(text, state) {
	try {
		const snapshot = parseMobileNotificationsSnapshot(text);
		return { ...decideMobileNotificationsSnapshot(snapshot, state), snapshot };
	} catch (error) {
		if (error instanceof MobileNotificationsContractError) {
			return { action: 'preserve', reason: error.code };
		}
		return { action: 'preserve', reason: 'VALIDATION_FAILURE' };
	}
}

function flattenSchedule(snapshot) {
	const items = new Map();
	if (!snapshot.enabled) return items;
	for (const task of snapshot.tasks) {
		const taskPayload = {
			operonId: task.operonId,
			description: task.description,
			taskStart: task.taskStart,
			appearance: task.appearance,
			source: task.source,
		};
		for (const notification of task.notifications) {
			items.set(notification.occurrenceId, { task: taskPayload, notification });
		}
	}
	return items;
}

export function diffMobileNotificationSchedules(previousSnapshot, nextSnapshot) {
	if (previousSnapshot !== null) validateMobileNotificationsSnapshot(previousSnapshot);
	validateMobileNotificationsSnapshot(nextSnapshot);
	if (previousSnapshot !== null && previousSnapshot.vault.id !== nextSnapshot.vault.id) {
		fail('VAULT_ID_MISMATCH', 'vault.id', 'schedule reconciliation must stay within one vault');
	}
	const previous = previousSnapshot === null ? new Map() : flattenSchedule(previousSnapshot);
	const next = flattenSchedule(nextSnapshot);
	const add = [];
	const update = [];
	const cancel = [];
	for (const [occurrenceId, item] of next) {
		const oldItem = previous.get(occurrenceId);
		if (!oldItem) add.push(occurrenceId);
		else if (JSON.stringify(canonicalizeValue(oldItem)) !== JSON.stringify(canonicalizeValue(item))) {
			update.push(occurrenceId);
		}
	}
	for (const occurrenceId of previous.keys()) {
		if (!next.has(occurrenceId)) cancel.push(occurrenceId);
	}
	return {
		vaultId: nextSnapshot.vault.id,
		add: add.sort(),
		update: update.sort(),
		cancel: cancel.sort(),
	};
}
