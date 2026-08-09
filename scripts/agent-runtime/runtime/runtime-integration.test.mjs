import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../../../main.ts', import.meta.url), 'utf8');
const indexerSource = await readFile(new URL('../../../src/indexer/indexer.ts', import.meta.url), 'utf8');

function methodBody(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `Missing ${signature}`);
	const end = source.indexOf(nextSignature, start);
	assert.notEqual(end, -1, `Missing boundary ${nextSignature}`);
	return source.slice(start, end);
}

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
	const convergenceIndex = applyIdentity.indexOf('const afterStateAlreadyPresent =');
	const refusalIndex = applyIdentity.indexOf("'Identity-placeholder after-state exists without the sealed receipt; preview again.'");
	const receiptIndex = applyIdentity.indexOf('const receipt: TaskWorkflowMutationReceiptV1');
	assert.ok(convergenceIndex >= 0);
	assert.ok(refusalIndex > convergenceIndex);
	assert.ok(receiptIndex > refusalIndex);
	assert.match(
		applyIdentity.slice(convergenceIndex, receiptIndex),
		/if \(afterStateAlreadyPresent\) \{[\s\S]*?'stale-source'/u,
	);
});
