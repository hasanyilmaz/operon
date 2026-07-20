/**
 * Canonical key definitions for Operon task fields.
 * Based on Spec Section 0.1 Core Key-Value Index.
 */

export type ValueType = 'text' | 'number' | 'date' | 'datetime' | 'list' | 'checkbox';
export type SyncPolicy = 'yes' | 'no' | 'auto';
export type KeyGroup = 'core' | 'scheduling' | 'workflow' | 'dependencies';

export interface CanonicalKeyDef {
	name: string;
	type: ValueType;
	sync: SyncPolicy;
	group: KeyGroup;
	internal?: boolean;
	/** Position in canonical field ordering (Section 7.2). Lower = earlier. */
	position: number;
	description: string;
}

export const TASK_STATS_CANONICAL_KEYS = [
	'directSubtaskCount',
	'directDoneSubtaskCount',
	'directOpenSubtaskCount',
	'treeDescendantCount',
	'treeDoneDescendantCount',
	'treeOpenDescendantCount',
] as const;

export type TaskStatsCanonicalKey = typeof TASK_STATS_CANONICAL_KEYS[number];

/**
 * All canonical keys, ordered by canonical position.
 */
export const CANONICAL_KEYS: CanonicalKeyDef[] = [
	// Core — Identity
	{ name: 'operonId', type: 'text', sync: 'yes', group: 'core', position: 1, description: 'Unique 7-char alphanumeric identifier' },
	// Workflow
	{ name: 'status', type: 'text', sync: 'yes', group: 'workflow', position: 2, description: 'Workflow status in Pipeline.Status format' },
	// Core — Priority
	{ name: 'priority', type: 'text', sync: 'yes', group: 'core', position: 3, description: 'Task importance level' },
	// Core — Dates
	{ name: 'dateDue', type: 'date', sync: 'yes', group: 'core', position: 4, description: 'Deadline' },
	{ name: 'dateScheduled', type: 'date', sync: 'yes', group: 'core', position: 5, description: 'When you plan to work on it' },
	{ name: 'dateStarted', type: 'date', sync: 'yes', group: 'core', position: 6, description: 'Earliest date task can begin' },
	{ name: 'datetimeCreated', type: 'datetime', sync: 'no', group: 'core', position: 33, description: 'Instance creation timestamp (per-instance)' },
	{ name: 'dateCompleted', type: 'date', sync: 'yes', group: 'core', position: 8, description: 'When task was completed' },
	{ name: 'dateCancelled', type: 'date', sync: 'yes', group: 'core', position: 9, description: 'When task was cancelled' },
	// Scheduling — Datetime
	{ name: 'datetimeStart', type: 'datetime', sync: 'yes', group: 'scheduling', position: 10, description: 'Scheduled start time' },
	{ name: 'datetimeEnd', type: 'datetime', sync: 'yes', group: 'scheduling', position: 11, description: 'Scheduled end time' },
	// Scheduling — Numbers
	{ name: 'estimate', type: 'number', sync: 'yes', group: 'scheduling', position: 12, description: 'Estimated duration (seconds)' },
	{ name: 'duration', type: 'number', sync: 'yes', group: 'scheduling', position: 13, description: 'Actual time tracked cumulative (seconds)' },
	{ name: 'totalEstimate', type: 'number', sync: 'auto', group: 'scheduling', position: 14, description: 'Project total: own + children estimated duration (seconds)' },
	{ name: 'totalDuration', type: 'number', sync: 'auto', group: 'scheduling', position: 15, description: 'Project total: own + children (seconds)' },
	// Core — Recurrence
	{ name: 'repeat', type: 'text', sync: 'yes', group: 'core', position: 16, description: 'Normalized recurrence rule' },
	{ name: 'repeatSeriesId', type: 'text', sync: 'yes', group: 'core', internal: true, position: 17, description: 'Recurring series identifier' },
	{ name: 'repeatOccurrenceDate', type: 'date', sync: 'yes', group: 'core', internal: true, position: 18, description: 'Canonical recurrence slot date for a materialized occurrence' },
	{ name: 'datetimeRepeatEnd', type: 'datetime', sync: 'yes', group: 'core', position: 19, description: 'Recurrence end date/time' },
	// Workflow
	{ name: 'parentTask', type: 'text', sync: 'yes', group: 'workflow', position: 20, description: 'Parent project/task ID (operonId reference)' },
	// Dependencies
	{ name: 'blocking', type: 'list', sync: 'auto', group: 'dependencies', position: 21, description: 'Task IDs this task is blocking' },
	{ name: 'blockedBy', type: 'list', sync: 'auto', group: 'dependencies', position: 22, description: 'Task IDs blocking this task' },
	// Workflow
	{ name: 'assignees', type: 'list', sync: 'yes', group: 'workflow', position: 23, description: 'Task executors' },
	{ name: 'contexts', type: 'list', sync: 'yes', group: 'workflow', position: 24, description: 'Environment or condition' },
	{ name: 'progress', type: 'number', sync: 'yes', group: 'workflow', position: 25, description: 'Completion percentage (0-100)' },
	{ name: 'directSubtaskCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.1, description: 'Direct child task count across all states' },
	{ name: 'directDoneSubtaskCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.2, description: 'Direct child task count with done checkbox state' },
	{ name: 'directOpenSubtaskCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.3, description: 'Direct child task count with open checkbox state' },
	{ name: 'treeDescendantCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.4, description: 'Recursive descendant task count across all states' },
	{ name: 'treeDoneDescendantCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.5, description: 'Recursive descendant task count with done checkbox state' },
	{ name: 'treeOpenDescendantCount', type: 'number', sync: 'yes', group: 'workflow', position: 25.6, description: 'Recursive descendant task count with open checkbox state' },
	{ name: 'reminderDatetimes', type: 'list', sync: 'yes', group: 'workflow', position: 26, description: 'Absolute local reminder datetimes' },
	{ name: 'reminderRules', type: 'list', sync: 'yes', group: 'workflow', position: 26.1, description: 'Dynamic reminder rules relative to supported task scheduling fields' },
	// Scheduling — Text
	{ name: 'timezone', type: 'text', sync: 'yes', group: 'scheduling', internal: true, position: 27, description: 'Timezone (city name or UTC offset)' },
	// Scheduling — Lists
	{ name: 'trackers', type: 'list', sync: 'yes', group: 'scheduling', position: 28, description: 'Completed time tracking sessions (ISO range)' },
	{ name: 'activeTracker', type: 'datetime', sync: 'yes', group: 'scheduling', internal: true, position: 29, description: 'Active tracking start datetime' },
	// Workflow
	{ name: 'related', type: 'list', sync: 'no', group: 'workflow', internal: true, position: 30, description: 'User-managed related notes and references' },
	{ name: 'taskIcon', type: 'text', sync: 'yes', group: 'workflow', position: 31, description: 'Icon name' },
	{ name: 'taskColor', type: 'text', sync: 'yes', group: 'workflow', position: 32, description: 'Hex color code' },
	{ name: 'note', type: 'text', sync: 'yes', group: 'workflow', position: 32.5, description: 'Short annotation or comment' },
	{ name: 'location', type: 'text', sync: 'yes', group: 'workflow', position: 32.6, description: 'Location coordinates in latitude, longitude format' },
	{ name: 'links', type: 'list', sync: 'yes', group: 'workflow', position: 32.75, description: 'External web links' },
	// Scheduling — Auto
	{ name: 'datetimeModified', type: 'datetime', sync: 'auto', group: 'scheduling', position: 34, description: 'Task modification timestamp (auto-updated)' },
];

/** Canonical key names as a union type */
export type CanonicalKeyName = typeof CANONICAL_KEYS[number]['name'];

/** Set of all canonical key names for O(1) lookup */
export const CANONICAL_KEY_SET = new Set(CANONICAL_KEYS.map(k => k.name));

/** Internal canonical keys should be hidden from user-facing field management UI. */
export const INTERNAL_CANONICAL_KEY_SET = new Set(
	CANONICAL_KEYS.filter(key => key.internal).map(key => key.name),
);

/** Map from key name to definition for O(1) access */
export const CANONICAL_KEY_MAP = new Map(CANONICAL_KEYS.map(k => [k.name, k]));

/** Legacy source keys that still read as their modern canonical key. */
export const LEGACY_CANONICAL_KEY_ALIASES: Record<string, readonly string[]> = {
	datetimeCreated: ['dateCreated'],
};

/** Keys sorted by canonical position for serialization */
export const CANONICAL_KEY_ORDER = [...CANONICAL_KEYS].sort((a, b) => a.position - b.position);

export function isInternalCanonicalKey(name: string): boolean {
	return INTERNAL_CANONICAL_KEY_SET.has(name);
}

export function isReminderStorageKey(name: string): boolean {
	return name === 'reminderDatetimes' || name === 'reminderRules';
}

/** Checkbox states */
export type CheckboxState = 'open' | 'done' | 'cancelled';
