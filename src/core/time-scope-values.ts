import type { IndexedTask } from '../types/fields';
import type { TrackerSession } from '../types/tracker';
import type { TrackedOnTaskTime } from './tracked-on-filter';

const signatures = new WeakMap<TrackedOnTaskTime, string>();
const TIME_SCOPE = Symbol('operon.filter.timeScope');
type ScopedFields = Record<string, string> & { [TIME_SCOPE]?: { time: TrackedOnTaskTime; display: Record<string, string> } };

/** Raw values remain canonical even when this view-local task reaches an edit action. */
export function withTaskTimeScope(task: IndexedTask, time: TrackedOnTaskTime): IndexedTask {
	const display = {
		duration: String(time.durationSeconds),
		totalDuration: time.hasChildren && time.totalDurationSeconds !== null ? String(time.totalDurationSeconds) : '',
		trackers: time.sessions.map(session => `${session.start}/${session.end}`).join('; '),
	};
	const fieldValues: ScopedFields = { ...task.fieldValues, [TIME_SCOPE]: { time, display } };
	return { ...task, fieldValues };
}

export function getTimeScopedFieldValues(fields: Record<string, string>): Record<string, string> {
	const scope = (fields as ScopedFields)[TIME_SCOPE];
	return scope ? { ...fields, ...scope.display } : fields;
}

export function getTaskTimeScope(task: IndexedTask): TrackedOnTaskTime | null {
	return (task.fieldValues as ScopedFields)[TIME_SCOPE]?.time ?? null;
}

export function getScopedTrackerSessions(task: IndexedTask, sessions: readonly TrackerSession[]): readonly TrackerSession[] {
	const time = getTaskTimeScope(task);
	if (!time) return sessions;
	const selected = new Map(time.sessions.map(session => [session.sessionIndex, session]));
	return sessions.filter(session => {
		const original = selected.get(session.sessionIndex);
		return original?.start === session.start && original.end === session.end;
	});
}

/** Apply a parent's period to an expanded descendant without re-evaluating its membership. */
export function inheritTaskTimeScope(parent: IndexedTask, child: IndexedTask): IndexedTask {
	const time = getTaskTimeScope(parent);
	if (!time) return child;
	const independent = time.resolveTask(child);
	return withTaskTimeScope(child, independent.matched ? independent : time.projectTask(child));
}

export function replaceTaskTimeScope(target: Record<string, string>, source: Record<string, string>): void {
	delete (target as ScopedFields)[TIME_SCOPE];
	const scope = (source as ScopedFields)[TIME_SCOPE];
	if (scope) (target as ScopedFields)[TIME_SCOPE] = scope;
}

export function getTimeScopeSignature(task: IndexedTask): string {
	const time = getTaskTimeScope(task);
	if (!time) return '';
	let signature = signatures.get(time);
	if (signature === undefined) {
		signature = JSON.stringify([time.durationSeconds, time.totalDurationSeconds, time.sessions.map(session => [session.rawIndex, session.start, session.end])]);
		signatures.set(time, signature);
	}
	return signature;
}

/** Context-only rows use their own match, including an empty scope when excluded. */
export function resolveTaskTimeScope(source: IndexedTask, task: IndexedTask): IndexedTask {
	const time = getTaskTimeScope(source);
	return time ? withTaskTimeScope(task, time.resolveTask(task)) : task;
}
