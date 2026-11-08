import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { parseYaml } from '../../test-support/obsidian-native-yaml';
import { computeSealedMutationPlanHashV1, sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import { structuredErrorV1 } from '../../../src/agent-runtime/contracts/v1/primitives';
import { decodeMutationApplyRequestV1, decodeMutationPreviewRequestV1 } from '../../../src/agent-runtime/contracts/v1/decode';
import type { MutationPreviewRequestV1, SealedMutationPlanV1, MutationResultV1 } from '../../../src/agent-runtime/contracts/v1/mutation';
import { createFileTaskTitlesRuntimeV1, type FileTaskTitlesPortsV1 } from '../../../src/agent-runtime/extensions/file-task-titles-v1/gateway';
import { decodeFileTaskTitlesApplyV1, decodeFileTaskTitlesPreviewV1, fileTaskTitlesExecutionKeyV1, fileTaskTitlesExecutionRequestV1, sealFileTaskTitlesPlanV1 } from '../../../src/agent-runtime/extensions/file-task-titles-v1/decode';
import type { FileTaskTitlesPreviewRequestV1 } from '../../../src/agent-runtime/extensions/file-task-titles-v1/contracts';
import { prepareRuntimeTaskCreationV1, type RuntimeTaskCreationAdapterPortsV1 } from '../../../src/agent-runtime/runtime/task-creation-adapter';
import { prepareRuntimeTaskFieldMutationV1, type RuntimeExactTaskMutationSnapshotV1 } from '../../../src/agent-runtime/runtime/task-mutation-adapter';
import { buildLivePropertyCatalogV1 } from '../../../src/agent-runtime/runtime/catalog-builder';
import { deriveTaskFilename } from '../../../src/core/filename-rule';
import { splitFrontmatterDocument } from '../../../src/core/file-task-template-merge';
import { DEFAULT_SETTINGS } from '../../../src/types/settings';

const schemaSamples: { name: string; value: unknown }[] = [];
const sample = (name: string, value: unknown) => schemaSamples.push({ name, value: structuredClone(value) });
const legacy = JSON.parse(readFileSync('scripts/agent-runtime/receipts/legacy-transaction-identifiers.json','utf8')).file.plan as SealedMutationPlanV1;
const key = 'file-task-title-test-key';
const item = { itemRef: 'one', displayTitle: 'Review Q3 Plan', target: { mode: 'exact-path' as const, representation: 'file' as const, filePath: 'TTTTT.md' }, fields: [] };
const previewInput: FileTaskTitlesPreviewRequestV1 = { contractVersion: 1, kind: 'mutation-preview', requestId: 'title-preview', clientInstanceId: 'title-client', idempotencyKey: key, capability: 'tasks.file.create.preview', mutationKind: 'task.create', authorization: { basis: 'user-explicit-request' }, spec: { operation: 'create-file', item } };
function innerPlan(request = fileTaskTitlesExecutionRequestV1(previewInput)): SealedMutationPlanV1 {
 const plan = structuredClone(legacy); plan.idempotencyKeyHash = sha256HexV1(request.idempotencyKey); plan.clientInstanceId = request.clientInstanceId; if (request.spec.operation !== 'create' && request.spec.operation !== 'update') throw new Error('Title fixture'); plan.spec = request.spec;
 if (request.spec.operation === 'update') { plan.capability = 'tasks.update.preview'; plan.mutationKind = 'task.update'; delete plan.createEffects; } plan.planHash = computeSealedMutationPlanHashV1(plan); return plan;
}
function applyInput(plan = sealFileTaskTitlesPlanV1(innerPlan(), previewInput.capability, key, previewInput.spec)) { return { contractVersion: 1 as const, kind: 'mutation-apply' as const, requestId: 'title-apply', plan, idempotencyKey: key, authorization: { basis: 'user-explicit-request' as const }, acknowledgements: [] }; }
function successful(requestId: string, plan: SealedMutationPlanV1): MutationResultV1 { return { contractVersion: 1, requestId, kind: 'mutation-result', status: 'applied', mutationMayHaveApplied: true, retryAllowed: false, groupResults: plan.atomicGroups.map(g => ({ groupId: g.groupId, status: 'committed' })), receipt: { contractVersion: 1, vaultIdentityHash: 'a'.repeat(64), clientInstanceId: plan.clientInstanceId, idempotencyKeyHash: plan.idempotencyKeyHash, planHash: plan.planHash, mutationKind: plan.mutationKind, targetDigest: plan.receiptTargetDigest, terminalOutcome: 'applied', effectiveAt: plan.createdAt, completedAt: plan.createdAt, expiresAt: plan.expiresAt }, postflight: { status: 'verified', observedAt: plan.createdAt, contextRevision: plan.contextRevision } }; }
function fixture(overrides: Partial<FileTaskTitlesPortsV1> = {}) { let writes = 0; return { writes: () => writes, runtime: createFileTaskTitlesRuntimeV1({ ready: () => true, hasRecoveryEvidence: async () => true, audit: async () => {}, previewCore: async request => ({ contractVersion: 1, requestId: request.requestId, kind: 'mutation-preview-result', ok: true, warnings: [], plan: innerPlan(request) }), applyCore: async request => { writes++; return successful(request.requestId, request.plan); }, ...overrides }) }; }

test('both title previews reject invalid original idempotency keys before core dispatch', async () => {
 const target = { operonId: legacy.targets[0].operonId!, locator: legacy.targets[0].locator! };
 const requests: FileTaskTitlesPreviewRequestV1[] = [previewInput, { ...previewInput, capability: 'tasks.file.title.preview', mutationKind: 'task.update', target, spec: { operation: 'set-title', displayTitle: 'Next' } }];
 for (const request of requests) {
  let dispatches = 0;
  const f = fixture({ previewCore: async req => { dispatches++; return { contractVersion: 1, requestId: req.requestId, kind: 'mutation-preview-result', ok: true, warnings: [], plan: innerPlan(req) }; } });
  for (const idempotencyKey of [undefined, null, 123, {}, [], '', 'a'.repeat(15), 'a'.repeat(257), 'valid-key with spaces', 'é'.repeat(16), 'a'.repeat(16) + '\n']) {
   const invalid = { ...request, idempotencyKey };
   assert.equal(decodeFileTaskTitlesPreviewV1(invalid).ok, false);
   const result = await f.runtime.preview(invalid); assert.equal(result.ok, false);
   if (!result.ok) assert.equal(result.error.code, 'invalid-request');
  }
  assert.equal(dispatches, 0); assert.equal(f.writes(), 0);
  for (const idempotencyKey of ['a'.repeat(16), 'A0._:-'.repeat(42) + 'abcd']) {
   const result = await f.runtime.preview({ ...request, idempotencyKey }); assert.ok(result.ok);
   if (!result.ok) continue;
   const apply = { ...applyInput(result.plan), idempotencyKey };
   assert.equal(decodeFileTaskTitlesApplyV1(apply).ok, true);
   assert.equal((await f.runtime.apply(apply)).status, 'applied');
  }
  assert.equal(dispatches, 2); assert.equal(f.writes(), 2);
 }
});

test('explicit title creation seals both intents and preserves old V1 admission', async () => {
 const f = fixture(), result = await f.runtime.preview(previewInput); assert.ok(result.ok, JSON.stringify(result)); if (!result.ok) return;
 sample('mutation/previewRequest', previewInput); sample('mutation/previewResult', result); sample('mutation/sealedPlan', result.plan);
 const request = applyInput(result.plan); sample('mutation/applyRequest', request); assert.equal(decodeFileTaskTitlesApplyV1(request).ok, true); assert.equal(decodeMutationApplyRequestV1(request).ok, false);
 assert.equal(decodeMutationPreviewRequestV1(previewInput).ok, false);
 const applied = await f.runtime.apply(request); sample('mutation/mutationResult', applied); assert.equal(applied.status, 'applied'); assert.equal(applied.receipt?.planHash, result.plan.planHash); assert.equal(f.writes(), 1);
});

test('title edit and clear seal explicit filename-preserving plans', async () => {
 for (const displayTitle of ['Human title', null]) {
  const target = { operonId: legacy.targets[0].operonId!, locator: legacy.targets[0].locator! };
  const request: FileTaskTitlesPreviewRequestV1 = { ...previewInput, capability: 'tasks.file.title.preview', mutationKind: 'task.update', target, spec: { operation: 'set-title', displayTitle } };
  const f = fixture(), result = await f.runtime.preview(request); assert.ok(result.ok, JSON.stringify(result)); if (!result.ok) continue;
  sample('mutation/previewRequest', request); sample('mutation/previewResult', result); sample('mutation/sealedPlan', result.plan);
  const apply = applyInput(result.plan); sample('mutation/applyRequest', apply);
  const applied = await f.runtime.apply(apply); assert.equal(applied.status, 'applied'); sample('mutation/mutationResult', applied);
 }
});

test('invalid targets, fields, capabilities and tampered seals cannot dispatch', async () => {
 const f = fixture(), good = applyInput();
 for (const value of [{ ...good, extra: true }, { ...good, idempotencyKey: 'other-key-12345678' }, { ...good, plan: { ...good.plan, spec: { ...good.plan.spec, extra: true } } }, { ...good, plan: { ...good.plan, capability: 'tasks.file.title.preview' } }, { ...good, plan: { ...good.plan, planHash: '0'.repeat(64) } }]) assert.equal((await f.runtime.apply(value)).mutationMayHaveApplied, false);
 assert.equal(f.writes(), 0);
 assert.equal(decodeFileTaskTitlesPreviewV1({ ...previewInput, target: legacy.targets[0] }).ok, false);
 for (const displayTitle of ['a'.repeat(8193), 'é'.repeat(4097), 'line one\nline two']) assert.equal(decodeFileTaskTitlesPreviewV1({ ...previewInput, spec: { operation: 'create-file', item: { ...item, displayTitle } } }).ok, false);
 for (const changed of [{ ...item, description: 'Forged' }, { ...item, extra: true }, { ...item, target: { representation: 'inline', mode: 'configured-default' } }]) assert.equal(decodeFileTaskTitlesPreviewV1({ ...previewInput, spec: { operation: 'create-file', item: changed } }).ok, false);
});

test('title edit is a separate capability with one File Task target and no filename controls', () => {
 const target = { operonId: 'abc1234', locator: { representation: 'file', filePath: 'old-name.md' } };
 for (const displayTitle of ['New title', 'line one\nline two', '', null]) {
  const request: unknown = { ...previewInput, capability: 'tasks.file.title.preview', mutationKind: 'task.update', target, spec: { operation: 'set-title', displayTitle } };
  const decoded = decodeFileTaskTitlesPreviewV1(request); assert.ok(decoded.ok, JSON.stringify(decoded)); if (!decoded.ok) continue;
  assert.equal(decodeMutationPreviewRequestV1(fileTaskTitlesExecutionRequestV1(decoded.value)).ok, true, 'field ownership is decided by the live catalog; a preexisting custom key remains valid');
  assert.equal(decodeFileTaskTitlesPreviewV1({ ...decoded.value, spec: { ...decoded.value.spec, rename: true } }).ok, false);
 }
 assert.notEqual(fileTaskTitlesExecutionKeyV1('tasks.file.create.preview', key), fileTaskTitlesExecutionKeyV1('tasks.file.title.preview', key));
});

test('recovery without durable evidence and audit failure refuse writes', async () => {
 const noEvidence = fixture({ hasRecoveryEvidence: async () => false }); assert.equal((await noEvidence.runtime.recover(applyInput())).status, 'failed'); assert.equal(noEvidence.writes(), 0);
 const noAudit = fixture({ audit: async () => { throw new Error('offline'); } }); assert.equal((await noAudit.runtime.apply(applyInput())).status, 'failed'); assert.equal(noAudit.writes(), 0);
 const uncertain = fixture({ applyCore: async () => { throw new Error('lost result'); } }); assert.equal((await uncertain.runtime.apply(applyInput())).status, 'outcome-unknown');
});

test('real creation adapter preserves title and exact paths for all filename presets', async () => {
 for (const preset of ['same', 'kebab', 'snake'] as const) for (const mode of ['exact-path', 'configured-default'] as const) {
  const settings = { ...structuredClone(DEFAULT_SETTINGS), fileTaskFilenameRule: { preset } };
  const ports: RuntimeTaskCreationAdapterPortsV1 = { fileTaskTitleCreation: true, settings: () => settings, listOperonIds: () => new Set(), listDependencyGraphTasks: () => [], getExistingTask: () => null, readSource: async filePath => ({ filePath, content: null }), resolveConfiguredInlineTarget: async () => { throw new Error('file only'); }, resolveConfiguredFilePath: async title => `Tasks/${deriveTaskFilename(title, settings.fileTaskFilenameRule)}.md`, readTemplate: async () => null, creationFieldCatalog: () => [], resolveCoreTemplateVariables: content => content, generateOperonId: () => 'abc1234', now: () => '2026-11-06T12:00:00' };
  const result = await prepareRuntimeTaskCreationV1('create-title', { operation: 'create', items: [{ itemRef: 'one', description: item.displayTitle, target: mode === 'exact-path' ? { mode, representation: 'file', filePath: 'Tasks/chosen-path.md' } : { mode, representation: 'file' }, fields: [] }] }, ports);
  assert.ok(result.ok, JSON.stringify(result)); if (!result.ok) continue;
  const expected = mode === 'exact-path' ? 'Tasks/chosen-path.md' : `Tasks/${deriveTaskFilename(item.displayTitle, settings.fileTaskFilenameRule)}.md`;
  assert.equal(result.plan.tasks[0].filePath, expected);
  assert.equal(result.plan.tasks[0].description, expected.split('/').pop()!.slice(0, -3));
  const source = result.plan.sourceGroups.find(source => source.filePath === expected)!;
  const yaml = parseYaml(splitFrontmatterDocument(source.resultingContent).frontmatter!) as Record<string, unknown>;
  assert.equal(yaml.title, item.displayTitle);
 }
});

test('real title update adapter keeps file identity and old general updates reject it', () => {
 const built = buildLivePropertyCatalogV1(structuredClone(DEFAULT_SETTINGS)); assert.ok(built.ok); if (!built.ok) return;
 const task: RuntimeExactTaskMutationSnapshotV1 = { operonId: 'abc1234', locator: { representation: 'file', filePath: 'old-name.md' }, description: 'old-name', checkbox: 'open', fieldValues: { fileTaskDisplayTitle: 'Before' }, tags: [], sourceContent: '---\noperonId: abc1234\ntitle: Before\n---\nBody', duplicate: false };
 const request: MutationPreviewRequestV1 = { ...fileTaskTitlesExecutionRequestV1(previewInput), capability: 'tasks.update.preview', mutationKind: 'task.update', target: { operonId: task.operonId, locator: task.locator }, spec: { operation: 'update', changes: [{ field: 'fileTaskDisplayTitle', valueType: 'text', value: 'After' }] } };
 assert.equal(prepareRuntimeTaskFieldMutationV1(request, '2026-11-06T12:00:00.000Z', { catalog: built.value, getTask: () => task }).ok, false);
 const updated = prepareRuntimeTaskFieldMutationV1(request, '2026-11-06T12:00:00.000Z', { catalog: built.value, getTask: () => task, allowFileTaskTitle: true });
 assert.ok(updated.ok, JSON.stringify(updated)); if (updated.ok) { assert.equal(updated.value.fieldValues.fileTaskDisplayTitle, 'After'); assert.equal(updated.value.fieldValues._description, undefined); }
});


test('preexisting custom title keys retain legacy Runtime types and write access', () => {
 for (const type of ['text', 'number', 'checkbox', 'list', 'date', 'datetime'] as const) {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.keyMappings = settings.keyMappings.filter(mapping => mapping.canonicalKey !== 'fileTaskDisplayTitle');
  settings.keyMappings.push({ canonicalKey: 'fileTaskDisplayTitle', visiblePropertyName: 'Legacy title', type, isSystem: false, enabled: true, sync: 'yes' });
  const catalog = buildLivePropertyCatalogV1(settings); assert.ok(catalog.ok); if (!catalog.ok) continue;
  const field = catalog.value.fields.find(candidate => candidate.canonicalKey === 'fileTaskDisplayTitle');
  assert.equal(field?.source, 'custom'); assert.equal(field?.mappingStatus, 'mapped'); assert.equal(field?.valueType, type); assert.equal(field?.mutationClass, 'general-update');
 }
});

import { FILE_TASK_TITLES_CAPABILITIES_V1 } from '../../../src/agent-runtime/extensions/file-task-titles-v1/contracts';
import { getFileTaskTitlesDeveloperApiV1, type FileTaskTitlesDeveloperOptionsV1 } from '../../../src/agent-runtime/extensions/file-task-titles-v1/developer-api';
import { DeveloperMutationSecurityPolicyV1 } from '../../../src/agent-runtime/developer-api/security';
import { IndexedDbDeveloperMutationRecoveryStoreV1 } from '../../../src/agent-runtime/developer-api/recovery-store';
import type { DeveloperApiGrantEvaluationV1 } from '../../../src/agent-runtime/developer-api/grants';
import type { OperonAgentRuntimeCoreV1 } from '../../../src/agent-runtime/runtime/types';
import type { OperonDeveloperApiConsumerPluginV1 } from '../../../src/agent-runtime/public/v1/developer-api';
import { FakeIndexedDbFactory } from '../developer-api/recovery-store.test';
import { validateCliInvocationForTransportV1 } from '../../../src/agent-runtime/transport/invocation-validator';

function developerFixture(compensate = false) {
 const now = new Date('2026-07-24T10:00:00.000Z'), consumer = { id: 'title.consumer', name: 'Title Consumer', version: '1.0.0', instanceEpoch: 'epoch1' };
 const state = { active: true, available: true, dispatches: 0, recover: false, evidence: true };
 const f = fixture({ hasRecoveryEvidence: async () => state.evidence, applyCore: async req => {
  state.dispatches++;
  if (!state.recover) throw new Error('lost completion');
  if (compensate) return { contractVersion: 1, requestId: req.requestId, kind: 'mutation-result', status: 'failed', mutationMayHaveApplied: false, retryAllowed: false, groupResults: [], recoveryOutcome: 'compensated', error: structuredErrorV1('stale-source', 'Verified compensation') };
  return successful(req.requestId, req.plan);
 } });
 const core = { fileTaskTitles: f.runtime, hasCapability: () => state.available } as unknown as OperonAgentRuntimeCoreV1;
 const store = new IndexedDbDeveloperMutationRecoveryStoreV1({ indexedDBFactory: new FakeIndexedDbFactory() as unknown as IDBFactory, now: () => now.getTime() });
 const evaluate = (): DeveloperApiGrantEvaluationV1 => ({ state: state.active ? 'active' : 'revoked', revision: 1, grantedCapabilities: FILE_TASK_TITLES_CAPABILITIES_V1, effectiveCapabilities: state.active ? FILE_TASK_TITLES_CAPABILITIES_V1 : [], pendingCapabilities: [], reason: state.active ? 'active-grant' : 'revoked' } as DeveloperApiGrantEvaluationV1);
 const policy = new DeveloperMutationSecurityPolicyV1({ consent: { requestConsent: async () => 'approved' }, isSessionCurrent: s => s.consumerId === consumer.id, isGrantCurrent: () => state.active, now: () => now });
 const options: FileTaskTitlesDeveloperOptionsV1 = { isDesktopAvailable: () => true, isHostVersionSupported: () => true, lifecyclePhase: () => 'ready', isCoreActive: c => c === core, grantController: { verifyConsumer: () => consumer, isConsumerCurrent: () => true, evaluate, recordPending: () => {} }, mutationSecurityPolicy: policy, recoveryStore: store, now: () => now };
 const access = () => getFileTaskTitlesDeveloperApiV1(core, {} as OperonDeveloperApiConsumerPluginV1, { contractVersion: 1, runtimeApi: { min: 1, max: 1 }, requestedCapabilities: ['tasks.file.create.preview', 'tasks.file.create.apply'] as const }, options);
 return { state, store, access, consumer };
}

test('Developer API opaque handles, revoked grants and restarted recovery preserve uncertainty', async () => {
 const f = developerFixture(), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations.preview({ capability: 'tasks.file.create.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 sample('developer-api/previewResult', preview); sample('developer-api/planHandle', preview.plan);
 assert.equal((await access.api.mutations.apply({ plan: structuredClone(preview.plan) })).status, 'failed');
 const uncertain = await access.api.mutations.apply({ plan: preview.plan }); sample('developer-api/executionResult', uncertain); assert.equal(uncertain.status, 'outcome-unknown');
 f.state.active = false;
 const denied = await access.api.mutations.recover({ plan: preview.plan }); assert.equal(denied.status, 'outcome-unknown'); assert.equal(denied.mutationMayHaveApplied, true); assert.equal(f.state.dispatches, 1); assert.equal(f.access().ok, false);
 f.state.active = true; f.state.recover = true;
 const resumed = f.access(); assert.ok(resumed.ok); if (!resumed.ok) return;
 const pending = await resumed.api.mutations.pendingRecoveries(); sample('developer-api/pendingRecoveriesResult', pending); assert.ok(pending.ok && pending.recoveries.length === 1);
 const recovered = await resumed.api.mutations.recover({ recoveryRef: preview.plan.recoveryRef }); sample('developer-api/executionResult', recovered); assert.equal(recovered.status, 'applied'); assert.equal((await f.store.list(f.consumer.id)).length, 0);
});

test('verified compensation closes the durable Developer API recovery record', async () => {
 const f = developerFixture(true), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations.preview({ capability: 'tasks.file.create.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 await access.api.mutations.apply({ plan: preview.plan }); f.state.recover = true;
 const result = await access.api.mutations.recover({ plan: preview.plan }); assert.equal(result.status, 'failed', JSON.stringify(result)); assert.equal(result.mutationMayHaveApplied, false); assert.equal((await f.store.list(f.consumer.id)).length, 0);
});

test('lost compensation finalization keeps recovery uncertain and refuses replay without durable evidence', async () => {
 const f = developerFixture(true), access = f.access(); assert.ok(access.ok); if (!access.ok) return;
 const preview = await access.api.mutations.preview({ capability: 'tasks.file.create.preview', mutationKind: 'task.create', spec: previewInput.spec }); assert.ok(preview.ok); if (!preview.ok) return;
 await access.api.mutations.apply({ plan: preview.plan }); f.state.recover = true;
 const markRefused = f.store.markRefused.bind(f.store);
 f.store.markRefused = async () => { throw new Error('Injected finalization failure'); };
 const result = await access.api.mutations.recover({ plan: preview.plan });
 assert.equal(result.status, 'outcome-unknown'); assert.equal(result.mutationMayHaveApplied, true);
 f.store.markRefused = markRefused; f.state.evidence = false;
 const restarted = f.access(); assert.ok(restarted.ok); if (!restarted.ok) return;
 const pending = await restarted.api.mutations.pendingRecoveries(); assert.ok(pending.ok && pending.recoveries.length === 1);
 assert.equal((await restarted.api.mutations.recover({ recoveryRef: preview.plan.recoveryRef })).status, 'outcome-unknown');
 assert.equal(f.state.dispatches, 2, 'no new write can run without the original journal or receipt');
});

test('Plugin request-file transport accepts the extension while retaining strict envelope validation', () => {
 const invocation = { contractVersion: 1, kind: 'cli-invocation', requestId: previewInput.requestId, command: 'mutation.preview', mode: 'live', clientVersion: '1.0.0', compatibility: { contractVersion: 1, runtimeApi: { min: 1, max: 1 } }, cliContract: { min: 1, max: 1 }, expectedVaultSha256: 'a'.repeat(64), readinessTimeoutMs: 1000, request: previewInput };
 assert.equal(validateCliInvocationForTransportV1(invocation).ok, true); sample('cli/invocation', invocation);
 assert.equal(validateCliInvocationForTransportV1({ ...invocation, extra: true }).ok, false);
 assert.equal(validateCliInvocationForTransportV1({ ...invocation, requestId: 'other' }).ok, false);
});

test('Runtime and Developer API output match independent extension schemas', () => {
 const script = `import Ajv from 'ajv/dist/2020.js'; import fs from 'node:fs';
 const ajv = new Ajv({ strict: true, strictSchema: false, strictTypes: false, strictRequired: false, validateFormats: false });
 for (const dir of ['contracts/agent-runtime/v1','contracts/agent-runtime/extensions/task-workflows-v1','contracts/agent-runtime/extensions/file-task-titles-v1']) for (const file of fs.readdirSync(dir).filter(f=>f.endsWith('.schema.json'))) ajv.addSchema(JSON.parse(fs.readFileSync(dir+'/'+file,'utf8')));
 for (const entry of JSON.parse(fs.readFileSync('contracts/agent-runtime/extensions/file-task-titles-v1/extension-manifest.json','utf8')).entrypoints) { if (!ajv.getSchema(entry.ref)) throw new Error('Unresolved entrypoint: '+entry.ref); }
 for (const {name,value} of JSON.parse(fs.readFileSync(0,'utf8'))) { const [file,def]=name.split('/'); const validate=ajv.getSchema('urn:operon:schema:runtime:v1:extension:file-task-titles:'+file+'#/$defs/'+def); if (!validate(value)) throw new Error(name+': '+JSON.stringify(validate.errors)); }`;
 execFileSync(process.execPath, ['--input-type=module','-e',script], { input: JSON.stringify(schemaSamples), encoding: 'utf8', maxBuffer: 1024*1024 });
 execFileSync(process.execPath, ['scripts/agent-runtime/file-task-titles/generate-schemas.mjs'], { encoding: 'utf8' });
});
