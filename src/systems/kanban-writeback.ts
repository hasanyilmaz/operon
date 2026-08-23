import { parseListValue } from '../core/parser';
import { localToday } from '../core/local-time';
import { composeStatusValue, Pipeline, StatusDefinition } from '../types/pipeline';
import { IndexedTask } from '../types/fields';
import { KanbanSwimlaneBy } from '../types/kanban';
import { KeyMapping } from '../types/settings';
import { KANBAN_NO_VALUE_KEY } from './kanban-query';
import { getManagedCustomFieldOptionMapping } from '../core/managed-task-fields';

export interface KanbanWritebackDraft {
	description: string;
	checkbox: IndexedTask['checkbox'];
	fieldValues: Record<string, string>;
	tags: string[];
}

export interface KanbanWritebackPlan {
	payload: Record<string, string>;
	changedKeys: string[];
	nextDraft: KanbanWritebackDraft;
}

export function buildKanbanWritebackPlan(options: {
	task: IndexedTask;
	pipeline: Pipeline;
	targetStatus: StatusDefinition;
	sourceLaneKey: string | null;
	targetLaneKey: string;
	swimlaneBy: KanbanSwimlaneBy | null;
	keyMappings?: readonly KeyMapping[];
}): KanbanWritebackPlan {
	const { task, pipeline, targetStatus, sourceLaneKey, targetLaneKey, swimlaneBy } = options;
	const keyMappings = options.keyMappings ?? [];
	const payload: Record<string, string> = {};
	const nextDraft: KanbanWritebackDraft = {
		description: task.description,
		checkbox: task.checkbox,
		fieldValues: { ...task.fieldValues },
		tags: [...task.tags],
	};

	const nextStatusValue = composeStatusValue(pipeline.name, targetStatus.label);
	if ((task.fieldValues['status'] ?? '') !== nextStatusValue) {
		payload.status = nextStatusValue;
		nextDraft.fieldValues['status'] = nextStatusValue;
	}

	const targetCheckbox: IndexedTask['checkbox'] = targetStatus.isFinished
		? 'done'
		: targetStatus.isCancelled
			? 'cancelled'
			: 'open';
	if (task.checkbox !== targetCheckbox) {
		payload._checkbox = targetCheckbox;
		nextDraft.checkbox = targetCheckbox;
	}

	const today = localToday();
	if (targetCheckbox === 'done') {
		const nextCompleted = (task.fieldValues['dateCompleted'] ?? '').trim() || today;
		if ((task.fieldValues['dateCompleted'] ?? '') !== nextCompleted) {
			payload.dateCompleted = nextCompleted;
			nextDraft.fieldValues['dateCompleted'] = nextCompleted;
		}
		if ((task.fieldValues['dateCancelled'] ?? '') !== '') {
			payload.dateCancelled = '';
			nextDraft.fieldValues['dateCancelled'] = '';
		}
	} else if (targetCheckbox === 'cancelled') {
		const nextCancelled = (task.fieldValues['dateCancelled'] ?? '').trim() || today;
		if ((task.fieldValues['dateCancelled'] ?? '') !== nextCancelled) {
			payload.dateCancelled = nextCancelled;
			nextDraft.fieldValues['dateCancelled'] = nextCancelled;
		}
		if ((task.fieldValues['dateCompleted'] ?? '') !== '') {
			payload.dateCompleted = '';
			nextDraft.fieldValues['dateCompleted'] = '';
		}
	} else {
		if ((task.fieldValues['dateCompleted'] ?? '') !== '') {
			payload.dateCompleted = '';
			nextDraft.fieldValues['dateCompleted'] = '';
		}
		if ((task.fieldValues['dateCancelled'] ?? '') !== '') {
			payload.dateCancelled = '';
			nextDraft.fieldValues['dateCancelled'] = '';
		}
	}

	if (sourceLaneKey !== null && sourceLaneKey === targetLaneKey) {
		return {
			payload,
			changedKeys: Object.keys(payload),
			nextDraft,
		};
	}

	if (swimlaneBy === 'priority' || swimlaneBy === 'dateDue' || swimlaneBy === 'dateScheduled') {
		const nextValue = targetLaneKey === KANBAN_NO_VALUE_KEY ? '' : targetLaneKey;
		if ((task.fieldValues[swimlaneBy] ?? '') !== nextValue) {
			payload[swimlaneBy] = nextValue;
			nextDraft.fieldValues[swimlaneBy] = nextValue;
		}
	} else if (swimlaneBy === 'tags') {
		if (targetLaneKey === KANBAN_NO_VALUE_KEY && sourceLaneKey === null) {
			if (task.tags.length > 0) {
				payload._tags = '';
				nextDraft.tags = [];
			}
			return {
				payload,
				changedKeys: Object.keys(payload),
				nextDraft,
			};
		}
		const nextTags = new Set(task.tags.map(value => value.trim()).filter(Boolean));
		if (sourceLaneKey && sourceLaneKey !== KANBAN_NO_VALUE_KEY) {
			nextTags.delete(sourceLaneKey);
		}
		if (targetLaneKey !== KANBAN_NO_VALUE_KEY) {
			nextTags.add(targetLaneKey);
		}
		const normalized = Array.from(nextTags);
		if (!areStringArraysEqual(task.tags, normalized)) {
			payload._tags = normalized.join(';');
			nextDraft.tags = normalized;
		}
	} else if (swimlaneBy === 'contexts' || swimlaneBy === 'assignees') {
		if (targetLaneKey === KANBAN_NO_VALUE_KEY && sourceLaneKey === null) {
			if ((task.fieldValues[swimlaneBy] ?? '') !== '') {
				payload[swimlaneBy] = '';
				nextDraft.fieldValues[swimlaneBy] = '';
			}
			return {
				payload,
				changedKeys: Object.keys(payload),
				nextDraft,
			};
		}
		const currentValues = parseListValue(task.fieldValues[swimlaneBy] ?? '');
		const nextValues = new Set(currentValues);
		if (sourceLaneKey && sourceLaneKey !== KANBAN_NO_VALUE_KEY) {
			nextValues.delete(sourceLaneKey);
		}
		if (targetLaneKey !== KANBAN_NO_VALUE_KEY) {
			nextValues.add(targetLaneKey);
		}
		const serialized = Array.from(nextValues).join('; ');
		if ((task.fieldValues[swimlaneBy] ?? '') !== serialized) {
			payload[swimlaneBy] = serialized;
			nextDraft.fieldValues[swimlaneBy] = serialized;
		}
	} else {
		const customSwimlaneMapping = getManagedCustomFieldOptionMapping(swimlaneBy, keyMappings);
		if (customSwimlaneMapping?.type === 'list') {
			if (targetLaneKey === KANBAN_NO_VALUE_KEY && sourceLaneKey === null) {
				if ((task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '') !== '') {
					payload[customSwimlaneMapping.canonicalKey] = '';
					nextDraft.fieldValues[customSwimlaneMapping.canonicalKey] = '';
				}
				return {
					payload,
					changedKeys: Object.keys(payload),
					nextDraft,
				};
			}
			const currentValues = parseListValue(task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '');
			const nextValues = new Set(currentValues);
			if (sourceLaneKey && sourceLaneKey !== KANBAN_NO_VALUE_KEY) {
				nextValues.delete(sourceLaneKey);
			}
			if (targetLaneKey !== KANBAN_NO_VALUE_KEY) {
				nextValues.add(targetLaneKey);
			}
			const serialized = Array.from(nextValues).join('; ');
			if ((task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '') !== serialized) {
				payload[customSwimlaneMapping.canonicalKey] = serialized;
				nextDraft.fieldValues[customSwimlaneMapping.canonicalKey] = serialized;
			}
		} else if (customSwimlaneMapping) {
			const nextValue = targetLaneKey === KANBAN_NO_VALUE_KEY ? '' : targetLaneKey;
			if ((task.fieldValues[customSwimlaneMapping.canonicalKey] ?? '') !== nextValue) {
				payload[customSwimlaneMapping.canonicalKey] = nextValue;
				nextDraft.fieldValues[customSwimlaneMapping.canonicalKey] = nextValue;
			}
		}
	}

	return {
		payload,
		changedKeys: Object.keys(payload),
		nextDraft,
	};
}

function areStringArraysEqual(left: string[], right: string[]): boolean {
	if (left.length !== right.length) return false;
	return left.every((value, index) => value === right[index]);
}
