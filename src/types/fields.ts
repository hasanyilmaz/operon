/**
 * Core field and task data structures for Operon.
 * Based on Spec Sections 0.1, 3, and 7.
 */

import { CheckboxState, ValueType } from './keys';

export interface SourceRange {
	from: number;
	to: number;
}

/** A single parsed inline field from a task line */
export interface OperonField {
	/** Exact key name used in markdown source */
	sourceKey: string;
	/** Canonical key name */
	key: string;
	/** Parsed/cleaned value */
	value: string;
	/** Raw value string as found in source (before escape processing) */
	rawValue: string;
	/** Value type (resolved from canonical key def or 'text' for unknown) */
	type: ValueType;
	/** Whether this is a known canonical key */
	isCanonical: boolean;
	/** Full {{...}} container range relative to the line */
	containerRange: SourceRange;
	/** Value range relative to the line */
	valueRange: SourceRange;
}

/** A WikiLink reference parsed from a field value */
export interface WikiLink {
	/** Full path of the linked file */
	path: string;
	/** Display alias (after |), or null if no alias */
	alias: string | null;
	/** Raw wikilink text including brackets */
	raw: string;
}

/** Time prefix parsed from a task line (e.g. "16:00" or "16:00-17:00") */
export interface TimePrefix {
	startTime: string; // HH:mm
	endTime: string | null; // HH:mm or null if single time
	raw: string; // original text
}

export interface ParsedTagToken {
	tag: string;
	range: SourceRange;
}

/** A fully parsed task line */
export interface ParsedTask {
	/** Checkbox state: open, done, or cancelled */
	checkbox: CheckboxState;
	/** Range of the checkbox token relative to the line */
	checkboxRange: SourceRange;
	/** Optional time prefix (e.g. "16:00" or "16:00-17:00") */
	timePrefix: TimePrefix | null;
	/** Range of the time prefix relative to the line */
	timePrefixRange: SourceRange | null;
	/** Task description text (between checkbox/time and first field or line end) */
	description: string;
	/** Range of the description text relative to the line */
	descriptionRange: SourceRange;
	/** Obsidian-native tags found in the line (e.g. ["backend", "urgent"]) */
	tags: string[];
	/** Source ranges for parsed tags */
	tagTokens: ParsedTagToken[];
	/** Parsed inline fields in order found */
	fields: OperonField[];
	/** Range of the metadata tail (#tags and {{fields}}) relative to the line */
	metadataTailRange: SourceRange | null;
	/** The operonId value if present, or null */
	operonId: string | null;
	/** Source file path */
	filePath: string;
	/** Line number in source file (0-based) */
	lineNumber: number;
	/** Original full line text */
	rawLine: string;
}

export interface PlainCheckboxProgress {
	/** Non-Operon markdown checkboxes found in the task scope */
	total: number;
	/** Checkboxes whose marker is not blank */
	completed: number;
}

/** Index entry for a task stored in the index */
export interface IndexedTask {
	operonId: string;
	/** Task description */
	description: string;
	/** Checkbox state */
	checkbox: CheckboxState;
	/** All field values keyed by canonical name */
	fieldValues: Record<string, string>;
	/** Tags */
	tags: string[];
	/** Primary source location */
	primary: TaskLocation;
	/** Last modified timestamp (ISO 8601) */
	datetimeModified: string;
	/** Index tier: hot (open/in-progress), warm (completed < 90 days), cold (completed > 90 days) */
	tier: 'hot' | 'warm' | 'cold';
	/** Non-Operon markdown checkbox progress read during file scanning */
	plainCheckboxProgress?: PlainCheckboxProgress;
}

export interface IndexedTaskInstance extends IndexedTask {
	instanceKey: string;
}

export interface DuplicateOperonConflict {
	operonId: string;
	instances: IndexedTaskInstance[];
	detectedAt: string;
	updatedAt: string;
	canonicalInstanceKey: string | null;
}

export interface DuplicateRegistrySnapshot {
	conflicts: DuplicateOperonConflict[];
	revision: number;
	totalConflictCount: number;
}

/** Location of a task instance in the vault */
export interface TaskLocation {
	filePath: string;
	lineNumber: number;
	/** 'inline' for task lines, 'yaml' for YAML frontmatter tasks */
	format: 'inline' | 'yaml';
}

/** Full task index data structure persisted to plugin runtime storage. */
export interface IndexData {
	version: number;
	lastFullReindex: string; // ISO 8601
	tasks: Record<string, IndexedTask>; // keyed by operonId
	taskInstances?: Record<string, IndexedTaskInstance>; // keyed by instanceKey
}
