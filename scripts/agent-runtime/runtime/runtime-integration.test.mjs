import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import ts from 'typescript';

const mainSource = await readFile(new URL('../../../main.ts', import.meta.url), 'utf8');
const indexerSource = await readFile(new URL('../../../src/indexer/indexer.ts', import.meta.url), 'utf8');
const identityJournalSource = await readFile(
	new URL('../../../src/agent-runtime/runtime/identity-placeholder-journal.ts', import.meta.url),
	'utf8',
);
const taskWorkflowGatewaySource = await readFile(
	new URL('../../../src/agent-runtime/extensions/task-workflows-v1/gateway.ts', import.meta.url),
	'utf8',
);

function methodBody(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `Missing ${signature}`);
	const end = source.indexOf(nextSignature, start);
	assert.notEqual(end, -1, `Missing boundary ${nextSignature}`);
	return source.slice(start, end);
}

function identityGraphHarness() {
	const method = methodBody(
		mainSource,
		'\tprivate async prepareAgentRuntimeIdentityGraphSteps(',
		'\n\n\tprivate agentRuntimeIdentityGraphState',
	);
	const source = `
		class IdentityGraphHarness {
			constructor() {
				this.writer = {
					renderGuardedTaskSourceContent: (_filePath, content) => ({ ok: true, content, reason: 'none' }),
				};
				this.aggregateCoordinator = { planCreationAggregatePatches: () => [] };
			}
			${method}
			agentRuntimeIdentityGraphState(content) {
				return { state: content === null ? 'absent' : 'present', digest: 'test-digest', content };
			}
		}
	`;
	const transpiled = ts.transpileModule(source, {
		compilerOptions: { module: ts.ModuleKind.None, target: ts.ScriptTarget.ES2022 },
	}).outputText;
	const Harness = new Function('toLocalDatetime', `${transpiled}\nreturn IdentityGraphHarness;`)(value => value);
	return new Harness();
}

function graphPreparation(sourceGroup, parentResources = []) {
	return {
		plan: { sourceGroups: sourceGroup ? [sourceGroup] : [], tasks: [] },
		sourceGroupGraph: { sourceOrder: ['Periodic.md'] },
		parentResources,
		recurrenceResources: [],
	};
}

test('identity graph honors source expectedState before seeded content or parent fallbacks', async () => {
	const harness = identityGraphHarness();
	const absent = await harness.prepareAgentRuntimeIdentityGraphSteps(graphPreparation({
		filePath: 'Periodic.md',
		expectedState: 'absent',
		expectedContent: 'seeded periodic note',
		resultingContent: 'seeded periodic note with task',
	}), '2026-08-24T10:00:00.000Z');
	assert.equal(absent.ok, true);
	assert.equal(absent.steps[0].operation, 'create');
	assert.deepEqual(absent.steps[0].before, { state: 'absent', digest: 'test-digest', content: null });

	const present = await harness.prepareAgentRuntimeIdentityGraphSteps(graphPreparation({
		filePath: 'Periodic.md',
		expectedState: 'present',
		expectedContent: 'existing periodic note',
		resultingContent: 'existing periodic note with task',
	}), '2026-08-24T10:00:00.000Z');
	assert.equal(present.ok, true);
	assert.equal(present.steps[0].operation, 'modify');
	assert.deepEqual(present.steps[0].before, { state: 'present', digest: 'test-digest', content: 'existing periodic note' });

	const invalidPresent = await harness.prepareAgentRuntimeIdentityGraphSteps(graphPreparation({
		filePath: 'Periodic.md',
		expectedState: 'present',
		expectedContent: null,
		resultingContent: 'replacement content',
	}), '2026-08-24T10:00:00.000Z');
	assert.deepEqual(invalidPresent, {
		ok: false,
		reason: 'Present source group has no expected content: Periodic.md',
	});

	const parentFallback = await harness.prepareAgentRuntimeIdentityGraphSteps(graphPreparation(undefined, [{
		filePath: 'Periodic.md',
		sourceContent: 'parent resource content',
		operonId: 'par0001',
		format: 'yaml',
	}]), '2026-08-24T10:00:00.000Z');
	assert.equal(parentFallback.ok, true);
	assert.equal(parentFallback.steps[0].operation, 'modify');
	assert.deepEqual(parentFallback.steps[0].before, { state: 'present', digest: 'test-digest', content: 'parent resource content' });
});

test('publishes the Runtime facade synchronously before asynchronous plugin loading', () => {
	const onload = methodBody(mainSource, '\tonload(): void {', '\n\tprivate async initializeTablePresetRegistry');
	const firstStatement = onload
		.slice(onload.indexOf('{') + 1)
		.split('\n')
		.map(line => line.trim())
		.find(Boolean);
	assert.equal(firstStatement, 'this.initializeAgentRuntime();');
	assert.match(onload, /runAsyncAction\('plugin load failed'/u);
});

test('closes Runtime admission synchronously when unload begins', () => {
	const onunload = methodBody(mainSource, '\tonunload(): void {', '\n\tprivate async unloadPlugin');
	const firstStatement = onunload
		.slice(onunload.indexOf('{') + 1)
		.split('\n')
		.map(line => line.trim())
		.find(Boolean);
	assert.equal(firstStatement, 'this.agentRuntimeLifecycle.beginUnloading();');
});

test('does not announce ready before timer state is resumed', () => {
	const resumeOffset = mainSource.indexOf('await this.timeTracker.resumeFromIndex({ migrateLegacy: true });');
	const readyOffset = mainSource.indexOf('this.agentRuntimeLifecycle.markReady();', resumeOffset);
	assert.ok(resumeOffset >= 0);
	assert.ok(readyOffset > resumeOffset);
});

test('preserves bounded Gateway startup failure reasons in capability advertisements', () => {
	const initialization = methodBody(
		mainSource,
		'\tprivate initializeAgentRuntime(): void {',
		'\n\n\tprivate async bindAgentRuntimeServices',
	);
	const gatewayBinding = methodBody(
		mainSource,
		'\tprivate async bindAgentRuntimeMutationGateway(): Promise<void> {',
		'\n\n\tprivate async prepareAgentRuntimeSourceTransition',
	);
	assert.match(gatewayBinding, /receipt-store:\$\{detail \?\? receiptHealth\.reason\}/u);
	assert.match(gatewayBinding, /security-audit-store:health-check-failed/u);
	assert.match(gatewayBinding, /agentRuntimeGatewayStartupFailureReason = null/u);
	assert.match(initialization, /reason: this\.agentRuntimeGatewayStartupFailureReason/u);
	assert.match(mainSource, /gateway-bind:unexpected-failure/u);
	assert.doesNotMatch(initialization, /has not completed its startup gate/u);
});

test('binds freshness after index construction and marks only a usable cache ready', () => {
	const initialization = methodBody(
		mainSource,
		'\tprivate initializeAgentRuntime(): void {',
		'\n\n\tprivate async bindAgentRuntimeServices',
	);
	const construction = mainSource.indexOf('this.indexer = new OperonIndexer(');
	const binding = mainSource.indexOf('await this.bindAgentRuntimeServices();', construction);
	const cacheLoad = mainSource.indexOf('const cacheLoad = await this.indexer.loadCachedIndex();', binding);
	const cacheReady = mainSource.indexOf('if (hasCached) this.agentRuntimeLifecycle.markCacheReady();', cacheLoad);
	assert.ok(construction >= 0);
	assert.ok(binding > construction);
	assert.ok(cacheLoad > binding);
	assert.ok(cacheReady > cacheLoad);
	assert.match(initialization, /preservesBestEffortCache: true/u);
});

test('verified settlement waits for RAM work but not V8 persistence idle', () => {
	const settlement = methodBody(
		mainSource,
		'\tprivate async awaitAgentRuntimeSettlement(options:',
		'\n\n\tonload(): void {',
	);
	assert.match(settlement, /this\.indexer\.awaitRamSettlement\(\)/u);
	assert.match(settlement, /this\.awaitSettingsReindexSettlement\(\)/u);
	assert.match(settlement, /this\.indexSideEffectSettlement\.current\(\)/u);
	assert.match(settlement, /projectSerialIndexReconcileScheduler\?\.whenIdle/u);
	assert.match(settlement, /projectSerialIndexReconcileScheduler\?\.flushNow/u);
	assert.match(settlement, /hasError\('index-side-effects'\)/u);
	assert.match(settlement, /hasError\('project-serial'\)/u);
	assert.doesNotMatch(settlement, /getIndexV8RuntimePhase|await.*V8|persistence.*idle/iu);
	assert.equal(indexerSource.includes('Persistence-only queue'), true);
	assert.equal(indexerSource.includes('entries and V8 idle/drain state are intentionally outside this barrier.'), true);
});

test('semantic transition planning derives project-serial eligibility from the sealed catalog', () => {
	assert.match(
		mainSource,
		/hasProjectSerialScopes: \(\) => catalog\.value\.policies\.projectSerialScopes\.length > 0/u,
	);
});

test('semantic Runtime commits hand off a pipeline A-to-B change after their authoritative reindex', () => {
	const semanticStart = mainSource.indexOf("(preparedMutation.token as { kind?: unknown }).kind === 'semantic-transition-plan'");
	const semanticEnd = mainSource.indexOf("(preparedMutation.token as { kind?: unknown }).kind === 'timer'", semanticStart);
	assert.ok(semanticStart >= 0);
	assert.ok(semanticEnd > semanticStart);
	const semanticCommit = mainSource.slice(semanticStart, semanticEnd);
	const archiver = 'this.fileTaskArchiver?.scheduleForIndexedChange(beforeTask ?? null, aggregateAfterTask);';
	const mover = 'this.fileTaskPipelineMover?.scheduleForIndexedChange(beforeTask ?? null, aggregateAfterTask);';
	assert.ok(semanticCommit.includes('await this.indexer.forceReindexFilePathAfterMutation('));
	assert.ok(semanticCommit.includes('{ notify: false }'));
	assert.ok(semanticCommit.includes(archiver));
	assert.ok(semanticCommit.includes(mover));
	assert.ok(
		semanticCommit.indexOf(archiver) < semanticCommit.indexOf(mover),
		'pipeline A-to-B reconciliation follows the terminal archiver after Runtime semantic reindexing',
	);
});

test('health/settings freshness does not parse task data', () => {
	const freshness = methodBody(
		mainSource,
		'\tprivate async refreshAgentRuntimeSettingsBoundary(): Promise<void> {',
		'\n\n\tprivate recordAgentRuntimeFreshnessFailure',
	);
	assert.doesNotMatch(freshness, /getAllTasks|taskCount|parse|fullReindex/u);
});

test('Property Catalog uses coherent settings projection without task or Markdown hydration', () => {
	const catalogRead = methodBody(
		mainSource,
		'\tprivate async readAgentRuntimeCatalog(',
		'\n\n\tprivate async awaitAgentRuntimeSettlement',
	);
	assert.match(catalogRead, /agentRuntimeCoherentRead\.execute/u);
	assert.match(catalogRead, /this\.getAgentRuntimeCatalogBuild\(\)/u);
	const catalogBuild = methodBody(
		mainSource,
		'\tprivate getAgentRuntimeCatalogBuild(): CatalogBuildResultV1 {',
		'\n\n\tprivate requireAgentRuntimeCatalogProjection',
	);
	assert.match(
		catalogBuild,
		/buildLivePropertyCatalogV1\(this\.settings, \{ fileTaskTemplateCandidates \}\)/u,
	);
	const templateCandidates = methodBody(
		mainSource,
		'\tprivate getAgentRuntimeFileTaskTemplateCandidates(): FileTaskTemplateCandidateV1[] {',
		'\n\n\tprivate getFileTaskTemplateOptionsForPicker',
	);
	assert.match(templateCandidates, /this\.getFileTaskTemplateOptions\(\)/u);
	assert.doesNotMatch(
		`${catalogRead}\n${catalogBuild}\n${templateCandidates}`,
		/getAllTasks|getTaskById|taskCount|parseTask|cachedRead|vault\.read|indexer\./u,
	);
});

test('missing canonical settings fail freshness observation closed', () => {
	const revisionReader = methodBody(
		mainSource,
		'\tprivate async readAgentRuntimeSettingsPackageRevision(): Promise<string> {',
		'\n\n\tprivate async refreshAgentRuntimeSettingsBoundary',
	);
	assert.match(revisionReader, /revision === 'missing'/u);
	assert.match(revisionReader, /throw new Error/u);
});

test('typed create postflight seals exact inline locators and exact File bodies', () => {
	const gatewayBinding = methodBody(
		mainSource,
		'\tprivate async bindAgentRuntimeMutationGateway(): Promise<void> {',
		'\n\n\tprivate async prepareAgentRuntimeSourceTransition',
	);
	const identityApply = methodBody(
		mainSource,
		'\tprivate async applyAgentRuntimeIdentityCreation(',
		'\n\n\tprivate taskWorkflowIdentityReceipt',
	);
	assert.match(
		gatewayBinding,
		/const finalInlineLineNumber = \(\s*filePath: string,\s*operonId: string/u,
	);
	assert.match(
		gatewayBinding,
		/indexed\.primary\.lineNumber !== expectedInlineLine/u,
	);
	assert.match(
		gatewayBinding,
		/splitFrontmatterDocument\(sourceContent\)\.body\s*!== splitFrontmatterDocument\(plannedContent\)\.body/u,
	);
	assert.doesNotMatch(
		gatewayBinding,
		/bodyLines\.every|includes\(.*bodyMarkdown|subsequence/iu,
	);
	assert.match(
		identityApply,
		/plan\.atomicGroups\[plan\.atomicGroups\.length - 1\]\?\.groupId/u,
	);
	assert.doesNotMatch(identityApply, /\.at\(/u);
});

test('identity preview and apply rebuild seal the complete builder candidate before decoding', () => {
	const preview = methodBody(
		mainSource,
		'\tprivate async previewAgentRuntimeIdentityCreation(',
		'\n\n\tprivate buildAgentRuntimeIdentityPlanCandidate',
	);
	const builder = methodBody(
		mainSource,
		'\tprivate buildAgentRuntimeIdentityPlanCandidate(',
		'\n\n\tprivate async applyAgentRuntimeIdentityCreation',
	);
	const apply = methodBody(
		mainSource,
		'\tprivate async applyAgentRuntimeIdentityCreation(',
		'\n\n\tprivate taskWorkflowIdentityReceipt',
	);
	assert.match(preview, /sealIdentityPlaceholderPreviewResultV1\(candidate\)/u);
	assert.match(apply, /compareRebuiltIdentityPlaceholderPlanV1\(\s*this\.buildAgentRuntimeIdentityPlanCandidate/u);
	assert.doesNotMatch(builder, /planHash/u);
	assert.match(builder, /buildIdentityPlaceholderCreateEffectsV1/u);
});

test('identity apply seals and verifies a bounded durable journal before its first source write', () => {
	const apply = methodBody(
		mainSource,
		'\tprivate async applyAgentRuntimeIdentityCreation(',
		'\n\n\tprivate taskWorkflowIdentityReceipt',
	);
	const journalBuildIndex = apply.indexOf('buildIdentityPlaceholderJournalV1(');
	const sizeCheckIndex = apply.indexOf('identityPlaceholderJournalByteLengthV1(journal)');
	const acquireIndex = apply.indexOf('receiptStore.acquireJournal(journal, leaseOwner)');
	const readbackIndex = apply.indexOf('receiptStore.lookupJournal(scope)');
	const alteredFenceCleanupIndex = apply.indexOf('receiptStore.deleteJournal(\n\t\t\t\t\t\t\tscope,\n\t\t\t\t\t\t\tpersistedJournal,');
	const writerIndex = apply.indexOf('executeRuntimeGraphTransactionCommitV1(');
	assert.ok(journalBuildIndex >= 0);
	assert.ok(sizeCheckIndex > journalBuildIndex);
	assert.ok(acquireIndex > sizeCheckIndex);
	assert.ok(readbackIndex > acquireIndex);
	assert.ok(alteredFenceCleanupIndex > readbackIndex);
	assert.ok(writerIndex > readbackIndex);
	assert.ok(writerIndex > alteredFenceCleanupIndex);
	assert.match(apply, /const applyStartedAt = new Date\(\)\.toISOString\(\);/u);
	assert.match(apply, /effectiveAt: receiptEffectiveAt/u);
	assert.match(apply, /Identity graph journal readback did not match the sealed pre-write fence/u);
	assert.match(apply, /Identity graph journal readback differed and exact cleanup could not be verified/u);
	assert.match(apply, /Identity graph journal readback failed, so its durable recovery fence could not be verified/u);
	assert.match(apply, /Another Runtime may hold the identity graph journal/u);
	assert.match(identityJournalSource, /createdAt: plan\.createdAt/u);
	assert.match(identityJournalSource, /effectiveAt,/u);
	assert.match(identityJournalSource, /new TextEncoder\(\)\.encode\(value\)\.byteLength/u);
});

test('task-workflow recovery admission preserves expired same-plan recovery and separates recovery audits', () => {
	const binding = methodBody(
		mainSource,
		'\tprivate async bindAgentRuntimeMutationGateway(): Promise<void> {',
		'\n\n\tprivate async prepareAgentRuntimeSourceTransition',
	);
	const identityApply = methodBody(
		mainSource,
		'\tprivate async applyAgentRuntimeIdentityCreation(',
		'\n\n\tprivate taskWorkflowIdentityReceipt',
	);
	const recoveryEvidence = methodBody(
		mainSource,
		'\tprivate async hasSamePlanAgentRuntimeTaskWorkflowRecoveryEvidence(',
		'\n\n\tprivate async previewAgentRuntimeTaskWorkflowExecution',
	);
	assert.match(binding, /hasSamePlanRecoveryEvidence: request => this\.hasSamePlanAgentRuntimeTaskWorkflowRecoveryEvidence\(request\)/u);
	assert.match(binding, /auditDispatched: \(event, request\) => this\.recordTaskWorkflowSecurityAudit\(event, request\)/u);
	assert.match(binding, /auditCompleted: \(event, request, result\) => this\.recordTaskWorkflowSecurityAudit\(event, request, result\)/u);
	assert.match(recoveryEvidence, /admission\.receipt\.planHash === request\.plan\.planHash/u);
	assert.match(recoveryEvidence, /admission\.journal !== null/u);
	assert.match(recoveryEvidence, /this\.agentRuntimeIdentityJournalMatchesPlan\(/u);
	assert.match(identityApply, /if \(execution\.recoveryOnly && !receiptMatchesPlan && !journalMatchesPlan\)/u);
	assert.match(identityApply, /journalMatchesPlan \? 'recovery-dispatched' : 'apply-dispatched'/u);
	assert.match(taskWorkflowGatewaySource, /hasOnlyExpiredPlanIssue\(admission\.issues\)/u);
	assert.match(taskWorkflowGatewaySource, /hasSamePlanRecoveryEvidence\(decoded\.value\)/u);
	assert.match(taskWorkflowGatewaySource, /const recoveryOnly = expired/u);
	assert.match(taskWorkflowGatewaySource, /recoveryIntent \? 'recovery-dispatched' : event/u);
	assert.match(taskWorkflowGatewaySource, /'recovery-completed'/u);
});

test('file and inline Runtime mutations use the platform-safe canonical vault fence', () => {
	const containment = methodBody(
		mainSource,
		'\tprivate async isAgentRuntimeMutationPathContained(',
		'\n\n\tprivate async resolveAgentRuntimeInlineCreationPath',
	);
	assert.match(
		containment,
		/isCanonicalPathWithinRootV1\(\s*vaultRoot,\s*canonicalTarget,\s*nodeApi\.platform,?\s*\)/u,
	);
	assert.doesNotMatch(containment, /canonicalTarget\.startsWith\(`\$\{vaultRoot\}\//u);

	const absentSource = methodBody(
		mainSource,
		'\tprivate async readAgentRuntimeMutationSource(',
		'\n\n\tprivate async readVerifiedAgentRuntimeMutationTaskSource',
	);
	assert.match(absentSource, /isAgentRuntimeMutationPathContained\(filePath, true\)/u);
	const existingSource = methodBody(
		mainSource,
		'\tprivate async readVerifiedAgentRuntimeMutationTaskSource(',
		'\n\n\tprivate async isAgentRuntimeMutationPathContained',
	);
	assert.match(
		existingSource,
		/isAgentRuntimeMutationPathContained\(task\.primary\.filePath, false\)/u,
	);
	assert.match(
		mainSource,
		/validateWritePath: async \(filePath, allowAbsent\) => \(\s*await this\.isAgentRuntimeMutationPathContained\(filePath, allowAbsent\)/u,
	);
});

test('identity apply refuses unreceipted after-state convergence before creating a receipt', () => {
	const applyIdentity = methodBody(
		mainSource,
		'\tprivate async applyAgentRuntimeIdentityCreation(',
		'\n\n\tprivate taskWorkflowIdentityReceipt',
	);
	const convergenceIndex = applyIdentity.indexOf('if (await this.verifyAgentRuntimeIdentityPlanAfterState(plan))');
	const refusalIndex = applyIdentity.indexOf('`${creationLabel} after-state exists without the sealed receipt; preview again.`');
	const receiptIndex = applyIdentity.indexOf('const receipt: TaskWorkflowMutationReceiptV1');
	assert.ok(convergenceIndex >= 0);
	assert.ok(refusalIndex > convergenceIndex);
	assert.ok(receiptIndex > refusalIndex);
	assert.match(
		applyIdentity.slice(convergenceIndex, receiptIndex),
		/if \(await this\.verifyAgentRuntimeIdentityPlanAfterState\(plan\)\) \{[\s\S]*?'stale-source'/u,
	);
});
