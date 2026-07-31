import type { CliResultEnvelopeV1 } from '../../../src/agent-runtime/contracts/v1';
import { sanitizeTerminalTextV1 } from './terminal-text';

const ROW_LIMIT = 50;
const OUTPUT_LINE_LIMIT = 200;
const OUTPUT_CHARACTER_LIMIT = 65_536;
const DESCRIPTION_LIMIT = 100;
const PROCESS_DIAGNOSTIC_LIMIT = 240;
const LABEL_LIMIT = 48;
const PATH_LIMIT = 72;

export function renderHumanV1(envelope: CliResultEnvelopeV1): string {
	return renderHumanWithOptionsV1(envelope);
}

export function renderHumanWithOptionsV1(
	envelope: CliResultEnvelopeV1,
	options: { suppressMutationRecovery?: boolean } = {},
): string {
	if (!envelope.ok) {
		const lines = [
			`Operon CLI failed at ${safe(envelope.failure.stage, LABEL_LIMIT)}: `
				+ safe(envelope.failure.error.reason, DESCRIPTION_LIMIT),
		];
		const details = record(envelope.failure.error.details);
		if (typeof details.diagnosticSummary === 'string') {
			lines.push(`Diagnostic: ${safe(details.diagnosticSummary, PROCESS_DIAGNOSTIC_LIMIT)}`);
		}
		if (
			envelope.command === 'mutation.apply'
			&& envelope.client?.planRef
			&& !options.suppressMutationRecovery
		) {
			lines.push(
				'Do not retry or create a replacement mutation. Recover the same plan with:',
				`  operon plan recover ${safe(envelope.client.planRef, LABEL_LIMIT)}`,
			);
		}
		return finish(lines, envelope);
	}
	const result = record(envelope.result);
	let lines: string[];
	switch (envelope.command) {
		case 'health': lines = renderHealth(result); break;
		case 'capabilities': lines = renderCapabilities(envelope.result); break;
		case 'diagnostics': lines = renderDiagnostics(result); break;
		case 'catalog': lines = renderCatalog(result); break;
		case 'entity.resolve': lines = renderEntityResolution(result); break;
		case 'task.get': lines = renderTaskGet(result); break;
		case 'tasks.query': lines = renderTaskQuery(result); break;
		case 'tasks.finder': lines = renderTaskFinder(result); break;
		case 'relationships.get': lines = renderRelationships(result); break;
		case 'context.build': lines = renderContext(result); break;
		case 'timers.read': lines = renderTimer(result); break;
		case 'mutation.preview': lines = renderMutationPreview(result, envelope.client?.planRef); break;
		case 'mutation.apply': lines = renderMutationResult(result, envelope.client?.planRef); break;
		default: lines = ['Operon CLI command completed.'];
	}
	if (envelope.command === 'health' || envelope.command === 'diagnostics') {
		const runtime = record(envelope.runtime);
		const plugin = record(runtime.plugin);
		const compatibility = record(envelope.compatibility);
		if (Object.keys(plugin).length > 0) {
			lines.push(`Plugin: ${safe(plugin.id, LABEL_LIMIT)} ${safe(plugin.version, LABEL_LIMIT)}`);
		}
		if (Object.keys(compatibility).length > 0) {
			lines.push(
				`Compatibility: ${compatibility.compatible === true ? 'compatible' : 'incompatible'}`
					+ ` (Runtime API ${number(compatibility.runtimeApi)}, CLI contract ${number(envelope.cliContract)})`,
			);
		}
	}
	appendFreshness(lines, result);
	appendTruncations(lines, result);
	if (envelope.client?.profile) lines.push(`Profile: ${safe(envelope.client.profile, LABEL_LIMIT)}`);
	const additionalWarnings = records(result.warnings);
	if (envelope.command === 'mutation.preview') {
		additionalWarnings.push(...records(record(result.plan).warnings));
	}
	return finish(lines, envelope, additionalWarnings);
}

export function renderLocalHumanV1(command: string, result: unknown, fallback: string): string {
	const value = record(result);
	if (command === 'profile.list') {
		const profiles = records(value.profiles);
		const lines = [`Operon profiles: ${profiles.length}`];
		for (const profile of profiles.slice(0, ROW_LIMIT)) {
			const name = scalar(profile.name, 'unnamed');
			const marker = name === value.defaultProfile ? ' (default)' : '';
			lines.push(`- ${safe(name, LABEL_LIMIT)}${marker} | ${safe(profile.canonicalPath, PATH_LIMIT)} | verified ${safe(profile.verifiedAt, LABEL_LIMIT)}`);
		}
		appendOmitted(lines, profiles.length);
		return finalizeLines(lines);
	}
	if (command === 'doctor') return finalizeLines(renderDoctor(value));
	if (command === 'plan.show') {
		const planRef = scalar(value.planRef);
		const lines = renderPlan(record(value.plan), planRef, scalar(value.expiresAt), true);
		const lastOutcome = record(value.lastOutcome);
		if (Object.keys(lastOutcome).length > 0) {
			lines.push('', 'Last outcome:', ...renderMutationResult(lastOutcome, planRef).map(line => `  ${line}`));
		}
		return finalizeLines(lines);
	}
	return finalizeLines([safe(fallback, 240)]);
}

function renderHealth(result: Record<string, unknown>): string[] {
	const admission = record(result.admission);
	const lines = [
		'Operon Runtime',
		`Phase: ${safe(result.lifecyclePhase, LABEL_LIMIT)}`,
		`Coherence: ${coherence(result)}`,
		`V8 persistence: ${safe(result.v8PersistencePhase, LABEL_LIMIT)}`,
		`Admission: reads ${yesNo(admission.reads)}, writes ${yesNo(admission.writes)}`,
		`Capabilities: ${availabilitySummary(result.capabilities)}`,
	];
	if (result.retryAfterMs !== undefined) lines.push(`Retry after: ${number(result.retryAfterMs)} ms`);
	return lines;
}

function renderDiagnostics(result: Record<string, unknown>): string[] {
	const health = record(result.health);
	const transport = record(result.transport);
	const catalog = record(result.catalog);
	const lines = [
		'Operon diagnostics',
		`Runtime: ${safe(health.lifecyclePhase, LABEL_LIMIT)} (${coherence(health)})`,
		`V8 persistence: ${safe(health.v8PersistencePhase, LABEL_LIMIT)}`,
		`Transport: ${safe(transport.channel, LABEL_LIMIT)} (${transport.available === true ? 'available' : 'unavailable'})`,
		`Capabilities: ${availabilitySummary(result.capabilities)}`,
	];
	if (Object.keys(catalog).length > 0) {
		lines.push(`Catalog: ${number(catalog.pipelineCount)} pipelines, ${number(catalog.priorityCount)} priorities, ${number(catalog.fieldCount)} fields`);
	}
	return lines;
}

function renderCapabilities(value: unknown): string[] {
	const capabilities = records(value);
	const lines = [`Operon capabilities: ${availabilitySummary(capabilities)}`, 'ID | Availability | Reason'];
	for (const item of capabilities.slice(0, ROW_LIMIT)) {
		lines.push([
			safe(item.id, LABEL_LIMIT),
			safe(item.availability, LABEL_LIMIT),
			safe(item.reason, DESCRIPTION_LIMIT, '-'),
		].join(' | '));
	}
	appendOmitted(lines, capabilities.length);
	return lines;
}

function renderCatalog(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon catalog', result);
	const taxonomy = record(result.taxonomy);
	const pipelines = records(taxonomy.pipelines);
	const priorities = records(taxonomy.priorities);
	const fields = records(result.fields);
	const lines = [`Operon catalog: ${pipelines.length} pipelines, ${priorities.length} priorities, ${fields.length} fields`, '', 'Pipelines:'];
	for (const pipeline of pipelines.slice(0, ROW_LIMIT)) {
		lines.push(`- ${safe(pipeline.name, LABEL_LIMIT)} [${safe(pipeline.id, LABEL_LIMIT)}] — ${safe(pipeline.description, DESCRIPTION_LIMIT, 'No description')}`);
		const statuses = records(pipeline.statuses);
		for (const status of statuses.slice(0, ROW_LIMIT)) {
			const terminal = status.isFinished === true ? 'finished' : status.isCancelled === true ? 'cancelled' : 'open';
			lines.push(`  - ${safe(status.label, LABEL_LIMIT)} [${safe(status.id, LABEL_LIMIT)}] | ${terminal}`);
		}
		if (statuses.length > ROW_LIMIT) lines.push(`  … ${statuses.length - ROW_LIMIT} more statuses omitted; use --json for complete data.`);
	}
	appendOmitted(lines, pipelines.length);
	lines.push('', 'Priorities:');
	for (const priority of priorities.slice(0, ROW_LIMIT)) {
		const marker = priority.isDefault === true ? ' (default)' : '';
		lines.push(`- ${safe(priority.label, LABEL_LIMIT)} [${safe(priority.id, LABEL_LIMIT)}]${marker} — ${safe(priority.description, DESCRIPTION_LIMIT, 'No description')}`);
	}
	appendOmitted(lines, priorities.length);
	lines.push('', 'Fields:', 'Name | Key | Type | Source | Mutation owner | Description');
	for (const field of fields.slice(0, ROW_LIMIT)) {
		lines.push([
			safe(field.displayName, LABEL_LIMIT),
			safe(field.canonicalKey, LABEL_LIMIT),
			safe(field.valueType, LABEL_LIMIT),
			safe(field.source, LABEL_LIMIT),
			safe(field.mutationOwner ?? field.mutationClass, LABEL_LIMIT),
			safe(field.description, DESCRIPTION_LIMIT, '-'),
		].join(' | '));
	}
	appendOmitted(lines, fields.length);
	return lines;
}

function renderEntityResolution(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon entity resolution', result);
	const candidates = records(result.candidates);
	const lines = [
		'Operon entity resolution',
		`Resolution: ${safe(result.resolution, LABEL_LIMIT)}`,
		`Candidates: ${candidates.length}`,
		'ID | Task | Representation | Source | Confidence | Reasons',
	];
	for (const candidate of candidates.slice(0, ROW_LIMIT)) {
		const identity = record(candidate.identity);
		lines.push([
			safe(identity.operonId, LABEL_LIMIT),
			safe(candidate.description, DESCRIPTION_LIMIT),
			safe(record(candidate.locator).representation, LABEL_LIMIT),
			formatLocator(candidate.locator),
			formatConfidence(candidate.confidence),
			boundedList(candidate.reasons),
		].join(' | '));
		if (identity.mutationAllowed === false) {
			lines.push(`  Mutation unavailable: ${safe(identity.validity, LABEL_LIMIT)}`);
		}
	}
	appendOmitted(lines, candidates.length);
	return lines;
}

function renderTaskGet(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon task read', result);
	return ['Operon task', ...renderTaskDetails(record(result.task))];
}

function renderTaskQuery(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon query', result);
	const tasks = records(result.tasks);
	const page = record(result.page);
	const lines = [
		`Operon query: ${number(page.returnedCount)}/${number(page.actualCount)} tasks`,
		`As of: ${safe(page.asOf, LABEL_LIMIT)}`,
		'ID | Task | Status | Priority | Due | Source',
	];
	appendTaskRows(lines, tasks);
	if (page.nextCursor !== undefined) lines.push('More results are available; use --json to continue with the returned cursor.');
	return lines;
}

function renderTaskFinder(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon Task Finder', result);
	const rows = records(result.rows);
	const page = record(result.page);
	const lines = [
		`Operon Task Finder: ${number(page.returnedCount)}/${number(page.actualCount)} rows`,
		`As of: ${safe(page.asOf, LABEL_LIMIT)}`,
		'Kind | ID | Task | Status | Priority | Score | Source',
	];
	for (const row of rows.slice(0, ROW_LIMIT)) {
		const task = record(row.task);
		const identity = record(task.identity);
		const workflow = record(task.workflow);
		const status = record(workflow.status);
		const priority = record(task.priority);
		lines.push([
			safe(row.kind, LABEL_LIMIT),
			safe(identity.operonId, LABEL_LIMIT),
			safe(task.description, DESCRIPTION_LIMIT),
			safe(status.label ?? task.checkbox, LABEL_LIMIT),
			safe(priority.label, LABEL_LIMIT, '-'),
			safe(row.score, LABEL_LIMIT),
			formatLocator(task.locator),
		].join(' | '));
		if (row.kind === 'project') {
			lines.push(
				`  Project counts: ${number(row.visibleDirectTaskCount)} visible including root, `
					+ `${number(row.directTaskCount)} direct children; `
					+ `${number(row.visibleTreeTaskCount)} visible including root, `
					+ `${number(row.treeTaskCount)} descendants`,
			);
		}
	}
	appendOmitted(lines, rows.length);
	if (page.nextCursor !== undefined) lines.push('More results are available; use --json to continue with the returned cursor.');
	return lines;
}

function renderRelationships(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon relationships', result);
	const relationships = record(result.relationships);
	const lines = ['Operon relationships'];
	for (const group of ['explicit', 'derived', 'inferred']) {
		const edges = records(relationships[group]);
		lines.push('', `${capitalize(group)} (${edges.length}):`, 'Kind | Source | Target | Reason | Confidence');
		for (const edge of edges.slice(0, ROW_LIMIT)) {
			lines.push([
				safe(edge.kind, LABEL_LIMIT),
				safe(edge.sourceOperonId, LABEL_LIMIT),
				safe(edge.targetOperonId, LABEL_LIMIT),
				safe(edge.reason, DESCRIPTION_LIMIT),
				formatConfidence(edge.confidence),
			].join(' | '));
		}
		appendOmitted(lines, edges.length);
	}
	const tasks = records(result.tasks);
	if (tasks.length > 0) {
		lines.push('', `Related tasks (${tasks.length}):`, 'ID | Task | Status | Priority | Due | Source');
		appendTaskRows(lines, tasks);
	}
	return lines;
}

function renderContext(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon context', result);
	const entities = records(result.entities);
	const relationships = record(result.relationships);
	const query = record(result.query);
	const lines = [
		'Operon Context Pack',
		`Projection: ${safe(result.projection, LABEL_LIMIT)}`,
		`Purpose: ${safe(result.purpose, LABEL_LIMIT)}`,
		`Entities: ${entities.length}`,
		`Relationships: ${relationshipCount(relationships)}`,
		`Catalog: ${result.catalog === undefined ? 'not included' : 'included'}`,
		`Policies: ${result.policies === undefined ? 'not included' : 'included'}`,
	];
	if (result.asOf !== undefined) lines.push(`As of: ${safe(result.asOf, LABEL_LIMIT)}`);
	const summary = record(result.summary);
	if (Object.keys(summary).length > 0) {
		lines.push(
			`Summary: ${number(summary.openCount)} open, ${number(summary.doneCount)} done, `
				+ `${number(summary.cancelledCount)} cancelled; ${number(summary.entityCount)} entities, `
				+ `${number(summary.relationshipCount)} relationships`,
		);
	}
	if (Object.keys(query).length > 0) {
		lines.push(`Query page: ${number(query.returnedCount)}/${number(query.actualCount)} tasks`);
		if (query.nextCursor !== undefined) lines.push('More results are available; use --json to continue with the returned cursor.');
	}
	if (entities.length > 0) {
		lines.push('', 'ID | Task | Status | Priority | Due | Source');
		appendTaskRows(lines, entities);
	}
	appendContextRelationshipRows(lines, relationships);
	return lines;
}

function renderTimer(result: Record<string, unknown>): string[] {
	if (result.ok === false) return failureLines('Operon timer', result);
	const state = record(result.state);
	const transition = record(state.transition);
	if (Object.keys(transition).length > 0) {
		return [
			'Operon timer',
			`State: ${safe(transition.kind, LABEL_LIMIT)}`,
			`Task: ${safe(transition.operonId, LABEL_LIMIT, 'unassigned')}`,
			`Started: ${safe(transition.start, LABEL_LIMIT)}`,
		];
	}
	const active = record(state.active);
	if (Object.keys(active).length === 0) return ['Operon timer', 'State: idle'];
	return [
		'Operon timer',
		`State: ${active.isUnassigned === true ? 'active (unassigned)' : 'active (assigned)'}`,
		`Task: ${safe(active.operonId, LABEL_LIMIT, 'unassigned')}`,
		`Started: ${safe(active.start, LABEL_LIMIT)}`,
		`Elapsed: ${formatDuration(active.elapsedSeconds)}`,
	];
}

function renderMutationPreview(result: Record<string, unknown>, planRef?: string): string[] {
	if (result.ok === false) return failureLines('Operon mutation preview', result);
	return renderPlan(record(result.plan), planRef);
}

function renderPlan(
	plan: Record<string, unknown>,
	planRef?: string,
	storedExpiry?: string,
	includeWarnings = false,
): string[] {
	const targets = records(plan.targets);
	const effects = records(plan.predictedEffects);
	const lines = [
		'Operon mutation plan',
		`Plan reference: ${safe(planRef, LABEL_LIMIT, 'not stored')}`,
		`Mutation: ${safe(plan.mutationKind, LABEL_LIMIT)}`,
		`Risk: ${safe(plan.riskLevel, LABEL_LIMIT)}`,
		`Expires: ${safe(plan.expiresAt ?? storedExpiry, LABEL_LIMIT)}`,
		`Confirmation required: ${yesNo(plan.requiresConfirmation)}`,
	];
	const acknowledgements = array(plan.requiredAcknowledgements);
	if (acknowledgements.length > 0) lines.push(`Acknowledgements: ${boundedList(acknowledgements)}`);
	appendRequestedChange(lines, plan.spec);
	lines.push('', `Targets (${targets.length}):`);
	for (const target of targets.slice(0, ROW_LIMIT)) {
		lines.push(`- ${safe(target.operonId, LABEL_LIMIT, 'new task')} | ${formatLocator(target.locator, true)}`);
	}
	appendOmitted(lines, targets.length);
	lines.push('', `Predicted effects (${effects.length}):`);
	for (const effect of effects.slice(0, ROW_LIMIT)) {
		lines.push(`- ${safe(effect.action, LABEL_LIMIT)} ${safe(effect.resourceKind, LABEL_LIMIT)} ${safe(effect.resourceKey, 4_096)} — ${safe(effect.summary, DESCRIPTION_LIMIT)}`);
	}
	appendOmitted(lines, effects.length);
	appendAtomicGroups(lines, plan.atomicGroups);
	appendCreateEffects(lines, plan.createEffects);
	appendConversionEffect(lines, plan.conversionEffect);
	if (includeWarnings) appendWarningsList(lines, plan.warnings);
	return lines;
}

function appendAtomicGroups(lines: string[], value: unknown): void {
	const groups = records(value)
		.sort((left, right) => number(left.order) - number(right.order));
	if (groups.length === 0) return;
	lines.push('', `Atomic resource groups (${groups.length}):`);
	for (const group of groups.slice(0, ROW_LIMIT)) {
		const resources = records(group.resources);
		lines.push(
			`- ${safe(group.order, LABEL_LIMIT)}. ${safe(group.groupId, PATH_LIMIT)}`
				+ ` — ${resources.length} resource${resources.length === 1 ? '' : 's'}`,
		);
		for (const resource of resources.slice(0, 10)) {
			lines.push(
				`  - ${safe(resource.resourceKind, LABEL_LIMIT)} ${safe(resource.resourceKey, PATH_LIMIT)}`,
			);
		}
		if (resources.length > 10) lines.push(`  … ${resources.length - 10} more resources`);
	}
	appendOmitted(lines, groups.length);
}

function renderMutationResult(result: Record<string, unknown>, planRef?: string): string[] {
	const status = safe(result.status, LABEL_LIMIT, 'failed');
	const groups = records(result.groupResults);
	const postflight = record(result.postflight);
	const lines = [
		'Operon mutation result',
		`Status: ${status}`,
		`Plan reference: ${safe(planRef, LABEL_LIMIT, 'unavailable')}`,
		`May have applied: ${yesNo(result.mutationMayHaveApplied)}`,
		`Retry allowed: ${yesNo(result.retryAllowed)}`,
	];
	if (Object.keys(postflight).length > 0) {
		lines.push(`Postflight: ${safe(postflight.status, LABEL_LIMIT)}`);
		if (postflight.observedAt !== undefined) lines.push(`Verified at: ${safe(postflight.observedAt, LABEL_LIMIT)}`);
	}
	if (groups.length > 0) {
		lines.push('', 'Group | Status | Reason');
		for (const group of groups.slice(0, ROW_LIMIT)) {
			lines.push([
				safe(group.groupId, PATH_LIMIT),
				safe(group.status, LABEL_LIMIT),
				safe(record(group.error).reason, DESCRIPTION_LIMIT, '-'),
			].join(' | '));
		}
		appendOmitted(lines, groups.length);
	}
	if (
		status === 'partial'
		|| status === 'outcome-unknown'
		|| (status === 'failed' && result.mutationMayHaveApplied === true)
	) {
		lines.push('Do not retry or create a replacement mutation. Recover the same plan reference.');
	}
	if (result.error !== undefined) lines.push(`Error: ${safe(record(result.error).reason, DESCRIPTION_LIMIT)}`);
	return lines;
}

function renderDoctor(result: Record<string, unknown>): string[] {
	const platform = record(result.platform);
	const vault = record(result.vault);
	const plugin = record(result.plugin);
	const live = record(result.live);
	const lines = [
		'Operon doctor',
		`Platform: ${safe(platform.name, LABEL_LIMIT)} (${safe(platform.liveTransport, LABEL_LIMIT)})`,
		`Profile: ${safe(vault.profile, LABEL_LIMIT, 'explicit vault')}`,
		`Vault: ${safe(vault.canonicalPath, PATH_LIMIT)}`,
		`Plugin: ${safe(plugin.id, LABEL_LIMIT)} ${safe(plugin.version, LABEL_LIMIT)}`,
		`Runtime: ${Object.keys(live).length > 0 ? 'checked' : 'not requested'}`,
	];
	if (platform.liveTransport === 'acceptance-required') {
		lines.push(
			'Platform support: public beta / best-effort; this native environment is not certified.',
		);
	}
	const liveResult = record(live.result);
	const liveHealth = record(liveResult.health);
	if (Object.keys(liveHealth).length > 0) {
		lines.push(`Runtime phase: ${safe(liveHealth.lifecyclePhase, LABEL_LIMIT)} (${coherence(liveHealth)})`);
	}
	return lines;
}

function renderTaskDetails(task: Record<string, unknown>): string[] {
	const identity = record(task.identity);
	const workflow = record(task.workflow);
	const pipeline = record(workflow.pipeline);
	const status = record(workflow.status);
	const priority = record(task.priority);
	const dates = record(task.dates);
	const datetimes = record(task.datetimes);
	const relationships = record(task.relationships);
	const recurrence = record(task.recurrence);
	const tracker = record(task.tracker);
	const lines = [
		`ID: ${safe(identity.operonId, LABEL_LIMIT)}`,
		`Mutation eligibility: ${identity.mutationAllowed === false ? `blocked (${safe(identity.validity, LABEL_LIMIT)})` : 'eligible'}`,
		`Task: ${safe(task.description, DESCRIPTION_LIMIT)}`,
		`State: ${safe(task.checkbox, LABEL_LIMIT)}`,
		`Workflow: ${safe(pipeline.label, LABEL_LIMIT, '-')} / ${safe(status.label, LABEL_LIMIT, '-')}`,
		`Priority: ${safe(priority.label, LABEL_LIMIT, '-')}`,
		`Dates: due ${safe(dates.due, LABEL_LIMIT, '-')} | scheduled ${safe(dates.scheduled, LABEL_LIMIT, '-')} | started ${safe(dates.started, LABEL_LIMIT, '-')}`,
		`Datetimes: start ${safe(datetimes.start, LABEL_LIMIT, '-')} | end ${safe(datetimes.end, LABEL_LIMIT, '-')}`,
		`Representation: ${safe(task.representation, LABEL_LIMIT)}`,
		`Source: ${formatLocator(task.locator)}`,
		`Relations: parent ${safe(relationships.parentOperonId, LABEL_LIMIT, '-')} | children ${array(relationships.childOperonIds).length} | blocking ${array(relationships.blockingOperonIds).length} | blocked by ${array(relationships.blockedByOperonIds).length} | related ${array(relationships.relatedOperonIds).length}`,
		`Recurrence: ${recurrence.repeating === true ? `active (${safe(recurrence.seriesId, LABEL_LIMIT, 'series')})` : 'none'}`,
		`Tracker: ${tracker.active === true ? 'active' : 'inactive'} (${number(tracker.sessionCount)} sessions)`,
		`Pinned: ${yesNo(task.pinned)}`,
	];
	if ([
		'note',
		'links',
		'customFields',
		'sourceMarkdown',
		'trackerHistory',
		'reminderItems',
	].some(key => task[key] !== undefined)) {
		lines.push('Additional hydrated fields are omitted from human output; use --json for complete data.');
	}
	return lines;
}

function appendTaskRows(lines: string[], tasks: Record<string, unknown>[]): void {
	for (const task of tasks.slice(0, ROW_LIMIT)) {
		const identity = record(task.identity);
		const workflow = record(task.workflow);
		const status = record(workflow.status);
		const priority = record(task.priority);
		const dates = record(task.dates);
		lines.push([
			`${safe(identity.operonId, LABEL_LIMIT)}${identity.mutationAllowed === false ? ' !' : ''}`,
			safe(task.description, DESCRIPTION_LIMIT),
			safe(status.label ?? task.checkbox, LABEL_LIMIT, '-'),
			safe(priority.label, LABEL_LIMIT, '-'),
			safe(dates.due, LABEL_LIMIT, '-'),
			formatLocator(task.locator),
		].join(' | '));
	}
	appendOmitted(lines, tasks.length);
}

function appendCreateEffects(lines: string[], value: unknown): void {
	const effects = records(value);
	if (effects.length === 0) return;
	lines.push('', `Created tasks (${effects.length}):`);
	for (const effect of effects.slice(0, ROW_LIMIT)) {
		const dependencies = records(effect.resolvedDependencies);
		const bodySummary = record(effect.bodyMarkdownSummary);
		lines.push(
			`- ${safe(effect.operonId, LABEL_LIMIT)} | ${formatLocator(effect.locator, true)} | item ${safe(effect.itemRef, LABEL_LIMIT)}`
				+ (dependencies.length > 0 ? ` | dependencies ${dependencies.length}` : '')
				+ (typeof bodySummary.utf8Bytes === 'number'
					? ` | body ${number(bodySummary.utf8Bytes)} UTF-8 bytes`
					: ''),
		);
	}
	appendOmitted(lines, effects.length);
}

function appendConversionEffect(lines: string[], value: unknown): void {
	const effect = record(value);
	if (Object.keys(effect).length === 0) return;
	lines.push('', 'Conversion:');
	lines.push(`Direction: ${safe(effect.direction, LABEL_LIMIT)}`);
	lines.push(`Before: ${formatLocator(effect.beforeLocator, true)}`);
	lines.push(`After: ${formatLocator(effect.afterLocator, true)}`);
	lines.push(`Checkboxes carried: ${number(effect.checkboxCarryoverCount)}`);
	const diffs = records(effect.resolvedFieldDiff);
	if (diffs.length > 0) {
		lines.push('Resolved fields:');
		for (const diff of diffs.slice(0, ROW_LIMIT)) lines.push(`- ${safe(diff.field, LABEL_LIMIT)} (${safe(diff.source, LABEL_LIMIT)})`);
		appendOmitted(lines, diffs.length);
	}
	const losses = records(effect.lossManifest);
	if (losses.length > 0) {
		lines.push('Loss manifest:');
		for (const loss of losses.slice(0, ROW_LIMIT)) {
			lines.push(`- ${safe(loss.kind, LABEL_LIMIT)}${loss.key === undefined ? '' : `: ${safe(loss.key, LABEL_LIMIT)}`}`);
		}
		appendOmitted(lines, losses.length);
	}
}

function appendRequestedChange(lines: string[], value: unknown): void {
	const spec = record(value);
	const operation = scalar(spec.operation);
	if (!operation) return;
	lines.push('', 'Requested change:');
	switch (operation) {
		case 'create': {
			const items = records(spec.items);
			lines.push(`- Create ${items.length} task${items.length === 1 ? '' : 's'}`);
			for (const item of items.slice(0, 10)) {
				const target = record(item.target);
				const targetSummary = target.representation === undefined
					? safe(target.mode, LABEL_LIMIT)
					: `${safe(target.representation, LABEL_LIMIT)} | ${safe(target.mode, LABEL_LIMIT)}`;
				const dependencies = records(item.dependencies);
				lines.push(
					`  - ${safe(item.itemRef, LABEL_LIMIT)} | ${safe(item.description, DESCRIPTION_LIMIT)}`
						+ ` | ${targetSummary}`
						+ (dependencies.length > 0 ? ` | dependencies ${dependencies.length}` : '')
						+ (typeof item.bodyMarkdown === 'string' ? ' | body set (content omitted)' : ''),
				);
			}
			if (items.length > 10) lines.push(`  … ${items.length - 10} more task intents`);
			break;
		}
		case 'update': {
			const fields = records(spec.changes).map(change => change.field);
			lines.push(`- Update fields: ${boundedList(fields)}`);
			lines.push('- Field values are omitted from human output; use --json to inspect them.');
			break;
		}
		case 'add':
		case 'replace':
		case 'remove':
			lines.push(`- ${safe(operation, LABEL_LIMIT)} one ${safe(spec.collection, LABEL_LIMIT)} item`);
			lines.push('- Reminder values are omitted from human output; use --json to inspect them.');
			break;
		case 'transition':
			lines.push(`- Set status to stable ID ${safe(spec.targetStatusId, LABEL_LIMIT)}`);
			if (spec.expectedStatusId !== undefined) {
				lines.push(`- Expected current status: ${safe(spec.expectedStatusId, LABEL_LIMIT)}`);
			}
			if (records(spec.changes).length > 0) {
				lines.push(`- Also update fields: ${boundedList(records(spec.changes).map(change => change.field))}`);
			}
			break;
		case 'start':
		case 'stop':
			lines.push(`- ${capitalize(operation)} timer`);
			break;
		case 'relocate-inline':
			lines.push(`- Move inline task to ${formatLocator(record(spec.destination).locator, true)}`);
			break;
		case 'convert':
			lines.push(`- Convert ${safe(spec.from, LABEL_LIMIT)} to ${safe(spec.to, LABEL_LIMIT)}`);
			if (spec.templateId !== undefined) lines.push(`- Template: ${safe(spec.templateId, LABEL_LIMIT)}`);
			break;
		case 'delete':
			lines.push('- Delete the exact task target without cascade');
			break;
	}
}

function appendContextRelationshipRows(
	lines: string[],
	relationships: Record<string, unknown>,
): void {
	const groups = ['explicit', 'derived', 'inferred'] as const;
	if (groups.every(group => records(relationships[group]).length === 0)) return;
	lines.push('', 'Relationship details:');
	for (const group of groups) {
		const edges = records(relationships[group]);
		if (edges.length === 0) continue;
		lines.push(`${capitalize(group)} (${edges.length}):`);
		for (const edge of edges.slice(0, 10)) {
			lines.push(
				`- ${safe(edge.kind, LABEL_LIMIT)} | ${safe(edge.sourceOperonId, LABEL_LIMIT)} → `
					+ `${safe(edge.targetOperonId, LABEL_LIMIT)} | ${safe(edge.reason, DESCRIPTION_LIMIT)}`,
			);
		}
		if (edges.length > 10) lines.push(`… ${edges.length - 10} more ${group} relationships omitted.`);
	}
}

function appendFreshness(lines: string[], result: Record<string, unknown>): void {
	const freshness = record(result.freshness ?? result.execution);
	if (Object.keys(freshness).length === 0) return;
	lines.push(`Freshness: ${safe(freshness.source, LABEL_LIMIT)} / ${safe(freshness.coherence, LABEL_LIMIT)} / ${freshness.settled === true ? 'settled' : 'unsettled'}`);
}

function finish(
	lines: string[],
	envelope: CliResultEnvelopeV1,
	additionalWarnings: Record<string, unknown>[] = [],
): string {
	appendWarningsList(lines, [...envelope.warnings, ...additionalWarnings]);
	return finalizeLines(lines);
}

function finalizeLines(lines: string[]): string {
	const sanitized = lines.map(line => sanitizeTerminalTextV1(line));
	const lineBounded = sanitized.length <= OUTPUT_LINE_LIMIT
		? sanitized
		: [
			...sanitized.slice(0, OUTPUT_LINE_LIMIT - 21),
			`… ${sanitized.length - OUTPUT_LINE_LIMIT + 1} additional output lines omitted; use --json for complete data.`,
			...sanitized.slice(-20),
		];
	const joined = lineBounded.join('\n');
	const characters = [...joined];
	if (characters.length <= OUTPUT_CHARACTER_LIMIT) return joined;
	const tailCount = 16_384;
	const headCount = OUTPUT_CHARACTER_LIMIT - tailCount - 100;
	return [
		characters.slice(0, headCount).join(''),
		'\n… additional output omitted; use --json for complete data.\n',
		characters.slice(-tailCount).join(''),
	].join('');
}

function appendWarningsList(lines: string[], value: unknown): void {
	const warnings = records(value);
	const seen = new Set<string>();
	const uniqueWarnings = warnings.filter(warning => {
		const key = `${scalar(warning.code)}\u0000${scalar(warning.message)}`;
		if (seen.has(key)) return false;
		seen.add(key);
		return true;
	});
	const rendered = uniqueWarnings.slice(0, ROW_LIMIT).map(warning => (
		`- ${safe(warning.code, LABEL_LIMIT)}: ${safe(warning.message, DESCRIPTION_LIMIT)}`
	));
	if (rendered.length === 0) return;
	if (!lines.includes('Warnings:')) lines.push('Warnings:');
	lines.push(...rendered);
	appendOmitted(lines, uniqueWarnings.length);
}

function appendTruncations(lines: string[], result: Record<string, unknown>): void {
	const truncations = records(result.truncations);
	if (truncations.length === 0) return;
	lines.push('Truncations:');
	for (const item of truncations.slice(0, ROW_LIMIT)) {
		lines.push(`- ${safe(item.path, PATH_LIMIT)}: ${number(item.returnedCount)}/${number(item.actualCount)} (limit ${number(item.limit)})`);
	}
	appendOmitted(lines, truncations.length);
}

function failureLines(title: string, result: Record<string, unknown>): string[] {
	return [`${title} failed: ${safe(record(result.error).reason, DESCRIPTION_LIMIT, 'Runtime operation failed.')}`];
}

function formatLocator(value: unknown, exact = false): string {
	const locator = record(value);
	const path = exact ? exactPath(locator.filePath) : safe(locator.filePath, PATH_LIMIT, '-');
	return locator.representation === 'inline' ? `${path}:${number(locator.lineNumber) + 1}` : path;
}

function exactPath(value: unknown): string {
	const path = scalar(value, '-');
	return JSON.stringify(sanitizeTerminalTextV1(path));
}

function formatDuration(value: unknown): string {
	const seconds = typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
	const hours = Math.floor(seconds / 3_600);
	const minutes = Math.floor((seconds % 3_600) / 60);
	const remainder = seconds % 60;
	if (hours > 0) return `${hours}h ${minutes}m ${remainder}s`;
	if (minutes > 0) return `${minutes}m ${remainder}s`;
	return `${remainder}s`;
}

function formatConfidence(value: unknown): string {
	return typeof value === 'number' && Number.isFinite(value) ? value.toFixed(2) : '-';
}

function availabilitySummary(value: unknown): string {
	const items = records(value);
	const available = items.filter(item => item.availability === 'available').length;
	const degraded = items.filter(item => item.availability === 'degraded').length;
	const contractOnly = items.filter(item => item.availability === 'contract-only').length;
	const unavailable = items.length - available - degraded - contractOnly;
	return `${available}/${items.length} available, ${degraded} degraded, ${contractOnly} contract-only, ${unavailable} unavailable`;
}

function relationshipCount(value: Record<string, unknown>): number {
	return records(value.explicit).length + records(value.derived).length + records(value.inferred).length;
}

function coherence(result: Record<string, unknown>): string {
	return safe(record(result.freshness).coherence, LABEL_LIMIT, 'unverified');
}

function appendOmitted(lines: string[], actualCount: number): void {
	if (actualCount > ROW_LIMIT) lines.push(`… ${actualCount - ROW_LIMIT} more items omitted; use --json for complete data.`);
}

function safe(value: unknown, limit: number, fallback = 'unknown'): string {
	const normalized = sanitizeTerminalTextV1(scalar(value, fallback))
		.replace(/\|/gu, '¦')
		.replace(/\s+/gu, ' ')
		.trim();
	if (!normalized && fallback) return safe(fallback, limit, '');
	const characters = [...normalized];
	return characters.length <= limit ? normalized : `${characters.slice(0, Math.max(0, limit - 1)).join('')}…`;
}

function scalar(value: unknown, fallback = ''): string {
	if (typeof value === 'string') return value;
	if (typeof value === 'number' && Number.isFinite(value)) return String(value);
	if (typeof value === 'boolean') return String(value);
	return fallback;
}

function number(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

function yesNo(value: unknown): string {
	return value === true ? 'yes' : 'no';
}

function boundedList(value: unknown, limit = 10): string {
	const values = array(value);
	if (values.length === 0) return '-';
	const rendered = values.slice(0, limit).map(item => safe(item, LABEL_LIMIT)).join(', ');
	return values.length > limit ? `${rendered}, … ${values.length - limit} more` : rendered;
}

function record(value: unknown): Record<string, unknown> {
	if (value === null || typeof value !== 'object' || Array.isArray(value)) return {};
	const prototype = Reflect.getPrototypeOf(value);
	return prototype === Object.prototype || prototype === null ? value as Record<string, unknown> : {};
}

function records(value: unknown): Record<string, unknown>[] {
	return array(value).map(record).filter(item => Object.keys(item).length > 0);
}

function array(value: unknown): unknown[] {
	return Array.isArray(value) ? value : [];
}

function capitalize(value: string): string {
	return value.length === 0 ? value : `${value[0].toUpperCase()}${value.slice(1)}`;
}
