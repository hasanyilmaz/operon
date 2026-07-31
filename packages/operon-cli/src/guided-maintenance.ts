import type {
	CatalogPipelineV1,
	FieldDescriptorV1,
	FieldValueTypeV1,
	GeneralUpdateItemV1,
	OperonCatalogV1,
	ReminderItemReferenceV1,
	TaskContextV1,
	TimerStateV1,
	WritableFieldValueV1,
} from '../../../src/agent-runtime/contracts/v1';
import { parseReminderOffsetInput } from '../../../src/core/reminder-rules';
import { sanitizeTerminalTextV1 } from './terminal-text';
import type { InteractiveTerminalPortV1 } from './terminal-port';

const PAGE_SIZE = 20;
const TEMPORAL_FIELDS = new Set([
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'datetimeStart',
	'datetimeEnd',
]);
const LOCAL_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const QUICK_OFFSETS = ['0m', '10m', '30m', '1h', '1d'] as const;

type HydratedTaskV1 = TaskContextV1 & {
	writableFields?: WritableFieldValueV1[];
};

export interface GuidedMutationIntentV1 {
	contractVersion: 1;
	kind: 'mutation-intent';
	reason: string;
	target?: {
		operonId: string;
		locator: TaskContextV1['locator'];
	};
	spec: Record<string, unknown>;
}

export type GuidedMaintenanceResultV1 =
	| { status: 'cancelled'; message: string }
	| { status: 'no-change'; message: string }
	| { status: 'ready'; intent: GuidedMutationIntentV1; summary: string };

interface ChoiceV1<T> {
	label: string;
	description?: string;
	value: T;
}

interface CollectedUpdateV1 {
	field: FieldDescriptorV1;
	change: GeneralUpdateItemV1 | {
		operation: 'clear';
		field: string;
		valueType: FieldValueTypeV1;
	};
	summary: string;
}

export async function runGuidedTaskUpdateWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	catalog: OperonCatalogV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, task } = options;
	const catalog = requireCatalog(options.catalog);
	const hydrated = task as HydratedTaskV1;
	const currentByKey = new Map(
		(hydrated.writableFields ?? []).map(field => [field.canonicalKey, field]),
	);
	if (!Array.isArray(hydrated.writableFields)) {
		throw new Error('GUIDED_WRITABLE_FIELDS_INCOMPLETE');
	}
	const candidates = catalog.fields.filter(field => (
		field.mappingStatus === 'mapped'
		&& field.readable
		&& field.mutationClass === 'general-update'
		&& field.mutationOwner === 'tasks.update'
		&& !(task.recurrence.repeating && TEMPORAL_FIELDS.has(field.canonicalKey))
	));
	if (candidates.length === 0) throw new Error('GUIDED_WRITABLE_FIELDS_UNAVAILABLE');
	if (candidates.some(field => !currentByKey.has(field.canonicalKey))) {
		throw new Error('GUIDED_WRITABLE_FIELDS_INCOMPLETE');
	}
	port.write(`Update Operon task\n\nTask: ${display(task.description)}\n\n`);
	const collected: CollectedUpdateV1[] = [];
	const selected = new Set<string>();
	while (collected.length < candidates.length) {
		const remaining = candidates.filter(field => !selected.has(field.canonicalKey));
		const choices: ChoiceV1<FieldDescriptorV1 | null>[] = remaining.map(field => ({
			label: field.displayName,
			description: field.description,
			value: field,
		}));
		if (collected.length > 0) choices.unshift({ label: 'Preview selected changes', value: null });
		const field = await choose(port, 'Field to update', choices, 0);
		if (field === undefined) return cancelled('Task update cancelled before preview.');
		if (field === null) break;
		const current = currentByKey.get(field.canonicalKey);
		const operation = current?.present && current.canClear && field.canonicalKey !== 'description'
			? await choose(port, `${field.displayName} action`, [
				{ label: 'Set or replace value', value: 'set' as const },
				{ label: 'Clear value', value: 'clear' as const },
			], 0)
			: 'set';
		if (operation === undefined) return cancelled('Task update cancelled before preview.');
		if (operation === 'clear') {
			collected.push({
				field,
				change: {
					operation: 'clear',
					field: field.canonicalKey,
					valueType: field.valueType,
				},
				summary: `${field.displayName}: clear`,
			});
			selected.add(field.canonicalKey);
			continue;
		}
		const value = await askFieldValue(port, field, catalog.taxonomy.priorities);
		if (value === undefined) return cancelled('Task update cancelled before preview.');
		if (sameValue(current?.value, value)) {
			port.write('That value is already set. Choose another field or clear it.\n');
			continue;
		}
		collected.push({
			field,
			change: {
				field: field.canonicalKey,
				valueType: field.valueType,
				value,
			} as GeneralUpdateItemV1,
			summary: renderChangeSummary(field, value),
		});
		selected.add(field.canonicalKey);
	}
	if (collected.length === 0) return { status: 'no-change', message: 'No task changes were selected.' };
	const summary = [
		'Task update draft',
		`Task: ${display(task.description)}`,
		...collected.map(item => `- ${item.summary}`),
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Preview these changes?', true) !== true) {
		return cancelled('Task update cancelled before preview.');
	}
	return {
		status: 'ready',
		summary,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user completed the guided Operon task update flow.',
			target: exactTarget(task),
			spec: {
				operation: 'update',
				changes: collected.map(item => item.change),
			},
		},
	};
}

export async function runGuidedTransitionWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	catalog: OperonCatalogV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, task } = options;
	const catalog = requireCatalog(options.catalog);
	if (!task.workflow?.status.id || !task.workflow.pipeline.id) {
		throw new Error('GUIDED_STATUS_UNAVAILABLE');
	}
	const ordered = orderPipelines(catalog.taxonomy.pipelines, task.workflow?.pipeline.id);
	const statuses = ordered.flatMap(pipeline => (
		pipeline.identityStatus === 'resolved'
			? pipeline.statuses
				.filter(status => status.identityStatus === 'resolved')
				.sort((left, right) => left.order - right.order)
				.map(status => ({ pipeline, status }))
			: []
	));
	if (statuses.length === 0) throw new Error('GUIDED_STATUS_UNAVAILABLE');
	port.write(
		`Transition Operon task\n\nTask: ${display(task.description)}\n`
		+ `Current: ${display(task.workflow?.pipeline.label ?? 'Unresolved')} / `
		+ `${display(task.workflow?.status.label ?? 'Unresolved')}\n\n`,
	);
	const selected = await choose(port, 'New status', statuses.map(({ pipeline, status }) => ({
		label: `${pipeline.name} / ${status.label}${status.id === task.workflow?.status.id ? ' (current)' : ''}`,
		description: statusSemantics(status),
		value: { pipeline, status },
	})), 0);
	if (!selected) return cancelled('Task transition cancelled before preview.');
	if (selected.status.id === task.workflow?.status.id) {
		return { status: 'no-change', message: 'The task is already in that status.' };
	}
	const summary = [
		'Task transition draft',
		`Task: ${display(task.description)}`,
		`From: ${display(task.workflow?.status.label ?? 'Unresolved')}`,
		`To: ${display(selected.pipeline.name)} / ${display(selected.status.label)}`,
		`Semantics: ${statusSemantics(selected.status)}`,
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Preview this transition?', true) !== true) {
		return cancelled('Task transition cancelled before preview.');
	}
	return {
		status: 'ready',
		summary,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user completed the guided Operon semantic transition flow.',
			target: exactTarget(task),
			spec: {
				operation: 'transition',
				targetStatusId: selected.status.id,
				expectedStatusId: task.workflow.status.id,
			},
		},
	};
}

export async function runGuidedReminderWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	catalog: OperonCatalogV1;
	operation: 'add' | 'replace' | 'remove';
}): Promise<GuidedMaintenanceResultV1> {
	const { port, task, operation } = options;
	const catalog = requireCatalog(options.catalog);
	port.write(`${title(operation)} reminder\n\nTask: ${display(task.description)}\n\n`);
	let selected: ReminderItemReferenceV1 | undefined;
	let collection: ReminderItemReferenceV1['collection'];
	if (operation === 'replace' || operation === 'remove') {
		if (!Array.isArray(task.reminderItems)) {
			throw new Error('GUIDED_REMINDER_ITEMS_UNAVAILABLE');
		}
		const items = task.reminderItems;
		if (items.length === 0) return { status: 'no-change', message: 'This task has no reminder items.' };
		selected = await choose(port, 'Reminder item', items.map(item => ({
			label: `${reminderType(item.collection)} — ${display(item.expectedValue)}`,
			value: item,
		})), 0);
		if (!selected) return cancelled('Reminder change cancelled before preview.');
		collection = selected.collection;
	} else {
		const availableCollections = catalog.policies.reminders.fields
			.filter(field => field.availability === 'available')
			.map(field => field.canonicalKey);
		const chosen = await choose(
			port,
			'Reminder type',
			([
				{ label: 'Fixed Reminder', value: 'reminderDatetimes' as const },
				{ label: 'Relative Reminder', value: 'reminderRules' as const },
			]).filter(choice => availableCollections.includes(choice.value)),
			0,
		);
		if (availableCollections.length === 0) throw new Error('GUIDED_REMINDER_COLLECTION_UNAVAILABLE');
		if (!chosen) return cancelled('Reminder creation cancelled before preview.');
		collection = chosen;
	}
	let value: string | undefined;
	if (operation !== 'remove') {
		value = collection === 'reminderDatetimes'
			? await askFixedReminder(port)
			: await askRelativeReminder(port, task, catalog.policies.reminders.ruleAnchors);
		if (value === undefined) return cancelled('Reminder change cancelled before preview.');
		if (selected?.expectedValue === value) {
			return { status: 'no-change', message: 'The reminder already has that value.' };
		}
	}
	const summary = [
		`${title(operation)} reminder draft`,
		`Task: ${display(task.description)}`,
		`Type: ${reminderType(collection)}`,
		...(selected ? [`Current: ${display(selected.expectedValue)}`] : []),
		...(value ? [`New value: ${display(value)}`] : []),
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, `Preview this reminder ${operation}?`, true) !== true) {
		return cancelled('Reminder change cancelled before preview.');
	}
	return {
		status: 'ready',
		summary,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: `The user completed the guided Operon reminder ${operation} flow.`,
			target: exactTarget(task),
			spec: {
				operation,
				collection,
				...(selected ? {
					itemId: selected.itemId,
					expectedValue: selected.expectedValue,
				} : {}),
				...(value ? { value } : {}),
			},
		},
	};
}

export async function runGuidedTimerStartWizardV1(options: {
	port: InteractiveTerminalPortV1;
	state: TimerStateV1;
	selectTask(): Promise<TaskContextV1 | null>;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, state } = options;
	if (state.transition) throw new Error('GUIDED_TIMER_TRANSITION_IN_PROGRESS');
	port.write(`Start Operon timer\n\n${timerStateSummary(state)}\n\n`);
	const mode = await choose(port, 'Timer assignment', [
		{ label: 'Assigned task', value: 'assigned' as const },
		{ label: 'Unassigned timer', value: 'unassigned' as const },
	], 0);
	if (!mode) return cancelled('Timer start cancelled before preview.');
	let task: TaskContextV1 | null = null;
	if (mode === 'assigned') {
		task = await options.selectTask();
		if (!task) return cancelled('Timer start cancelled before preview.');
		if (state.active?.operonId === task.identity.operonId && !state.active.isUnassigned) {
			return { status: 'no-change', message: 'The timer is already running for that task.' };
		}
	} else if (state.active?.isUnassigned) {
		return { status: 'no-change', message: 'An unassigned timer is already running.' };
	}
	const summary = [
		'Timer start draft',
		`Assignment: ${task ? display(task.description) : 'Unassigned'}`,
		...(state.active ? ['Current active timer will be finalized or switched by the Runtime.'] : []),
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Preview this timer start?', true) !== true) {
		return cancelled('Timer start cancelled before preview.');
	}
	return {
		status: 'ready',
		summary,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user completed the guided Operon timer start flow.',
			...(task ? { target: exactTarget(task) } : {}),
			spec: {
				operation: 'start',
				...(state.active ? { expectedActiveStart: state.active.start } : {}),
			},
		},
	};
}

export async function runGuidedTimerStopWizardV1(options: {
	port: InteractiveTerminalPortV1;
	state: TimerStateV1;
	target?: TaskContextV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, state, target } = options;
	if (state.transition) throw new Error('GUIDED_TIMER_TRANSITION_IN_PROGRESS');
	if (!state.active) return { status: 'no-change', message: 'The Operon timer is already idle.' };
	const summary = [
		'Timer stop draft',
		`Current: ${state.active.isUnassigned ? 'Unassigned' : display(target?.description ?? state.active.operonId ?? 'Orphan task')}`,
		`Started: ${display(state.active.start)}`,
	].join('\n');
	port.write(`${summary}\n`);
	if (await askYesNo(port, 'Preview this timer stop?', true) !== true) {
		return cancelled('Timer stop cancelled before preview.');
	}
	return {
		status: 'ready',
		summary,
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user completed the guided Operon timer stop flow.',
			...(target ? { target: exactTarget(target) } : {}),
			spec: {
				operation: 'stop',
				expectedActiveStart: state.active.start,
			},
		},
	};
}

export async function askGuidedMaintenanceApplyV1(
	port: InteractiveTerminalPortV1,
): Promise<boolean> {
	return (await askYesNo(port, 'Apply this unchanged plan?', false)) === true;
}

function requireCatalog(value: OperonCatalogV1): Extract<OperonCatalogV1, { ok: true }> {
	if (!value.ok) throw new Error('GUIDED_CATALOG_UNAVAILABLE');
	return value;
}

function exactTarget(task: TaskContextV1): NonNullable<GuidedMutationIntentV1['target']> {
	return {
		operonId: task.identity.operonId,
		locator: structuredClone(task.locator),
	};
}

async function askFieldValue(
	port: InteractiveTerminalPortV1,
	field: FieldDescriptorV1,
	priorities: Extract<OperonCatalogV1, { ok: true }>['taxonomy']['priorities'],
): Promise<string | number | boolean | string[] | undefined> {
	if (field.canonicalKey === 'priority') {
		return await choose(port, 'Priority', [...priorities]
			.sort((left, right) => left.order - right.order)
			.map(priority => ({
				label: `${priority.label}${priority.isDefault ? ' (default)' : ''}`,
				description: priority.description,
				value: priority.id,
			})), 0);
	}
	if (field.valueType === 'checkbox') {
		return await choose(port, field.displayName, [
			{ label: 'Yes', value: true },
			{ label: 'No', value: false },
		], 0);
	}
	if (field.valueType === 'list') return await askList(port, field.displayName);
	while (true) {
		const raw = await port.ask(`${field.displayName}: `);
		if (raw === null || isCancel(raw)) return undefined;
		const value = raw.trim();
		if (field.valueType === 'number') {
			if (!value) {
				port.write('Enter a finite number.\n');
				continue;
			}
			const number = Number(value);
			if (Number.isFinite(number)) return number;
			port.write('Enter a finite number.\n');
			continue;
		}
		if (field.valueType === 'date' && !isValidDate(value)) {
			port.write('Enter a real date as YYYY-MM-DD.\n');
			continue;
		}
		if (field.valueType === 'datetime' && !isValidLocalDatetime(value)) {
			port.write('Enter a real local datetime as YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.\n');
			continue;
		}
		if (!value || hasUnsafeLineCharacter(value)) {
			port.write('Enter a non-empty single-line value.\n');
			continue;
		}
		return value;
	}
}

async function askList(port: InteractiveTerminalPortV1, label: string): Promise<string[] | undefined> {
	const values: string[] = [];
	while (true) {
		const raw = await port.ask(`${label} item${values.length === 0 ? '' : ' (blank to finish)'}: `);
		if (raw === null || isCancel(raw)) return undefined;
		const value = raw.trim();
		if (!value) {
			if (values.length > 0) return values;
			port.write('Enter at least one item.\n');
			continue;
		}
		if (hasUnsafeLineCharacter(value)) {
			port.write('Enter one single-line item.\n');
			continue;
		}
		values.push(value);
	}
}

async function askFixedReminder(port: InteractiveTerminalPortV1): Promise<string | undefined> {
	while (true) {
		const raw = await port.ask('Fixed reminder local datetime (YYYY-MM-DDTHH:mm): ');
		if (raw === null || isCancel(raw)) return undefined;
		if (isValidLocalDatetime(raw.trim())) return normalizeLocalDatetime(raw.trim());
		port.write('Enter a real local datetime as YYYY-MM-DDTHH:mm or YYYY-MM-DDTHH:mm:ss.\n');
	}
}

async function askRelativeReminder(
	port: InteractiveTerminalPortV1,
	task: TaskContextV1,
	allowedAnchors: readonly string[],
): Promise<string | undefined> {
	const populated = anchorValues(task);
	const anchors = allowedAnchors.filter(anchor => populated.has(anchor));
	if (anchors.length === 0) throw new Error('GUIDED_REMINDER_ANCHOR_UNAVAILABLE');
	const anchor = await choose(port, 'Reminder anchor', anchors.map(value => ({
		label: `${anchorLabel(value)} — ${display(populated.get(value) ?? '')}`,
		value,
	})), 0);
	if (!anchor) return undefined;
	const quick = await choose(port, 'Offset before anchor', [
		...QUICK_OFFSETS.map(value => ({
			label: value === '0m' ? 'On time' : value,
			value,
		})),
		{ label: 'Custom offset', value: 'custom' as const },
	], 0);
	if (!quick) return undefined;
	let offset: string = quick;
	if (quick === 'custom') {
		while (true) {
			const raw = await port.ask('Offset (for example 2h 30m): ');
			if (raw === null || isCancel(raw)) return undefined;
			const parsed = parseReminderOffsetInput(raw.trim());
			if (parsed.ok) {
				offset = parsed.value.canonical;
				break;
			}
			port.write('Use week, day, hour, and minute components such as 1d, 2h 30m, or 0m.\n');
		}
	}
	return `${anchor}.${offset}`;
}

function anchorValues(task: TaskContextV1): Map<string, string> {
	return new Map([
		['datetimeStart', task.datetimes.start],
		['datetimeEnd', task.datetimes.end],
		['dateStarted', task.dates.started],
		['dateScheduled', task.dates.scheduled],
		['dateDue', task.dates.due],
	].filter((entry): entry is [string, string] => Boolean(entry[1])));
}

function orderPipelines(
	pipelines: readonly CatalogPipelineV1[],
	currentPipelineId?: string,
): CatalogPipelineV1[] {
	return [...pipelines].sort((left, right) => (
		Number(right.id === currentPipelineId) - Number(left.id === currentPipelineId)
		|| left.order - right.order
		|| left.name.localeCompare(right.name)
	));
}

function statusSemantics(status: {
	isFinished: boolean;
	isCancelled: boolean;
	isScheduledTarget: boolean;
	isTrackingTarget: boolean;
}): string {
	const semantics = [
		status.isFinished ? 'finished' : '',
		status.isCancelled ? 'cancelled' : '',
		status.isScheduledTarget ? 'scheduled' : '',
		status.isTrackingTarget ? 'tracking' : '',
	].filter(Boolean);
	return semantics.length > 0 ? semantics.join(', ') : 'open';
}

function timerStateSummary(state: TimerStateV1): string {
	if (state.transition) return `Timer transition in progress: ${state.transition.kind}`;
	if (!state.active) return 'Current timer: idle';
	return `Current timer: ${state.active.isUnassigned ? 'unassigned' : display(state.active.operonId ?? 'orphan')}`;
}

async function choose<T>(
	port: InteractiveTerminalPortV1,
	label: string,
	choices: ChoiceV1<T>[],
	defaultIndex: number,
): Promise<T | undefined> {
	if (choices.length === 0) return undefined;
	for (let pageStart = 0; pageStart < choices.length; pageStart += PAGE_SIZE) {
		const page = choices.slice(pageStart, pageStart + PAGE_SIZE);
		port.write(`${label}:\n`);
		for (const [index, choice] of page.entries()) {
			const suffix = pageStart + index === defaultIndex ? ' (default)' : '';
			port.write(`  ${index + 1}. ${display(choice.label)}${suffix}\n`);
			if (choice.description) port.write(`     ${display(choice.description)}\n`);
		}
		const answer = await port.ask('Choose a number, n for next page, or q to cancel: ');
		if (answer === null || isCancel(answer)) return undefined;
		if (!answer.trim() && defaultIndex >= pageStart && defaultIndex < pageStart + page.length) {
			return choices[defaultIndex].value;
		}
		if (answer.trim().toLowerCase() === 'n' && pageStart + PAGE_SIZE < choices.length) continue;
		const index = Number(answer.trim());
		if (Number.isSafeInteger(index) && index >= 1 && index <= page.length) return page[index - 1].value;
		port.write('Choose one visible number.\n');
		pageStart -= PAGE_SIZE;
	}
	return undefined;
}

async function askYesNo(
	port: InteractiveTerminalPortV1,
	prompt: string,
	defaultValue: boolean,
): Promise<boolean | null> {
	while (true) {
		const answer = await port.ask(`${prompt} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
		if (answer === null || isCancel(answer)) return null;
		const normalized = answer.trim().toLowerCase();
		if (!normalized) return defaultValue;
		if (normalized === 'y' || normalized === 'yes') return true;
		if (normalized === 'n' || normalized === 'no') return false;
		port.write('Enter y or n.\n');
	}
}

function renderChangeSummary(
	field: FieldDescriptorV1,
	value: string | number | boolean | string[],
): string {
	if (field.canonicalKey === 'note' || field.canonicalKey === 'links') {
		return `${field.displayName}: ${Array.isArray(value) ? `${value.length} item(s)` : 'set'}`;
	}
	return `${field.displayName}: ${Array.isArray(value) ? `${value.length} item(s)` : display(String(value))}`;
}

function sameValue(
	left: string | number | boolean | string[] | undefined,
	right: string | number | boolean | string[],
): boolean {
	return JSON.stringify(left) === JSON.stringify(right);
}

function isValidDate(value: string): boolean {
	if (!DATE_PATTERN.test(value)) return false;
	const [year, month, day] = value.split('-').map(Number);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

function isValidLocalDatetime(value: string): boolean {
	const match = LOCAL_DATETIME_PATTERN.exec(value);
	if (!match || !isValidDate(match[1])) return false;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = Number(match[4] ?? 0);
	return hour >= 0 && hour <= 23 && minute >= 0 && minute <= 59 && second >= 0 && second <= 59;
}

function normalizeLocalDatetime(value: string): string {
	return value.length === 16 ? `${value}:00` : value;
}

function anchorLabel(value: string): string {
	const labels: Record<string, string> = {
		datetimeStart: 'Start datetime',
		datetimeEnd: 'End datetime',
		dateStarted: 'Started date',
		dateScheduled: 'Scheduled date',
		dateDue: 'Due date',
	};
	return labels[value] ?? value;
}

function reminderType(value: ReminderItemReferenceV1['collection']): string {
	return value === 'reminderDatetimes' ? 'Fixed Reminder' : 'Relative Reminder';
}

function title(value: string): string {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function display(value: string): string {
	return sanitizeTerminalTextV1(value);
}

function isCancel(value: string): boolean {
	return value.trim().toLowerCase() === 'q';
}

function hasUnsafeLineCharacter(value: string): boolean {
	return [...value].some(character => (
		character === '\r'
		|| character === '\n'
		|| character.codePointAt(0) === 0
	));
}

function cancelled(message: string): GuidedMaintenanceResultV1 {
	return { status: 'cancelled', message };
}
