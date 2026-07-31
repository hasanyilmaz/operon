import type {
	OperonCatalogV1,
	PlacementCandidateRequestV1,
	PlacementCandidatesV1,
	PlacementLineCandidateV1,
	TaskContextV1,
} from '../../../src/agent-runtime/contracts/v1';
import type {
	GuidedMaintenanceResultV1,
	GuidedMutationIntentV1,
} from './guided-maintenance';
import { sanitizeTerminalTextV1 } from './terminal-text';
import type { InteractiveTerminalPortV1 } from './terminal-port';

interface ChoiceV1<T> {
	label: string;
	description?: string;
	value: T;
}

type LiveCatalogV1 = Extract<OperonCatalogV1, { ok: true }>;

export type PlacementCandidateLoaderV1 = (
	request: PlacementCandidateRequestV1,
) => Promise<PlacementCandidatesV1 | null>;

export async function runGuidedRelocateWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	loadPlacement: PlacementCandidateLoaderV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { task, port } = options;
	if (task.representation !== 'inline' || task.locator.representation !== 'inline') {
		throw new Error('GUIDED_INLINE_TASK_REQUIRED');
	}
	port.write(`Move inline Operon task\n\nTask: ${display(task.description)}\n\n`);
	const destination = await choosePlacement(port, options.loadPlacement);
	if (!destination) return cancelled('Inline task relocation cancelled before preview.');
	const summary = [
		'Inline task relocation draft',
		`Task: ${display(task.description)}`,
		`From: ${displayLocator(task.locator)}`,
		`To: ${displayLocator(destination.locator)}`,
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Preview this move?', true) !== true) {
		return cancelled('Inline task relocation cancelled before preview.');
	}
	return ready(
		summary,
		task,
		{
			operation: 'relocate-inline',
			destination: {
				locator: destination.locator,
				mustBeBlank: true,
			},
		},
		'The user completed the guided Operon inline relocation flow.',
	);
}

export async function runGuidedConvertWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	catalog: OperonCatalogV1;
	loadPlacement: PlacementCandidateLoaderV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { task } = options;
	if (!options.catalog.ok) throw new Error('GUIDED_CATALOG_UNAVAILABLE');
	if (task.representation === 'inline' && task.locator.representation === 'inline') {
		return await runInlineToFile({ ...options, catalog: options.catalog });
	}
	if (task.representation === 'file' && task.locator.representation === 'file') {
		return await runFileToInline(options);
	}
	throw new Error('GUIDED_REPRESENTATION_UNAVAILABLE');
}

export async function runGuidedDeleteWizardV1(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { task, port } = options;
	port.write([
		'Delete exact Operon task',
		'',
		`Task: ${display(task.description)}`,
		`ID: ${display(task.identity.operonId)}`,
		`Source: ${displayLocator(task.locator)}`,
		task.representation === 'file'
			? 'Effect: the complete File Task will be moved to trash.'
			: 'Effect: the exact inline task line will be removed.',
		'Runtime preview will refuse deletion if the task still owns or participates in protected state.',
		'',
	].join('\n'));
	if (await askYesNo(port, 'Preview this exact deletion?', false) !== true) {
		return cancelled('Exact task deletion cancelled before preview.');
	}
	const summary = [
		'Exact task deletion draft',
		`Task: ${display(task.description)}`,
		`ID: ${display(task.identity.operonId)}`,
		`Source: ${displayLocator(task.locator)}`,
	].join('\n');
	return ready(
		summary,
		task,
		{ operation: 'delete', mode: 'delete-exact-task', cascade: false },
		'The user completed the guided Operon exact deletion preview flow.',
	);
}

async function runInlineToFile(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	catalog: LiveCatalogV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, task } = options;
	const policies = options.catalog.policies?.creation;
	if (!policies) throw new Error('GUIDED_CATALOG_UNAVAILABLE');
	const templateChoices = fileTemplateChoices(options.catalog, task);
	if (templateChoices.length === 0) throw new Error('GUIDED_TEMPLATE_UNAVAILABLE');
	port.write(`Convert inline task to File Task\n\nTask: ${display(task.description)}\n\n`);
	const templateId = await choose(port, 'File Task template', templateChoices, 0);
	if (!templateId) return cancelled('Task conversion cancelled before preview.');
	const configuredTarget = await askYesNo(port, 'Use the configured File Task target and generated name?', true);
	if (configuredTarget === null) return cancelled('Task conversion cancelled before preview.');
	let targetPath: string | undefined;
	if (!configuredTarget) {
		const value = await port.ask('Exact new vault-relative .md path (q to cancel): ');
		if (value === null || value.trim().toLowerCase() === 'q') {
			return cancelled('Task conversion cancelled before preview.');
		}
		targetPath = value.trim();
		if (!targetPath) throw new Error('GUIDED_TARGET_REQUIRED');
	}
	const summary = [
		'Inline to File Task conversion draft',
		`Task: ${display(task.description)}`,
		`Template: ${display(templateId)}`,
		`Target: ${targetPath ? display(targetPath) : 'configured File Task target'}`,
		'Operon ID will be preserved.',
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Preview this conversion?', true) !== true) {
		return cancelled('Task conversion cancelled before preview.');
	}
	return ready(
		summary,
		task,
		{
			operation: 'convert',
			from: 'inline',
			to: 'file',
			templateId,
			...(targetPath ? { targetPath } : {}),
		},
		'The user completed the guided Operon inline-to-file conversion flow.',
	);
}

async function runFileToInline(options: {
	port: InteractiveTerminalPortV1;
	task: TaskContextV1;
	loadPlacement: PlacementCandidateLoaderV1;
}): Promise<GuidedMaintenanceResultV1> {
	const { port, task } = options;
	port.write([
		'Convert File Task to inline task',
		'',
		`Task: ${display(task.description)}`,
		'This conversion trashes the source File Task and may lose content that cannot be represented inline.',
		'The exact loss manifest will be shown by Runtime preview.',
		'',
	].join('\n'));
	const destination = await choosePlacement(port, options.loadPlacement);
	if (!destination) return cancelled('Task conversion cancelled before preview.');
	const summary = [
		'File Task to inline conversion draft',
		`Task: ${display(task.description)}`,
		`From: ${displayLocator(task.locator)}`,
		`To: ${displayLocator(destination.locator)}`,
		'Source File Task: move to trash after target insertion',
	].join('\n');
	port.write(`\n${summary}\n`);
	if (await askYesNo(port, 'Create a destructive preview?', false) !== true) {
		return cancelled('Task conversion cancelled before preview.');
	}
	return ready(
		summary,
		task,
		{
			operation: 'convert',
			from: 'file',
			to: 'inline',
			target: {
				mode: 'exact-line',
				filePath: destination.locator.filePath,
				lineNumber: destination.locator.lineNumber,
			},
		},
		'The user completed the guided Operon file-to-inline conversion preview flow.',
	);
}

async function choosePlacement(
	port: InteractiveTerminalPortV1,
	loadPlacement: PlacementCandidateLoaderV1,
): Promise<PlacementLineCandidateV1 | null> {
	while (true) {
		const rawQuery = await port.ask('Search target notes (blank lists candidates, q cancels): ');
		if (rawQuery === null || rawQuery.trim().toLowerCase() === 'q') return null;
		const query = rawQuery.trim();
		const filePage = await loadPlacement({
			mode: 'files',
			...(query ? { query } : {}),
		});
		if (!filePage) return null;
		if (filePage.mode !== 'files') throw new Error('GUIDED_PLACEMENT_UNAVAILABLE');
		if (filePage.files.length === 0) {
			port.write('No matching target note was found. Try another search.\n');
			continue;
		}
		if (filePage.truncated) {
			port.write(`Showing ${filePage.returnedCount} of ${filePage.actualCount} notes. Refine the search if needed.\n`);
		}
		const filePath = await choose(port, 'Target note', filePage.files.map(file => ({
			label: file.noteName,
			description: file.filePath,
			value: file.filePath,
		})), 0);
		if (!filePath) return null;
		const linePage = await loadPlacement({ mode: 'lines', filePath });
		if (!linePage) return null;
		if (linePage.mode !== 'lines' || linePage.filePath !== filePath) {
			throw new Error('GUIDED_PLACEMENT_UNAVAILABLE');
		}
		if (linePage.lines.length === 0) {
			port.write('That note has no eligible blank Markdown-body line. Choose another note.\n');
			continue;
		}
		if (linePage.truncated) {
			port.write(`Showing ${linePage.returnedCount} of ${linePage.actualCount} blank lines.\n`);
		}
		const line = await choose(port, 'Exact blank target line', linePage.lines.map(candidate => ({
			label: `Line ${candidate.locator.lineNumber + 1}`,
			description: candidate.heading
				? `${candidate.heading} — ${candidate.contextLabel}`
				: candidate.contextLabel,
			value: candidate,
		})), 0);
		if (line) return line;
		return null;
	}
}

function fileTemplateChoices(
	catalog: LiveCatalogV1,
	task: TaskContextV1,
): ChoiceV1<string>[] {
	const choices: ChoiceV1<string>[] = [];
	const seen = new Set<string>();
	const configured = catalog.policies.creation.defaultFileTemplateId?.trim();
	if (configured) {
		seen.add(configured);
		choices.push({
			label: 'Configured default template',
			description: configured,
			value: configured,
		});
	}
	const pipelineLabelById = new Map(
		catalog.taxonomy.pipelines.map(pipeline => [pipeline.id, pipeline.name]),
	);
	const candidates = [...catalog.policies.creation.builtInTemplateCandidates]
		.sort((left, right) => (
			Number(left.pipelineId !== task.workflow?.pipeline.id)
				- Number(right.pipelineId !== task.workflow?.pipeline.id)
			|| left.pipelineId.localeCompare(right.pipelineId)
		));
	for (const candidate of candidates) {
		if (seen.has(candidate.id)) continue;
		seen.add(candidate.id);
		choices.push({
			label: `${pipelineLabelById.get(candidate.pipelineId) ?? candidate.pipelineId} minimal template`,
			description: candidate.id,
			value: candidate.id,
		});
	}
	return choices;
}

function ready(
	summary: string,
	task: TaskContextV1,
	spec: Record<string, unknown>,
	reason: string,
): GuidedMaintenanceResultV1 {
	const intent: GuidedMutationIntentV1 = {
		contractVersion: 1,
		kind: 'mutation-intent',
		reason,
		target: {
			operonId: task.identity.operonId,
			locator: task.locator,
		},
		spec,
	};
	return { status: 'ready', summary, intent };
}

function cancelled(message: string): GuidedMaintenanceResultV1 {
	return { status: 'cancelled', message };
}

async function choose<T>(
	port: InteractiveTerminalPortV1,
	label: string,
	choices: ChoiceV1<T>[],
	defaultIndex: number,
): Promise<T | undefined> {
	if (choices.length === 0) return undefined;
	port.write(`${label}:\n`);
	choices.forEach((choice, index) => {
		port.write(`  ${index + 1}. ${display(choice.label)}${index === defaultIndex ? ' (default)' : ''}\n`);
		if (choice.description) port.write(`     ${display(choice.description)}\n`);
	});
	while (true) {
		const answer = await port.ask('> ');
		if (answer === null || answer.trim().toLowerCase() === 'q') return undefined;
		const normalized = answer.trim();
		const index = normalized === '' ? defaultIndex : Number.parseInt(normalized, 10) - 1;
		if (Number.isSafeInteger(index) && index >= 0 && index < choices.length) {
			return choices[index].value;
		}
		port.write(`Choose 1-${choices.length}, or q to cancel.\n`);
	}
}

async function askYesNo(
	port: InteractiveTerminalPortV1,
	prompt: string,
	defaultValue: boolean,
): Promise<boolean | null> {
	while (true) {
		const answer = await port.ask(`${prompt} ${defaultValue ? '[Y/n]' : '[y/N]'} `);
		if (answer === null || answer.trim().toLowerCase() === 'q') return null;
		const normalized = answer.trim().toLowerCase();
		if (!normalized) return defaultValue;
		if (normalized === 'y' || normalized === 'yes') return true;
		if (normalized === 'n' || normalized === 'no') return false;
		port.write('Enter y, n, or q to cancel.\n');
	}
}

function display(value: string | number | boolean | null | undefined): string {
	const characters = Array.from(sanitizeTerminalTextV1(String(value ?? '')));
	return characters.length <= 240 ? characters.join('') : `${characters.slice(0, 239).join('')}…`;
}

function displayLocator(locator: TaskContextV1['locator']): string {
	return locator.representation === 'inline'
		? `${display(locator.filePath)}:${locator.lineNumber + 1}`
		: display(locator.filePath);
}
