import type { IndexedTask } from '../types/fields';
import type { PeriodicNoteConfigSource } from './periodic-note-config';
import {
	isPeriodicNoteDateKey,
	resolvePeriodicNoteDateKeyFromPath,
	type PeriodicNoteKind,
	type PeriodicNotePathConfig,
} from './periodic-note-path';

export type PeriodicParentIntent = 'unchanged' | 'explicitly-set' | 'explicitly-cleared';

export interface PeriodicParentConfig extends PeriodicNotePathConfig {
	kind: PeriodicNoteKind;
	createAsOperonTask: boolean;
	source?: PeriodicNoteConfigSource;
}

export type PeriodicFileTaskClassification =
	| { kind: 'none' }
	| { kind: 'ambiguous' }
	| {
		kind: 'periodic';
		periodicKind: PeriodicNoteKind;
		anchorDateKey: string;
		source?: PeriodicNoteConfigSource;
	};

export type PeriodicParentRealignmentDecision =
	| { kind: 'none' }
	| { kind: 'clear'; periodicKind: PeriodicNoteKind }
	| {
		kind: 'resolve-container';
		periodicKind: PeriodicNoteKind;
		targetDateKey: string;
		reason: 'existing-parent' | 'parentless-inline-bootstrap';
	};

export interface ResolvePeriodicParentRealignmentOptions {
	currentTask: Pick<IndexedTask, 'operonId' | 'primary' | 'fieldValues'>;
	patch: Record<string, string>;
	mode?: 'merge' | 'replace';
	parentIntent?: PeriodicParentIntent;
	currentParent: PeriodicFileTaskClassification;
	currentTaskClassification: PeriodicFileTaskClassification;
	bootstrapKind?: PeriodicNoteKind | null;
}

/**
 * Classify a File Task only when exactly one current periodic configuration
 * round-trips its vault-relative path. Callers provide indexed File Tasks, so
 * this is intentionally path/config pure and has no index side effects.
 */
export function classifyPeriodicFileTask(
	task: Pick<IndexedTask, 'primary'> | null | undefined,
	configs: readonly PeriodicParentConfig[],
): PeriodicFileTaskClassification {
	if (!task || task.primary.format !== 'yaml') return { kind: 'none' };

	const matches: Array<{
		periodicKind: PeriodicNoteKind;
		anchorDateKey: string;
		source?: PeriodicNoteConfigSource;
	}> = [];
	for (const config of configs) {
		if (!config.createAsOperonTask) continue;
		const anchorDateKey = resolvePeriodicNoteDateKeyFromPath(config.kind, task.primary.filePath, config);
		if (anchorDateKey) matches.push({
			periodicKind: config.kind,
			anchorDateKey,
			...(config.source ? { source: config.source } : {}),
		});
	}
	if (matches.length === 0) return { kind: 'none' };
	if (matches.length > 1) return { kind: 'ambiguous' };
	return { kind: 'periodic', ...matches[0] };
}

/**
 * A replace save may omit an unchanged field. The UI can supply an explicit
 * intent when a user selected or cleared the parent in the same save.
 */
export function resolvePeriodicParentIntent(options: {
	currentParentTaskId: string | null | undefined;
	patch: Record<string, string>;
	explicitIntent?: PeriodicParentIntent;
}): PeriodicParentIntent {
	if (options.explicitIntent) return options.explicitIntent;
	if (!hasOwn(options.patch, 'parentTask')) return 'unchanged';
	const current = normalize(options.currentParentTaskId);
	const next = normalize(options.patch['parentTask']);
	if (next === current) return 'unchanged';
	return next ? 'explicitly-set' : 'explicitly-cleared';
}

/**
 * Decide only the parent relation. It never moves the task source, creates
 * files, or assumes a fallback when a manual parent is present.
 */
export function resolvePeriodicParentRealignment(
	options: ResolvePeriodicParentRealignmentOptions,
): PeriodicParentRealignmentDecision {
	const { currentTask, patch } = options;
	if (options.currentTaskClassification.kind !== 'none') return { kind: 'none' };
	if (!hasOwn(patch, 'dateScheduled')) return { kind: 'none' };

	const parentIntent = resolvePeriodicParentIntent({
		currentParentTaskId: currentTask.fieldValues['parentTask'],
		patch,
		explicitIntent: options.parentIntent,
	});
	if (parentIntent !== 'unchanged') return { kind: 'none' };

	const previousDate = normalize(currentTask.fieldValues['dateScheduled']);
	const nextDate = normalize(patch['dateScheduled']);
	if (previousDate === nextDate) return { kind: 'none' };

	if (options.currentParent.kind === 'ambiguous') return { kind: 'none' };
	if (options.currentParent.kind === 'periodic') {
		if (!nextDate) {
			return { kind: 'clear', periodicKind: options.currentParent.periodicKind };
		}
		if (!isPeriodicNoteDateKey(nextDate)) return { kind: 'none' };
		return {
			kind: 'resolve-container',
			periodicKind: options.currentParent.periodicKind,
			targetDateKey: nextDate,
			reason: 'existing-parent',
		};
	}

	const currentParentId = normalize(currentTask.fieldValues['parentTask']);
	if (currentParentId || currentTask.primary.format !== 'inline') return { kind: 'none' };
	const bootstrapKind = options.bootstrapKind ?? null;
	if (!bootstrapKind || !isPeriodicNoteDateKey(nextDate)) return { kind: 'none' };
	return {
		kind: 'resolve-container',
		periodicKind: bootstrapKind,
		targetDateKey: nextDate,
		reason: 'parentless-inline-bootstrap',
	};
}

function normalize(value: string | null | undefined): string {
	return (value ?? '').trim();
}

function hasOwn(source: Record<string, string>, key: string): boolean {
	return Object.prototype.hasOwnProperty.call(source, key) === true;
}
