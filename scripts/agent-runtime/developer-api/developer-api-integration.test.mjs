import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const mainSource = await readFile(new URL('../../../main.ts', import.meta.url), 'utf8');
const developerRuntimeSource = await readFile(
	new URL('../../../src/agent-runtime/developer-api/runtime.ts', import.meta.url),
	'utf8',
);
const operonStorageSource = await readFile(
	new URL('../../../src/storage/operon-storage.ts', import.meta.url),
	'utf8',
);

function methodBody(source, signature, nextSignature) {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `Missing ${signature}`);
	const end = source.indexOf(nextSignature, start);
	assert.notEqual(end, -1, `Missing boundary ${nextSignature}`);
	return source.slice(start, end);
}

test('publishes only the narrow Developer API accessor over a private Runtime core', () => {
	assert.match(mainSource, /private agentRuntimeCore!: OperonAgentRuntimeCoreV1;/u);
	assert.doesNotMatch(mainSource, /^\s*agentRuntime!:/mu);
	assert.match(
		mainSource,
		/getDeveloperApiV1\(\s*consumerPlugin: OperonDeveloperApiConsumerPluginV1,\s*request: OperonDeveloperApiAccessRequestV1/u,
	);
	assert.match(mainSource, /return getOperonDeveloperApiV1\(core, consumerPlugin, request,/u);
	assert.match(mainSource, /this\.agentRuntimeCore = createOperonAgentRuntimeFacadeV1\(/u);
	assert.match(mainSource, /isCurrent: consumer => this\.isDeveloperApiConsumerCurrent\(consumer\)/u);
	assert.match(mainSource, /enabledPlugins instanceof Set/u);
	assert.match(mainSource, /this\.developerApiConsumerEpochs\.get\(livePlugin\) === consumer\.instanceEpoch/u);
});

test('CLI transports and Developer API share the same Runtime core', () => {
	assert.match(
		mainSource,
		/registerAgentRuntimeCliHandlersV1\(\s*this,\s*this\.agentRuntimeCore,/u,
	);
	assert.match(
		mainSource,
		/startAgentRuntimePersistentReadServerV1\(\s*this,\s*this\.agentRuntimeCore,/u,
	);
	const accessor = methodBody(
		mainSource,
		'\tgetDeveloperApiV1(',
		'\n\tprivate isPinnedDockDisabledOnCurrentDevice',
	);
	assert.doesNotMatch(accessor, /agentRuntimeCliTransportAvailable|registerAgentRuntimeCliHandlers/u);
});

test('Developer API runtime has no CLI, transport, or official Obsidian CLI dependency', () => {
	assert.doesNotMatch(
		developerRuntimeSource,
		/from ['"].*(?:\/transport|operon-cli|\/cli)['"]/u,
	);
	assert.doesNotMatch(
		developerRuntimeSource,
		/agentRuntimeCliTransportAvailable|nativeCliTransportAvailable|Obsidian CLI/u,
	);
});

test('general settings persistence preserves the host-owned Developer API grant slice', () => {
	const persistSettings = methodBody(
		operonStorageSource,
		'\tprivate async persistSettings(',
		'\n\tgetSettings(): OperonSettings',
	);
	assert.match(
		persistSettings,
		/const currentDeveloperApi = currentPackage\.integrations\.developerApi;/u,
	);
	assert.match(persistSettings, /developerApi: currentDeveloperApi,/u);
});

test('settings grant approval admits exact base and additive extension capabilities', () => {
	const settingsIntegration = methodBody(
		mainSource,
		'\tprivate buildDeveloperApiSettingsIntegration(): DeveloperApiSettingsIntegration',
		'\n\tprivate isPinnedDockDisabledOnCurrentDevice',
	);
	assert.match(
		settingsIntegration,
		/isCapabilityIdV1\(capability\)[\s\S]*?\|\| isTaskWorkflowCapabilityIdV1\(capability\)[\s\S]*?\|\| isReadProjectionDeveloperCapabilityIdV1\(capability\)/u,
	);
	assert.match(
		settingsIntegration,
		/approvePending\(consumerId, known\)/u,
	);
});

test('grant audit intent and completion records share one transition correlation', () => {
	const recordGrantAudit = methodBody(
		mainSource,
		'\tprivate async recordDeveloperApiGrantAudit(',
		'\n\tprivate isDeveloperApiSecuritySessionCurrent',
	);
	assert.match(
		recordGrantAudit,
		/`\$\{vaultIdentityHash\}\\0\$\{transition\.correlationId\}`/u,
	);
	assert.doesNotMatch(recordGrantAudit, /correlationHash:[\s\S]*?transition\.phase/u);
});

test('startup grant audit recovery resolves and filters the exact vault identity before reconciliation', () => {
	const loadPlugin = methodBody(
		mainSource,
		'\tprivate async loadPlugin(): Promise<void>',
		'\n\tprivate async unloadPlugin(): Promise<void>',
	);
	const identityIndex = loadPlugin.indexOf('this.agentRuntimeVaultIdentityHash = await computeRunningVaultSha256V1(');
	const reconciliationIndex = loadPlugin.indexOf('findIncompleteDeveloperGrantAuditTransitionsForVaultV1(');
	assert.ok(identityIndex >= 0);
	assert.ok(reconciliationIndex > identityIndex);
	assert.match(
		loadPlugin,
		/findIncompleteDeveloperGrantAuditTransitionsForVaultV1\([\s\S]*?this\.agentRuntimeVaultIdentityHash \?\? ''/u,
	);
	assert.match(
		loadPlugin,
		/startupAuditRecoveryTransitions = Object\.values\(grants\.consumersById\)[\s\S]*?record\.state !== 'revoked'/u,
	);
});
