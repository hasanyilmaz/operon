import { App, Modal, Notice } from 'obsidian';
import {
	buildWorkflowStatusIdentityIndex,
	resolveConfiguredStatusIdentity,
	type ConfiguredWorkflowStatusIdentity,
} from '../core/workflow-status-identity';
import { validatePipelineTaxonomy } from '../core/pipeline-taxonomy-validation';
import { t } from '../core/i18n';
import type { PrepareWorkflowFieldRenameInput } from '../systems/workflow-field-rename-coordinator';
import type { IndexedTask } from '../types/fields';
import { clonePipeline, composeStatusValue, type Pipeline } from '../types/pipeline';

interface RepairPipelineCandidate {
	pipelineId: string;
	label: string;
	suggestedName: string;
}

interface RepairTaskChoice {
	task: IndexedTask;
	value: string;
	matches: readonly ConfiguredWorkflowStatusIdentity[];
}

export interface WorkflowPipelineRepairModel {
	pipelineCandidates: RepairPipelineCandidate[];
	defaultCandidateIds: string[];
	ambiguousTasksByPipelineId: ReadonlyMap<string, readonly RepairTaskChoice[]>;
}

export interface BuildWorkflowPipelineRepairInputOptions {
	pipelines: Pipeline[];
	defaultPipelineName: string;
	tasks: IndexedTask[];
	pipelineId: string;
	nextPipelineName: string;
	nextStatusLabels?: ReadonlyMap<string, string>;
	defaultPipelineId?: string;
	taskTargetKeys: ReadonlyMap<string, string>;
	operationId: string;
}

export type WorkflowPipelineRepairInvalidControl =
	| { kind: 'pipeline-name' }
	| { kind: 'status-label'; statusId: string }
	| { kind: 'default-pipeline' };

export type BuildWorkflowPipelineRepairInputResult =
	| { ok: true; input: PrepareWorkflowFieldRenameInput }
	| {
		ok: false;
		error: string;
		unresolvedTaskIds?: string[];
		invalidControl?: WorkflowPipelineRepairInvalidControl;
	};

interface WorkflowPipelineRepairModalOptions {
	pipelines: Pipeline[];
	defaultPipelineName: string;
	tasks: IndexedTask[];
	onSubmit: (input: PrepareWorkflowFieldRenameInput) => Promise<void>;
}

let workflowPipelineRepairModalInstance = 0;

export class WorkflowPipelineRepairModal extends Modal {
	private readonly model: WorkflowPipelineRepairModel;
	private readonly controlIdPrefix: string;
	private selectedPipelineId = '';
	private selectedDefaultPipelineId = '';
	private taskTargetKeys = new Map<string, string>();
	private statusLabelDrafts = new Map<string, string>();

	constructor(
		app: App,
		private readonly options: WorkflowPipelineRepairModalOptions,
	) {
		super(app);
		workflowPipelineRepairModalInstance += 1;
		this.controlIdPrefix = `operon-workflow-repair-${workflowPipelineRepairModalInstance}`;
		this.model = buildWorkflowPipelineRepairModel(
			options.pipelines,
			options.defaultPipelineName,
			options.tasks,
		);
		this.selectedPipelineId = this.model.pipelineCandidates[0]?.pipelineId ?? '';
		this.selectedDefaultPipelineId = this.model.defaultCandidateIds.length === 1
			? this.model.defaultCandidateIds[0]
			: '';
		this.resetStatusLabelDrafts();
	}

	onOpen(): void {
		this.modalEl.addClass('operon-workflow-repair-modal');
		this.render();
	}

	onClose(): void {
		this.contentEl.empty();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.titleEl.setText(t('settings', 'pipelineRepairTitle'));
		contentEl.createEl('p', { text: t('settings', 'pipelineRepairIntro') });

		if (this.model.pipelineCandidates.length === 0) {
			contentEl.createEl('p', {
				cls: 'operon-workflow-repair-empty',
				text: t('settings', 'pipelineRepairNoIssues'),
			});
			this.renderActions(null);
			return;
		}

		const pipelineRow = contentEl.createDiv('operon-workflow-repair-field');
		const pipelineLabel = pipelineRow.createEl('label', { text: t('settings', 'pipelineRepairPipeline') });
		const pipelineSelect = pipelineRow.createEl('select');
		pipelineSelect.id = `${this.controlIdPrefix}-pipeline`;
		pipelineLabel.htmlFor = pipelineSelect.id;
		for (const candidate of this.model.pipelineCandidates) {
			pipelineSelect.createEl('option', {
				value: candidate.pipelineId,
				text: candidate.label,
			});
		}
		pipelineSelect.value = this.selectedPipelineId;

		const nameRow = contentEl.createDiv('operon-workflow-repair-field');
		const nameLabel = nameRow.createEl('label', { text: t('settings', 'pipelineRepairNewName') });
		const nameInput = nameRow.createEl('input', { type: 'text' });
		nameInput.id = `${this.controlIdPrefix}-pipeline-name`;
		nameLabel.htmlFor = nameInput.id;
		nameInput.value = this.getSelectedCandidate()?.suggestedName ?? '';

		const selectedPipeline = this.options.pipelines.find(
			pipeline => pipeline.id === this.selectedPipelineId,
		);
		if (selectedPipeline) {
			const statusSection = contentEl.createDiv('operon-workflow-repair-statuses');
			statusSection.createEl('h3', { text: t('settings', 'pipelineRepairStatusLabels') });
			statusSection.createEl('p', { text: t('settings', 'pipelineRepairStatusLabelsDesc') });
			for (const [statusIndex, status] of selectedPipeline.statuses.entries()) {
				const row = statusSection.createDiv('operon-workflow-repair-field');
				const label = row.createEl('label', { text: status.label });
				const input = row.createEl('input', { type: 'text' });
				input.id = `${this.controlIdPrefix}-status-${statusIndex}`;
				input.dataset.workflowRepairStatusId = status.id;
				label.htmlFor = input.id;
				input.value = this.statusLabelDrafts.get(status.id) ?? status.label;
				input.addEventListener('input', () => {
					this.statusLabelDrafts.set(status.id, input.value);
				});
			}
		}

		if (this.model.defaultCandidateIds.length > 1) {
			const defaultRow = contentEl.createDiv('operon-workflow-repair-field');
			const defaultLabel = defaultRow.createEl('label', { text: t('settings', 'pipelineRepairDefaultPipeline') });
			const defaultSelect = defaultRow.createEl('select');
			defaultSelect.id = `${this.controlIdPrefix}-default-pipeline`;
			defaultSelect.dataset.workflowRepairControl = 'default-pipeline';
			defaultLabel.htmlFor = defaultSelect.id;
			defaultSelect.createEl('option', { value: '', text: t('settings', 'pipelineRepairChooseDefault') });
			for (const pipelineId of this.model.defaultCandidateIds) {
				const index = this.options.pipelines.findIndex(pipeline => pipeline.id === pipelineId);
				const pipeline = this.options.pipelines[index];
				if (!pipeline) continue;
				defaultSelect.createEl('option', {
					value: pipeline.id,
					text: `${pipeline.name} (${index + 1})`,
				});
			}
			defaultSelect.value = this.selectedDefaultPipelineId;
			defaultSelect.addEventListener('change', () => {
				this.selectedDefaultPipelineId = defaultSelect.value;
			});
		}

		const ambiguousTasks = this.getSelectedAmbiguousTasks();
		if (ambiguousTasks.length > 0) {
			const tasksSection = contentEl.createDiv('operon-workflow-repair-tasks');
			tasksSection.createEl('h3', { text: t('settings', 'pipelineRepairAmbiguousTasks') });
			tasksSection.createEl('p', { text: t('settings', 'pipelineRepairAmbiguousTasksDesc') });
			for (const [taskIndex, choice] of ambiguousTasks.entries()) {
				const row = tasksSection.createDiv('operon-workflow-repair-task-row');
				row.dataset.operonId = choice.task.operonId;
				const selectId = `${this.controlIdPrefix}-task-${taskIndex}`;
				const summary = row.createEl('label', { cls: 'operon-workflow-repair-task-summary' });
				summary.htmlFor = selectId;
				summary.createSpan({ cls: 'operon-workflow-repair-task-title', text: choice.task.description });
				const source = choice.task.primary.format === 'inline'
					? `${choice.task.primary.filePath}:${choice.task.primary.lineNumber + 1}`
					: choice.task.primary.filePath;
				summary.createSpan({
					cls: 'operon-workflow-repair-task-source',
					text: `${source} · ${choice.task.operonId}`,
				});
				const select = row.createEl('select');
				select.id = selectId;
				select.createEl('option', { value: '', text: t('settings', 'pipelineRepairChooseStatus') });
				for (const match of choice.matches) {
					select.createEl('option', {
						value: composeRepairTargetKey(match.pipeline.id, match.status.id),
						text: `${match.pipeline.name} [#${match.pipelineIndex + 1} · ${match.pipeline.id}] → ${match.status.label} [#${match.statusIndex + 1} · ${match.status.id}]`,
					});
				}
				select.value = this.taskTargetKeys.get(choice.task.operonId) ?? '';
				select.addEventListener('change', () => {
					if (select.value) this.taskTargetKeys.set(choice.task.operonId, select.value);
					else this.taskTargetKeys.delete(choice.task.operonId);
				});
			}
		}

		const errorEl = contentEl.createDiv('operon-workflow-repair-error');
		errorEl.setAttribute('role', 'alert');
		errorEl.setAttribute('aria-live', 'assertive');
		errorEl.tabIndex = -1;
		this.renderActions({
			nameInput,
			errorEl,
		});

		pipelineSelect.addEventListener('change', () => {
			this.selectedPipelineId = pipelineSelect.value;
			this.taskTargetKeys.clear();
			this.resetStatusLabelDrafts();
			this.render();
		});
	}

	private renderActions(
		form: { nameInput: HTMLInputElement; errorEl: HTMLElement } | null,
	): void {
		const actions = this.contentEl.createDiv('operon-confirm-action-buttons');
		const cancel = actions.createEl('button', { text: t('buttons', form ? 'cancel' : 'close') });
		cancel.addEventListener('click', () => this.close());
		if (!form) return;

		const apply = actions.createEl('button', {
			cls: 'mod-cta',
			text: t('settings', 'pipelineRepairApply'),
		});
		apply.addEventListener('click', () => {
			void this.submit(form, apply);
		});
	}

	private async submit(
		form: { nameInput: HTMLInputElement; errorEl: HTMLElement },
		applyButton: HTMLButtonElement,
	): Promise<void> {
		form.errorEl.setText('');
		form.nameInput.removeAttribute('aria-invalid');
		for (const control of Array.from(this.contentEl.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select'))) {
			control.removeAttribute('aria-invalid');
		}
		const result = buildWorkflowPipelineRepairInput({
			pipelines: this.options.pipelines,
			defaultPipelineName: this.options.defaultPipelineName,
			tasks: this.options.tasks,
			pipelineId: this.selectedPipelineId,
			nextPipelineName: form.nameInput.value,
			nextStatusLabels: this.statusLabelDrafts,
			defaultPipelineId: this.selectedDefaultPipelineId || undefined,
			taskTargetKeys: this.taskTargetKeys,
			operationId: `workflow-repair-${Date.now().toString(36)}-${this.selectedPipelineId}`,
		});
		if (!result.ok) {
			form.errorEl.setText(result.error);
			const unresolvedIds = new Set(result.unresolvedTaskIds ?? []);
			let firstInvalidControl: HTMLInputElement | HTMLSelectElement | null = null;
			for (const row of Array.from(this.contentEl.querySelectorAll<HTMLElement>('.operon-workflow-repair-task-row'))) {
				if (!unresolvedIds.has(row.dataset.operonId ?? '')) continue;
				const select = row.querySelector<HTMLSelectElement>('select');
				if (!select) continue;
				select.setAttribute('aria-invalid', 'true');
				firstInvalidControl ??= select;
			}
			if (!firstInvalidControl && result.invalidControl?.kind === 'pipeline-name') {
				form.nameInput.setAttribute('aria-invalid', 'true');
				firstInvalidControl = form.nameInput;
			}
			if (!firstInvalidControl && result.invalidControl?.kind === 'status-label') {
				const invalidStatusId = result.invalidControl.statusId;
				firstInvalidControl = Array.from(
					this.contentEl.querySelectorAll<HTMLInputElement>('input[data-workflow-repair-status-id]'),
				).find(input => input.dataset.workflowRepairStatusId === invalidStatusId) ?? null;
				firstInvalidControl?.setAttribute('aria-invalid', 'true');
			}
			if (!firstInvalidControl && result.invalidControl?.kind === 'default-pipeline') {
				firstInvalidControl = this.contentEl.querySelector<HTMLSelectElement>(
					'select[data-workflow-repair-control="default-pipeline"]',
				);
				firstInvalidControl?.setAttribute('aria-invalid', 'true');
			}
			if (firstInvalidControl) {
				firstInvalidControl.focus();
				firstInvalidControl.scrollIntoView({ block: 'nearest' });
			} else {
				form.errorEl.focus();
			}
			return;
		}

		applyButton.disabled = true;
		try {
			await this.options.onSubmit(result.input);
			this.close();
		} catch (error) {
			applyButton.disabled = false;
			const message = error instanceof Error ? error.message : String(error);
			form.errorEl.setText(message);
			new Notice(t('settings', 'pipelineRepairFailed'));
		}
	}

	private getSelectedCandidate(): RepairPipelineCandidate | null {
		return this.model.pipelineCandidates.find(candidate => candidate.pipelineId === this.selectedPipelineId) ?? null;
	}

	private getSelectedAmbiguousTasks(): readonly RepairTaskChoice[] {
		return this.model.ambiguousTasksByPipelineId.get(this.selectedPipelineId) ?? [];
	}

	private resetStatusLabelDrafts(): void {
		this.statusLabelDrafts.clear();
		const pipeline = this.options.pipelines.find(candidate => candidate.id === this.selectedPipelineId);
		if (!pipeline) return;
		const occupiedLabels = new Set(pipeline.statuses.map(status => status.label));
		const usedLabels = new Set<string>();
		for (const status of pipeline.statuses) {
			let nextLabel = status.label;
			if (usedLabels.has(nextLabel)) {
				let suffix = 2;
				while (usedLabels.has(`${status.label} ${suffix}`) || occupiedLabels.has(`${status.label} ${suffix}`)) {
					suffix += 1;
				}
				nextLabel = `${status.label} ${suffix}`;
			}
			usedLabels.add(nextLabel);
			this.statusLabelDrafts.set(status.id, nextLabel);
		}
	}
}

export function buildWorkflowPipelineRepairModel(
	pipelines: Pipeline[],
	defaultPipelineName: string,
	tasks: IndexedTask[],
): WorkflowPipelineRepairModel {
	const identityIndex = buildWorkflowStatusIdentityIndex(pipelines);
	const problematicPipelineIds = new Set<string>();
	const nameCounts = new Map<string, number>();
	for (const pipeline of pipelines) {
		nameCounts.set(pipeline.name, (nameCounts.get(pipeline.name) ?? 0) + 1);
		if (pipeline.name.includes('.')) problematicPipelineIds.add(pipeline.id);
		const statusLabels = new Set<string>();
		for (const status of pipeline.statuses) {
			if (statusLabels.has(status.label)) problematicPipelineIds.add(pipeline.id);
			statusLabels.add(status.label);
		}
	}
	for (const pipeline of pipelines) {
		if ((nameCounts.get(pipeline.name) ?? 0) > 1) problematicPipelineIds.add(pipeline.id);
	}
	for (const matches of identityIndex.matchesByValue.values()) {
		if (matches.length <= 1) continue;
		for (const match of matches) problematicPipelineIds.add(match.pipeline.id);
	}

	const existingNames = pipelines.map(pipeline => pipeline.name);
	const pipelineCandidates = pipelines
		.map((pipeline, index) => ({ pipeline, index }))
		.filter(({ pipeline }) => problematicPipelineIds.has(pipeline.id))
		.map(({ pipeline, index }) => ({
			pipelineId: pipeline.id,
			label: `${pipeline.name} (${index + 1})`,
			suggestedName: suggestUniquePipelineName(pipeline, pipelines, existingNames),
		}));

	const ambiguousTasksByPipelineId = new Map<string, RepairTaskChoice[]>();
	for (const task of tasks) {
		const value = task.fieldValues.status?.trim() ?? '';
		if (!value) continue;
		const resolution = resolveConfiguredStatusIdentity(value, identityIndex);
		if (resolution.kind !== 'ambiguous') continue;
		for (const pipelineId of new Set(resolution.matches.map(match => match.pipeline.id))) {
			if (!problematicPipelineIds.has(pipelineId)) continue;
			const choices = ambiguousTasksByPipelineId.get(pipelineId) ?? [];
			choices.push({ task, value, matches: resolution.matches });
			ambiguousTasksByPipelineId.set(pipelineId, choices);
		}
	}

	return {
		pipelineCandidates,
		defaultCandidateIds: pipelines
			.filter(pipeline => pipeline.name === defaultPipelineName)
			.map(pipeline => pipeline.id),
		ambiguousTasksByPipelineId,
	};
}

export function buildWorkflowPipelineRepairInput(
	options: BuildWorkflowPipelineRepairInputOptions,
): BuildWorkflowPipelineRepairInputResult {
	const nextName = options.nextPipelineName.trim();
	if (!nextName) {
		return {
			ok: false,
			error: t('settings', 'pipelineRepairNameRequired'),
			invalidControl: { kind: 'pipeline-name' },
		};
	}
	if (nextName.includes('.')) {
		return {
			ok: false,
			error: t('settings', 'pipelineNameReservedDelimiter'),
			invalidControl: { kind: 'pipeline-name' },
		};
	}
	if (options.pipelines.some(pipeline => pipeline.id !== options.pipelineId && pipeline.name === nextName)) {
		return {
			ok: false,
			error: t('settings', 'pipelineAlreadyExists', { name: nextName }),
			invalidControl: { kind: 'pipeline-name' },
		};
	}

	const oldPipeline = options.pipelines.find(pipeline => pipeline.id === options.pipelineId);
	if (!oldPipeline) return { ok: false, error: t('settings', 'pipelineRepairPipelineMissing') };
	const oldSnapshot = {
		pipelines: options.pipelines.map(pipeline => clonePipeline(pipeline)),
		defaultPipelineName: options.defaultPipelineName,
	};
	const newSnapshot = {
		pipelines: options.pipelines.map(pipeline => clonePipeline(pipeline)),
		defaultPipelineName: options.defaultPipelineName,
	};
	const repairedPipeline = newSnapshot.pipelines.find(pipeline => pipeline.id === options.pipelineId)!;
	repairedPipeline.name = nextName;
	for (const status of repairedPipeline.statuses) {
		const nextLabel = (options.nextStatusLabels?.get(status.id) ?? status.label).trim();
		if (!nextLabel) {
			return {
				ok: false,
				error: t('settings', 'pipelineRepairStatusLabelRequired'),
				invalidControl: { kind: 'status-label', statusId: status.id },
			};
		}
		status.label = nextLabel;
	}
	const firstStatusIdByLabel = new Map<string, string>();
	for (const status of repairedPipeline.statuses) {
		if (firstStatusIdByLabel.has(status.label)) {
			return {
				ok: false,
				error: t('settings', 'pipelineRepairStatusLabelsUnique'),
				invalidControl: { kind: 'status-label', statusId: status.id },
			};
		}
		firstStatusIdByLabel.set(status.label, status.id);
	}

	const defaultCandidates = options.pipelines.filter(
		pipeline => pipeline.name === options.defaultPipelineName,
	);
	if (defaultCandidates.length > 1 && !options.defaultPipelineId) {
		return {
			ok: false,
			error: t('settings', 'pipelineRepairChooseDefaultError'),
			invalidControl: { kind: 'default-pipeline' },
		};
	}
	if (
		defaultCandidates.length > 1
		&& !defaultCandidates.some(pipeline => pipeline.id === options.defaultPipelineId)
	) {
		return {
			ok: false,
			error: t('settings', 'pipelineRepairChooseDefaultError'),
			invalidControl: { kind: 'default-pipeline' },
		};
	}
	const defaultPipelineId = (defaultCandidates.length > 1 ? options.defaultPipelineId : defaultCandidates[0]?.id)
		?? defaultCandidates[0]?.id
		?? options.pipelines[0]?.id
		?? '';
	const nextDefaultPipeline = newSnapshot.pipelines.find(pipeline => pipeline.id === defaultPipelineId);
	newSnapshot.defaultPipelineName = nextDefaultPipeline?.name ?? '';
	if (JSON.stringify(oldSnapshot) === JSON.stringify(newSnapshot)) {
		return { ok: false, error: t('settings', 'pipelineRepairNoChanges') };
	}

	const currentIssues = new Set(
		validatePipelineTaxonomy(options.pipelines).issues
			.filter(issue => !issue.destructive)
			.map(issue => `${issue.code}|${issue.path}|${issue.value ?? ''}`),
	);
	const createsIssue = validatePipelineTaxonomy(newSnapshot.pipelines).issues
		.filter(issue => !issue.destructive)
		.some(issue => !currentIssues.has(`${issue.code}|${issue.path}|${issue.value ?? ''}`));
	if (createsIssue) return { ok: false, error: t('settings', 'pipelineCanonicalCollision') };

	const identityIndex = buildWorkflowStatusIdentityIndex(options.pipelines);
	const unresolvedTaskIds: string[] = [];
	const taskMappings: PrepareWorkflowFieldRenameInput['taskMappings'] = [];
	for (const task of options.tasks) {
		const oldValue = task.fieldValues.status?.trim() ?? '';
		if (!oldValue) continue;
		const resolution = resolveConfiguredStatusIdentity(oldValue, identityIndex);
		let targetPipelineId = '';
		let targetStatusId = '';
		if (resolution.kind === 'configured') {
			if (resolution.pipeline.id !== options.pipelineId) continue;
			targetPipelineId = resolution.pipeline.id;
			targetStatusId = resolution.status.id;
		} else if (resolution.kind === 'ambiguous') {
			if (!resolution.matches.some(match => match.pipeline.id === options.pipelineId)) continue;
			const targetKey = options.taskTargetKeys.get(task.operonId) ?? '';
			const selected = resolution.matches.find(match => (
				composeRepairTargetKey(match.pipeline.id, match.status.id) === targetKey
			));
			if (!selected) {
				unresolvedTaskIds.push(task.operonId);
				continue;
			}
			targetPipelineId = selected.pipeline.id;
			targetStatusId = selected.status.id;
		} else {
			continue;
		}

		const targetPipeline = newSnapshot.pipelines.find(pipeline => pipeline.id === targetPipelineId);
		const targetStatus = targetPipeline?.statuses.find(status => status.id === targetStatusId);
		if (!targetPipeline || !targetStatus) {
			unresolvedTaskIds.push(task.operonId);
			continue;
		}
		const newValue = composeStatusValue(targetPipeline.name, targetStatus.label);
		if (newValue === oldValue) continue;
		taskMappings.push({
			operonId: task.operonId,
			filePath: task.primary.filePath,
			format: task.primary.format,
			oldValue,
			newValue,
		});
	}
	if (unresolvedTaskIds.length > 0) {
		return {
			ok: false,
			error: t('settings', 'pipelineRepairResolveAllTasks'),
			unresolvedTaskIds,
		};
	}

	return {
		ok: true,
		input: {
			id: options.operationId,
			oldSnapshot,
			newSnapshot,
			taskMappings,
		},
	};
}

function suggestUniquePipelineName(
	pipeline: Pipeline,
	pipelines: Pipeline[],
	existingNames: string[],
): string {
	const base = pipeline.name.replace(/\.+/gu, ' ').replace(/\s+/gu, ' ').trim() || 'Pipeline';
	const otherNames = new Set(
		existingNames.filter((_name, index) => pipelines[index]?.id !== pipeline.id),
	);
	if (!otherNames.has(base)) return base;
	let suffix = 2;
	while (otherNames.has(`${base} ${suffix}`)) suffix += 1;
	return `${base} ${suffix}`;
}

function composeRepairTargetKey(pipelineId: string, statusId: string): string {
	return `${pipelineId}\u0000${statusId}`;
}
