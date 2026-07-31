import type {
	CatalogPipelineV1,
	CatalogPoliciesV1,
	CatalogPriorityV1,
	ContextPackV1,
	CreateFieldItemV1,
	CreateTaskSpecV1,
	FieldDescriptorV1,
	FieldValueTypeV1,
} from '../../../src/agent-runtime/contracts/v1';
import {
	CONTRACT_LIMITS_V1,
	utf8ByteLengthV1,
	validateVaultRelativePathV1,
} from '../../../src/agent-runtime/contracts/v1';
import { sanitizeTerminalTextV1 } from './terminal-text';
import type { InteractiveTerminalPortV1 } from './terminal-port';

const PAGE_SIZE = 20;
export const COMMON_CREATE_FIELDS = new Set([
	'assignees',
	'contexts',
	'dateDue',
	'dateScheduled',
	'dateStarted',
	'datetimeEnd',
	'datetimeStart',
	'estimate',
	'links',
	'location',
	'note',
	'tags',
	'taskColor',
	'taskIcon',
]);
const LOCAL_DATETIME_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/u;
export const DESCRIPTION_CHARACTER_CAP = 16_384;
export const DESCRIPTION_BYTE_CAP = 16_384;
export const CREATE_FIELD_CAP = 128;
export const CREATE_LIST_ITEM_CAP = 256;
export const TAG_PATTERN = /^(?=.*[^0-9])[^\s#,[\]{}|\\^]+$/u;

export type GuidedCreationPortV1 = InteractiveTerminalPortV1;

export interface GuidedCreationModelV1 {
	pipelines: CatalogPipelineV1[];
	priorities: CatalogPriorityV1[];
	fields: FieldDescriptorV1[];
	policies: CatalogPoliciesV1;
	defaultPipelineId?: string;
	defaultPipelineState: 'resolved' | 'none' | 'unavailable';
	defaultPriorityId?: string;
	defaultPriorityState: 'resolved' | 'none' | 'unavailable';
}

export interface GuidedCreationIntentV1 {
	contractVersion: 1;
	kind: 'mutation-intent';
	requestId?: string;
	correlationId?: string;
	reason: string;
	spec: CreateTaskSpecV1;
}

export type GuidedCreationWizardResultV1 =
	| {
		status: 'cancelled';
		message: string;
	}
	| {
		status: 'ready';
		intent: GuidedCreationIntentV1;
		summary: string;
	};

interface SelectionV1<T> {
	label: string;
	description?: string;
	value: T;
}

interface WorkflowSelectionV1 {
	pipeline?: CatalogPipelineV1;
	statusId?: string;
	label: string;
}

interface PrioritySelectionV1 {
	priorityId?: string;
	label: string;
}

interface PropertyCandidateV1 {
	canonicalKey: string;
	displayName: string;
	description: string;
	valueType: FieldValueTypeV1;
	source: 'built-in' | 'custom';
}

interface CollectedPropertyV1 {
	candidate: PropertyCandidateV1;
	field?: CreateFieldItemV1;
	tags?: string[];
	summary: string;
}

export function buildGuidedCreationModelV1(context: ContextPackV1): GuidedCreationModelV1 {
	if (
		!context.ok
		|| context.projection !== 'creation-context'
		|| !context.catalog
		|| !context.policies
	) {
		throw new Error('GUIDED_CONTEXT_UNAVAILABLE');
	}
	const defaultPipeline = context.catalog.taxonomy.defaultPipeline;
	const defaultPriority = context.catalog.taxonomy.defaultPriority;
	return {
		pipelines: context.catalog.taxonomy.pipelines
			.filter(pipeline => pipeline.identityStatus === 'resolved')
			.sort((left, right) => left.order - right.order || compareText(left.name, right.name)),
		priorities: [...context.catalog.taxonomy.priorities]
			.sort((left, right) => left.order - right.order || compareText(left.label, right.label)),
		fields: [...context.catalog.fields],
		policies: context.policies,
		...(defaultPipeline.status === 'resolved' && defaultPipeline.id
			? { defaultPipelineId: defaultPipeline.id }
			: {}),
		defaultPipelineState: normalizeDefaultState(defaultPipeline.status),
		...(defaultPriority.status === 'resolved' && defaultPriority.id
			? { defaultPriorityId: defaultPriority.id }
			: {}),
		defaultPriorityState: normalizeDefaultState(defaultPriority.status),
	};
}

export async function runGuidedCreationWizardV1(options: {
	model: GuidedCreationModelV1;
	port: GuidedCreationPortV1;
	itemRef: string;
	initialDescription?: string;
}): Promise<GuidedCreationWizardResultV1> {
	const { model, port } = options;
	port.write('Create an Operon task\n\n');
	const description = await askRequiredText(
		port,
		'Description',
		options.initialDescription?.trim() ?? '',
	);
	if (description === null) return cancelled();

	const representation = await choose(port, 'Representation', [
		{ label: 'Inline task', value: 'inline' as const },
		{ label: 'File Task', value: 'file' as const },
	], model.policies.creation.defaultToFileTask ? 1 : 0);
	if (representation === null) return cancelled();

	const target = await chooseTarget(port, model, representation);
	if (target === null) return cancelled();

	const workflow = await chooseWorkflow(port, model, representation === 'file');
	if (workflow === null) return cancelled();

	const priority = await choosePriority(port, model, representation === 'file');
	if (priority === null) return cancelled();

	const fields: CreateFieldItemV1[] = [];
	let requiredAssigneeCount = 0;
	if (model.policies.creation.assigneesRequired) {
		const assignees = await askRequiredList(port, 'Assignee');
		if (assignees === null) return cancelled();
		requiredAssigneeCount = assignees.length;
		fields.push({ kind: 'list', field: 'assignees', value: assignees });
	}

	const properties = await collectOptionalProperties(
		port,
		propertyCandidates(model, model.policies.creation.assigneesRequired),
		CREATE_FIELD_CAP - fields.length,
	);
	if (properties === null) return cancelled();
	for (const property of properties) {
		if (property.field) fields.push(property.field);
	}
	const tags = properties.find(property => property.tags)?.tags;

	const templateId = resolveTemplateId(model, representation, target.mode, workflow.pipeline?.id);
	if (representation === 'file' && templateId === null) {
		throw new Error('GUIDED_TEMPLATE_UNAVAILABLE');
	}
	const resolvedTarget = target.representation === 'file' && templateId
		? { ...target, templateId }
		: target;
	const spec: CreateTaskSpecV1 = {
		operation: 'create',
		items: [{
			itemRef: options.itemRef,
			description,
			target: resolvedTarget,
			fields,
			...(tags ? { tags } : {}),
			...(workflow.statusId ? { statusId: workflow.statusId } : {}),
			...(priority.priorityId ? { priorityId: priority.priorityId } : {}),
		}],
	};
	const summary = renderDraftSummary({
		description,
		representation,
		target: resolvedTarget,
		workflow: workflow.label,
		priority: priority.label,
		requiredAssigneeCount,
		properties,
	});
	port.write(`${summary}\n`);
	const review = await askYesNo(port, 'Preview this task?', true);
	if (review !== true) return cancelled('Task creation cancelled before preview.');
	return {
		status: 'ready',
		intent: {
			contractVersion: 1,
			kind: 'mutation-intent',
			reason: 'The user completed the guided Operon task creation flow.',
			spec,
		},
		summary,
	};
}

export async function askGuidedApplyV1(port: GuidedCreationPortV1): Promise<boolean> {
	return (await askYesNo(port, 'Create this task now?', false)) === true;
}

function normalizeDefaultState(
	value: 'resolved' | 'none' | 'ambiguous' | 'unavailable',
): 'resolved' | 'none' | 'unavailable' {
	if (value === 'resolved' || value === 'none') return value;
	return 'unavailable';
}

async function chooseTarget(
	port: GuidedCreationPortV1,
	model: GuidedCreationModelV1,
	representation: 'inline' | 'file',
): Promise<CreateTaskSpecV1['items'][number]['target'] | null> {
	const creation = model.policies.creation;
	const configuredRepresentation = creation.defaultToFileTask ? 'file' : 'inline';
	const configuredInlineAvailable = representation === configuredRepresentation
		&& representation === 'inline'
		&& (creation.inlineTaskSaveMode === 'daily-notes' || creation.inlineTaskSaveMode === 'specific-file');
	const configuredAvailable = (
		representation === configuredRepresentation
		&& representation === 'file'
	) || configuredInlineAvailable;
	const options: SelectionV1<'configured-default' | 'exact-path'>[] = [];
	if (configuredAvailable) {
		const configuredLabel = representation === 'file'
			? `Configured default — ${creation.fileTaskTargetFolder || 'File Task folder'}`
			: `Configured default — ${creation.inlineTaskSaveMode}`;
		options.push({ label: configuredLabel, value: 'configured-default' });
	}
	options.push({ label: 'Exact vault-relative path', value: 'exact-path' });
	const mode = await choose(port, 'Target', options, 0);
	if (mode === null) return null;
	if (mode === 'configured-default') return { representation, mode };
	while (true) {
		const prompt = representation === 'file'
			? 'Vault-relative File Task path (filename must match the canonical task description): '
			: 'Vault-relative path: ';
		const answer = await port.ask(prompt);
		if (isCancelledAnswer(answer)) return null;
		const filePath = answer!.trim().normalize('NFC');
		if (isSafeInteractiveText(filePath) && validateVaultRelativePathV1(filePath) === null) {
			return { representation, mode, filePath };
		}
		port.write('Enter a safe vault-relative path without traversal, backslashes, or control characters.\n');
	}
}

async function chooseWorkflow(
	port: GuidedCreationPortV1,
	model: GuidedCreationModelV1,
	templateMayOverrideDefault: boolean,
): Promise<WorkflowSelectionV1 | null> {
	const options: SelectionV1<{ pipeline?: CatalogPipelineV1; useConfiguredDefault: boolean }>[] = [];
	const defaultPipeline = model.pipelines.find(pipeline => pipeline.id === model.defaultPipelineId);
	if (model.defaultPipelineState === 'resolved' && defaultPipeline) {
		options.push({
			label: `Configured default — ${defaultPipeline.name}`,
			description: defaultPipeline.description,
			value: { pipeline: defaultPipeline, useConfiguredDefault: true },
		});
	} else if (model.defaultPipelineState === 'none') {
		options.push({
			label: 'Configured default — no pipeline',
			value: { useConfiguredDefault: true },
		});
	}
	for (const pipeline of model.pipelines) {
		options.push({
			label: pipeline.name,
			description: pipeline.description,
			value: { pipeline, useConfiguredDefault: false },
		});
	}
	if (options.length === 0) throw new Error('GUIDED_PIPELINE_UNAVAILABLE');
	const pipelineChoice = await choose(port, 'Pipeline', options, 0);
	if (pipelineChoice === null) return null;
	if (!pipelineChoice.pipeline) return { label: 'Configured default — no pipeline' };

	const statuses = pipelineChoice.pipeline.statuses
		.filter(status => status.identityStatus === 'resolved')
		.sort((left, right) => left.order - right.order || compareText(left.label, right.label));
	if (statuses.length === 0) throw new Error('GUIDED_STATUS_UNAVAILABLE');
	const statusOptions: SelectionV1<{ id?: string; label: string }>[] = [];
	if (pipelineChoice.useConfiguredDefault) {
		const configuredInitialStatusId = model.policies.creation.builtInTemplateCandidates
			.find(candidate => candidate.pipelineId === pipelineChoice.pipeline?.id)
			?.initialStatusId;
		const configuredInitialStatus = statuses.find(status => status.id === configuredInitialStatusId);
		const defaultStatusLabel = templateMayOverrideDefault
			? 'Runtime/template-configured status'
			: configuredInitialStatus?.label ?? 'Runtime-configured status';
		statusOptions.push({
			label: configuredInitialStatus && !templateMayOverrideDefault
				? `Configured default — ${configuredInitialStatus.label}`
				: `Configured default — ${defaultStatusLabel}`,
			value: { label: defaultStatusLabel },
		});
	}
	for (const status of statuses) {
		statusOptions.push({ label: status.label, value: { id: status.id, label: status.label } });
	}
	const status = await choose(port, 'Status', statusOptions, 0);
	if (status === null) return null;
	return {
		pipeline: pipelineChoice.pipeline,
		...(status.id ? { statusId: status.id } : {}),
		label: `${pipelineChoice.pipeline.name} / ${status.label}`,
	};
}

async function choosePriority(
	port: GuidedCreationPortV1,
	model: GuidedCreationModelV1,
	templateMayOverrideDefault: boolean,
): Promise<PrioritySelectionV1 | null> {
	const options: SelectionV1<PrioritySelectionV1>[] = [];
	const defaultPriority = model.priorities.find(priority => priority.id === model.defaultPriorityId);
	if (model.defaultPriorityState === 'resolved' && defaultPriority) {
		const defaultLabel = templateMayOverrideDefault
			? 'Runtime/template-configured priority'
			: defaultPriority.label;
		options.push({
			label: `Configured default — ${defaultLabel}`,
			description: defaultPriority.description,
			value: { label: `Configured default — ${defaultLabel}` },
		});
	} else if (model.defaultPriorityState === 'none') {
		options.push({
			label: 'Configured default — no priority',
			value: { label: 'Configured default — no priority' },
		});
	}
	for (const priority of model.priorities) {
		options.push({
			label: priority.label,
			description: priority.description,
			value: { priorityId: priority.id, label: priority.label },
		});
	}
	if (options.length === 0) throw new Error('GUIDED_PRIORITY_UNAVAILABLE');
	return await choose(port, 'Priority', options, 0);
}

function resolveTemplateId(
	model: GuidedCreationModelV1,
	representation: 'inline' | 'file',
	mode: 'configured-default' | 'exact-path',
	pipelineId?: string,
): string | null | undefined {
	if (representation === 'inline') return undefined;
	if (mode === 'configured-default') return undefined;
	const configured = model.policies.creation.defaultFileTemplateId?.trim();
	if (configured) return configured;
	const effectivePipelineId = pipelineId ?? model.defaultPipelineId;
	const candidate = model.policies.creation.builtInTemplateCandidates
		.find(item => item.pipelineId === effectivePipelineId);
	return candidate?.id ?? null;
}

function propertyCandidates(
	model: GuidedCreationModelV1,
	assigneesAlreadySet: boolean,
): PropertyCandidateV1[] {
	return model.fields
		.filter(field => {
			if (assigneesAlreadySet && field.canonicalKey === 'assignees') return false;
			return isGuidedCreationFieldV1(field);
		})
		.map(field => ({
			canonicalKey: field.canonicalKey,
			displayName: field.displayName,
			description: field.description,
			valueType: field.valueType,
			source: field.source,
		}))
		.sort((left, right) => (
			left.source.localeCompare(right.source)
			|| compareText(left.displayName, right.displayName)
			|| compareText(left.canonicalKey, right.canonicalKey)
		));
}

export function isGuidedCreationFieldV1(field: FieldDescriptorV1): boolean {
	if (!field.readable || field.mappingStatus !== 'mapped') return false;
	return field.source === 'built-in'
		? COMMON_CREATE_FIELDS.has(field.canonicalKey)
		: field.mutationClass === 'general-update';
}

async function collectOptionalProperties(
	port: GuidedCreationPortV1,
	initialCandidates: PropertyCandidateV1[],
	maximumSelections: number,
): Promise<CollectedPropertyV1[] | null> {
	const selected: CollectedPropertyV1[] = [];
	let candidates = [...initialCandidates];
	let page = 0;
	while (candidates.length > 0) {
		const answer = await port.ask('Additional property (name, ? to list, blank to finish): ');
		if (answer === null || isQuit(answer)) return null;
		const query = answer.trim().normalize('NFC');
		if (!query) return selected;
		const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
		if (query === '?' || query === 'n' || query === 'p') {
			if (query === 'n') page = Math.min(page + 1, pageCount - 1);
			if (query === 'p') page = Math.max(page - 1, 0);
			showPropertyPage(port, candidates, page);
			continue;
		}
		const pageItems = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
		const numeric = Number(query);
		let matches: PropertyCandidateV1[];
		if (Number.isInteger(numeric) && numeric >= 1 && numeric <= pageItems.length) {
			matches = [pageItems[numeric - 1]];
		} else {
			const normalized = normalizeLookup(query);
			matches = candidates.filter(candidate => (
				normalizeLookup(candidate.canonicalKey) === normalized
				|| normalizeLookup(candidate.displayName) === normalized
			));
		}
		if (matches.length !== 1) {
			port.write(matches.length > 1
				? `That name is ambiguous. Use one canonical key: ${matches.map(item => display(item.canonicalKey)).join(', ')}\n`
				: 'No available property matches that exact name or current-page number.\n');
			continue;
		}
		const collected = await collectPropertyValue(port, matches[0]);
		if (collected === null) return null;
		if (collected) {
			selected.push(collected);
			if (selected.length >= maximumSelections) {
				port.write(`The ${CREATE_FIELD_CAP}-field creation limit was reached.\n`);
				return selected;
			}
			candidates = candidates.filter(candidate => candidate.canonicalKey !== matches[0].canonicalKey);
			page = Math.min(page, Math.max(0, Math.ceil(candidates.length / PAGE_SIZE) - 1));
		}
	}
	return selected;
}

function showPropertyPage(
	port: GuidedCreationPortV1,
	candidates: PropertyCandidateV1[],
	page: number,
): void {
	const pageCount = Math.max(1, Math.ceil(candidates.length / PAGE_SIZE));
	const items = candidates.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE);
	port.write(`\nAvailable properties — page ${page + 1}/${pageCount}\n`);
	items.forEach((candidate, index) => {
		port.write(
			`  ${index + 1}. ${display(candidate.displayName)} [${display(candidate.canonicalKey)}]`
			+ ` — ${display(candidate.valueType)}${candidate.description ? ` — ${display(candidate.description, 100)}` : ''}\n`,
		);
	});
	if (pageCount > 1) port.write('Use n for next page, p for previous page, or enter an exact property name.\n');
}

async function collectPropertyValue(
	port: GuidedCreationPortV1,
	candidate: PropertyCandidateV1,
): Promise<CollectedPropertyV1 | null | undefined> {
	const label = candidate.displayName || candidate.canonicalKey;
	if (
		candidate.canonicalKey === 'assignees'
		|| candidate.canonicalKey === 'contexts'
		|| candidate.canonicalKey === 'links'
		|| candidate.canonicalKey === 'tags'
		|| candidate.valueType === 'list'
	) {
		const values = await askList(port, label, candidate.canonicalKey === 'tags');
		if (values === null) return null;
		if (values.length === 0) return undefined;
		if (candidate.canonicalKey === 'tags') {
			return { candidate, tags: values, summary: `${label}: ${values.length} item(s)` };
		}
		const field = candidate.source === 'custom'
			? buildGuidedCreationCustomFieldV1(candidate, values)
			: buildGuidedCreationBuiltInFieldV1(candidate, values) ?? undefined;
		return { candidate, field, summary: `${label}: ${values.length} item(s)` };
	}
	while (true) {
		const answer = await port.ask(`${display(label)} (${display(candidate.valueType)}; blank to skip): `);
		if (answer === null || isQuit(answer)) return null;
		const value = answer.trim().normalize('NFC');
		if (!value) return undefined;
		const parsed = parseGuidedCreationPropertyValueV1(candidate.valueType, value);
		if (parsed === undefined) {
			port.write(valueFormatMessage(candidate.valueType));
			continue;
		}
		const field = candidate.source === 'custom'
			? buildGuidedCreationCustomFieldV1(candidate, parsed)
			: buildGuidedCreationBuiltInFieldV1(candidate, parsed);
		if (!field) {
			port.write('This field is not supported by guided creation.\n');
			return undefined;
		}
		const hidden = candidate.source === 'custom'
			|| candidate.canonicalKey === 'note'
			|| candidate.canonicalKey === 'location';
		return {
			candidate,
			field,
			summary: hidden ? `${label}: set` : `${label}: ${display(String(parsed), 80)}`,
		};
	}
}

export function buildGuidedCreationBuiltInFieldV1(
	candidate: { canonicalKey: string },
	value: string | number | boolean | string[],
): CreateFieldItemV1 | null {
	const field = candidate.canonicalKey;
	if (field === 'taskIcon' || field === 'taskColor' || field === 'note' || field === 'location') {
		return { kind: 'text', field, value: String(value) };
	}
	if (field === 'dateDue' || field === 'dateScheduled' || field === 'dateStarted') {
		return { kind: 'date', field, value: String(value) };
	}
	if (field === 'datetimeStart' || field === 'datetimeEnd') {
		return { kind: 'datetime', field, value: String(value) };
	}
	if (field === 'estimate' && typeof value === 'number') {
		return { kind: 'number', field, value };
	}
	if (
		(field === 'assignees' || field === 'contexts' || field === 'links')
		&& Array.isArray(value)
	) {
		return { kind: 'list', field, value };
	}
	return null;
}

export function buildGuidedCreationCustomFieldV1(
	candidate: Pick<PropertyCandidateV1, 'canonicalKey' | 'valueType'>,
	value: string | number | boolean | string[],
): CreateFieldItemV1 {
	return {
		kind: 'custom',
		field: candidate.canonicalKey,
		valueType: candidate.valueType,
		value,
	} as CreateFieldItemV1;
}

export function parseGuidedCreationPropertyValueV1(
	type: FieldValueTypeV1,
	value: string,
): string | number | boolean | undefined {
	if (!isSafeInteractiveText(value) || utf8ByteLengthV1(value) > CONTRACT_LIMITS_V1.generalStringBytes) {
		return undefined;
	}
	if (type === 'date') return isValidCalendarDate(value) ? value : undefined;
	if (type === 'datetime') return isValidLocalDateTime(value) ? value : undefined;
	if (type === 'number') {
		const numeric = Number(value);
		return Number.isFinite(numeric) ? numeric : undefined;
	}
	if (type === 'checkbox') {
		if (/^(?:y|yes|true|1)$/iu.test(value)) return true;
		if (/^(?:n|no|false|0)$/iu.test(value)) return false;
		return undefined;
	}
	return value;
}

function valueFormatMessage(type: FieldValueTypeV1): string {
	if (type === 'date') return 'Use YYYY-MM-DD.\n';
	if (type === 'datetime') return 'Use a local ISO datetime, for example 2026-07-26T14:30 or 2026-07-26T14:30:00.\n';
	if (type === 'number') return 'Enter a finite number.\n';
	if (type === 'checkbox') return 'Enter yes or no.\n';
	return 'Enter a value without terminal control characters.\n';
}

async function askList(
	port: GuidedCreationPortV1,
	label: string,
	tag = false,
): Promise<string[] | null> {
	const values: string[] = [];
	const itemLimit = tag ? CONTRACT_LIMITS_V1.collectionItems : CREATE_LIST_ITEM_CAP;
	while (true) {
		const answer = await port.ask(`${display(label)} value (blank to finish): `);
		if (answer === null || isQuit(answer)) return null;
		const value = answer.trim().normalize('NFC');
		if (!value) return values;
		if (
			!isSafeInteractiveText(value)
			|| utf8ByteLengthV1(value) > CONTRACT_LIMITS_V1.generalStringBytes
			|| value.includes(';')
			|| (tag && !TAG_PATTERN.test(value))
		) {
			port.write(tag
				? 'Enter one safe Obsidian tag token without whitespace, #, semicolons, or control syntax.\n'
				: 'Enter one value without semicolons or control characters.\n');
			continue;
		}
		if (!values.includes(value)) values.push(value);
		if (values.length >= itemLimit) {
			port.write(`The ${itemLimit}-item limit was reached.\n`);
			return values;
		}
	}
}

async function askRequiredList(
	port: GuidedCreationPortV1,
	label: string,
): Promise<string[] | null> {
	while (true) {
		const values = await askList(port, label);
		if (values === null) return null;
		if (values.length > 0) return values;
		port.write(`At least one ${label.toLocaleLowerCase('en-US')} is required by the current Operon policy.\n`);
	}
}

async function askRequiredText(
	port: GuidedCreationPortV1,
	label: string,
	initial: string,
): Promise<string | null> {
	if (
		initial
		&& initial.length <= DESCRIPTION_CHARACTER_CAP
		&& utf8ByteLengthV1(initial) <= DESCRIPTION_BYTE_CAP
		&& isSafeInteractiveText(initial)
	) {
		port.write(`${label}: ${display(initial, 120)}\n`);
		return initial.normalize('NFC');
	}
	while (true) {
		const answer = await port.ask(`${label}: `);
		if (answer === null || isQuit(answer)) return null;
		const value = answer.trim().normalize('NFC');
		if (
			value
			&& value.length <= DESCRIPTION_CHARACTER_CAP
			&& utf8ByteLengthV1(value) <= DESCRIPTION_BYTE_CAP
			&& isSafeInteractiveText(value)
		) return value;
		port.write(`${label} is required, must be at most ${DESCRIPTION_CHARACTER_CAP} characters, and cannot contain terminal controls or bidi formatting.\n`);
	}
}

async function choose<T>(
	port: GuidedCreationPortV1,
	label: string,
	options: SelectionV1<T>[],
	defaultIndex: number,
): Promise<T | null> {
	port.write(`\n${label}:\n`);
	options.forEach((option, index) => {
		const marker = index === defaultIndex ? ' (default)' : '';
		port.write(`  ${index + 1}. ${display(option.label)}${marker}\n`);
		if (option.description) port.write(`     ${display(option.description, 120)}\n`);
	});
	while (true) {
		const answer = await port.ask(`Select [${defaultIndex + 1}]: `);
		if (answer === null || isQuit(answer)) return null;
		const value = answer.trim();
		if (!value) return options[defaultIndex].value;
		const index = Number(value) - 1;
		if (Number.isInteger(index) && index >= 0 && index < options.length) {
			return options[index].value;
		}
		port.write(`Choose a number from 1 to ${options.length}, or q to cancel.\n`);
	}
}

async function askYesNo(
	port: GuidedCreationPortV1,
	prompt: string,
	defaultValue: boolean,
): Promise<boolean | null> {
	while (true) {
		const answer = await port.ask(`${prompt} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
		if (answer === null || isQuit(answer)) return null;
		const value = answer.trim();
		if (!value) return defaultValue;
		if (/^(?:y|yes)$/iu.test(value)) return true;
		if (/^(?:n|no)$/iu.test(value)) return false;
		port.write('Enter yes, no, or q to cancel.\n');
	}
}

function renderDraftSummary(input: {
	description: string;
	representation: 'inline' | 'file';
	target: CreateTaskSpecV1['items'][number]['target'];
	workflow: string;
	priority: string;
	requiredAssigneeCount: number;
	properties: CollectedPropertyV1[];
}): string {
	const target = input.target.mode === 'configured-default'
		? 'Configured default'
		: input.target.filePath;
	const lines = [
		'',
		'Task draft',
		`Description: ${display(input.description, 120)}`,
		`Representation: ${input.representation === 'inline' ? 'Inline' : 'File'}`,
		`Target: ${display(target, 120)}`,
		`Workflow: ${display(input.workflow, 120)}`,
		`Priority: ${display(input.priority, 120)}`,
	];
	if (input.requiredAssigneeCount > 0) {
		lines.push(`Assignees: ${input.requiredAssigneeCount} set`);
	}
	if (input.properties.length > 0) {
		lines.push('Additional properties:');
		for (const property of input.properties) lines.push(`  - ${display(property.summary, 140)}`);
	}
	return `${lines.join('\n')}\n`;
}

function containsControl(value: string): boolean {
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

export function isSafeInteractiveText(value: string): boolean {
	return !containsControl(value) && sanitizeTerminalTextV1(value) === value;
}

export function isValidCalendarDate(value: string): boolean {
	const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
	if (!match) return false;
	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const date = new Date(Date.UTC(year, month - 1, day));
	return date.getUTCFullYear() === year
		&& date.getUTCMonth() === month - 1
		&& date.getUTCDate() === day;
}

export function isValidLocalDateTime(value: string): boolean {
	const match = LOCAL_DATETIME_PATTERN.exec(value);
	if (!match || !isValidCalendarDate(match[1])) return false;
	const hour = Number(match[2]);
	const minute = Number(match[3]);
	const second = match[4] === undefined ? 0 : Number(match[4]);
	return hour <= 23 && minute <= 59 && second <= 59;
}

function isCancelledAnswer(value: string | null): boolean {
	return value === null || isQuit(value);
}

function isQuit(value: string): boolean {
	return value.trim().toLocaleLowerCase('en-US') === 'q';
}

function cancelled(message = 'Task creation cancelled; no preview or mutation was created.'): GuidedCreationWizardResultV1 {
	return { status: 'cancelled', message };
}

function normalizeLookup(value: string): string {
	return value.normalize('NFC').trim().toLocaleLowerCase('en-US');
}

function display(value: string, limit = 80): string {
	const safe = sanitizeTerminalTextV1(value);
	const points = [...safe];
	return points.length <= limit ? safe : `${points.slice(0, Math.max(0, limit - 1)).join('')}…`;
}

function compareText(left: string, right: string): number {
	return left.localeCompare(right, 'en', { sensitivity: 'base' });
}
