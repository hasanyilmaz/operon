import { OperonSettings } from '../types/settings';
import { getCustomSurfaceKeyMappings, isCustomFieldMapping } from './custom-field-surfaces';
import { getAvailableReminderRuleAnchors } from './field-pickers/reminder-picker-model';

export interface TaskFieldSuggestionItem {
	canonicalKey: string;
	visibleName: string;
}

export interface TaskFieldTriggerMatch {
	token: string;
	start: number;
	end: number;
}

export type TaskFieldSuggestionSuppressionReason =
	| 'no-trigger'
	| 'token-too-short'
	| 'no-items'
	| 'not-task-line'
	| 'not-live-preview'
	| 'not-operon-task'
	| 'composition-active'
	| 'picker-active'
	| 'session-cancelled';

export interface TaskFieldSuggestionResolution {
	trigger: TaskFieldTriggerMatch | null;
	token: string;
	items: TaskFieldSuggestionItem[];
	suppressionReason: TaskFieldSuggestionSuppressionReason | null;
}

const TASK_FIELD_TRIGGER_RE = /(?:^|[\s([{;,])([\p{L}][\p{L}\p{N}_-]*)$/u;

function matchTaskFieldTriggerCandidate(beforeCaret: string): TaskFieldTriggerMatch | null {
	const match = TASK_FIELD_TRIGGER_RE.exec(beforeCaret);
	if (!match) return null;

	const token = match[1];
	return {
		token,
		start: beforeCaret.length - token.length,
		end: beforeCaret.length,
	};
}

export function matchTaskFieldTrigger(beforeCaret: string): TaskFieldTriggerMatch | null {
	const candidate = matchTaskFieldTriggerCandidate(beforeCaret);
	if (!candidate || candidate.token.length < 2) return null;
	return candidate;
}

export function buildTaskFieldSuggestions(
	token: string,
	settings: OperonSettings,
	currentFieldValues: Record<string, string>,
	surface: 'editor' | 'creator' = 'editor',
): TaskFieldSuggestionItem[] {
	const lowered = token.toLocaleLowerCase();
	const seenVisibleNames = new Set<string>();
	const builtInItems: TaskFieldSuggestionItem[] = [];
	const customItems: TaskFieldSuggestionItem[] = [];

	const addItem = (target: TaskFieldSuggestionItem[], item: TaskFieldSuggestionItem): void => {
		const key = item.visibleName.toLocaleLowerCase();
		if (seenVisibleNames.has(key)) return;
		seenVisibleNames.add(key);
		target.push(item);
	};

	for (const mapping of settings.keyMappings) {
		if (mapping.isInternal) continue;
		if (isCustomFieldMapping(mapping)) continue;
		if (!mapping.visiblePropertyName) continue;
		if (!mapping.visiblePropertyName.toLocaleLowerCase().startsWith(lowered)) continue;
		addItem(builtInItems, {
			canonicalKey: mapping.canonicalKey,
			visibleName: mapping.visiblePropertyName,
		});
	}

	if ('tags'.startsWith(lowered)) {
		addItem(builtInItems, {
			canonicalKey: 'tags',
			visibleName: 'tags',
		});
	}

	if (!(currentFieldValues['datetimeStart'] ?? '').trim()) {
		for (const [key, item] of builtInItems.entries()) {
			if (item.canonicalKey === 'datetimeEnd') {
				builtInItems.splice(key, 1);
				break;
			}
		}
	}

	if (getAvailableReminderRuleAnchors(currentFieldValues).length === 0) {
		const reminderRulesIndex = builtInItems.findIndex(item => item.canonicalKey === 'reminderRules');
		if (reminderRulesIndex >= 0) builtInItems.splice(reminderRulesIndex, 1);
	}

	for (const mapping of getCustomSurfaceKeyMappings(settings, surface)) {
		const visibleName = mapping.visiblePropertyName?.trim();
		if (!visibleName || !visibleName.toLocaleLowerCase().startsWith(lowered)) continue;
		addItem(customItems, {
			canonicalKey: mapping.canonicalKey,
			visibleName,
		});
	}

	return [
		...builtInItems.sort(compareBuiltInTaskFieldSuggestionItems(token)),
		...customItems,
	].slice(0, 8);
}

function compareBuiltInTaskFieldSuggestionItems(token: string): (a: TaskFieldSuggestionItem, b: TaskFieldSuggestionItem) => number {
	return (a, b) => {
		const exactA = a.visibleName.length === token.length ? 0 : 1;
		const exactB = b.visibleName.length === token.length ? 0 : 1;
		if (exactA !== exactB) return exactA - exactB;
		if (a.visibleName.length !== b.visibleName.length) return a.visibleName.length - b.visibleName.length;
		return a.visibleName.localeCompare(b.visibleName, undefined, { sensitivity: 'base' });
	};
}

export function resolveTaskFieldSuggestions(
	beforeCaret: string,
	settings: OperonSettings,
	currentFieldValues: Record<string, string>,
	surface: 'editor' | 'creator' = 'editor',
): TaskFieldSuggestionResolution {
	const candidate = matchTaskFieldTriggerCandidate(beforeCaret);
	if (!candidate) {
		return {
			trigger: null,
			token: '',
			items: [],
			suppressionReason: 'no-trigger',
		};
	}

	if (candidate.token.length < 2) {
		return {
			trigger: null,
			token: candidate.token,
			items: [],
			suppressionReason: 'token-too-short',
		};
	}

	const items = buildTaskFieldSuggestions(candidate.token, settings, currentFieldValues, surface);
	return {
		trigger: candidate,
		token: candidate.token,
		items,
		suppressionReason: items.length > 0 ? null : 'no-items',
	};
}

export function isParsedTaskFieldSuggestionTarget(
	parsed: { operonId: string | null; fields: readonly unknown[] } | null,
): boolean {
	return Boolean(parsed && (parsed.operonId || parsed.fields.length > 0));
}

export function isTaskFieldSuggestionDebugEnabled(): boolean {
	const debugWindow = window as Window & { OPERON_DEBUG_FIELD_SUGGESTIONS?: unknown };
	return debugWindow.OPERON_DEBUG_FIELD_SUGGESTIONS === true;
}

export function debugTaskFieldSuggestion(
	surface: 'live-preview' | 'task-creator',
	reason: TaskFieldSuggestionSuppressionReason,
	context: Record<string, unknown> = {},
): void {
	if (reason === 'no-trigger' || !isTaskFieldSuggestionDebugEnabled()) return;
	console.debug('[Operon] field suggestion', { surface, reason, ...context });
}
