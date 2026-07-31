import assert from 'node:assert/strict';
import {
	canonicalJsonV1,
	decodeOperonCatalogV1,
	type FieldDescriptorV1,
	type FileTaskTemplateCandidateV1,
	isGeneralUpdateFieldV1,
	sha256HexV1,
	toJsonValueV1,
	type OperonCatalogV1,
} from '../../../src/agent-runtime/contracts/v1';
import { buildLivePropertyCatalogV1 } from '../../../src/agent-runtime/runtime/catalog-builder';
import { computeContextSettingsFingerprintV1 } from '../../../src/agent-runtime/runtime/settings-fingerprint';
import {
	DEFAULT_SETTINGS,
	type KeyMapping,
	type OperonSettings,
} from '../../../src/types/settings';

declare global {
	var __operonAgentRuntimeCatalogTestRun: Promise<void> | undefined;
}

globalThis.__operonAgentRuntimeCatalogTestRun = run();

async function run(): Promise<void> {
	testDefaultCatalog();
	testFileTaskTemplateCandidates();
	testCustomKeysAndCollisions();
	testTaxonomyAndPolicyFreshness();
	testBoundsAndIsolation();
	testFullContractParity();
	await testWarmPerformance();
	console.log('Agent Runtime Property Catalog tests passed');
}

function testDefaultCatalog(): void {
	const result = buildLivePropertyCatalogV1(settings());
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const catalog = result.value;
	assert.equal(catalog.taxonomy.pipelines[0]?.id, 'pl_project');
	assert.equal(catalog.taxonomy.pipelines[0]?.description.length > 0, true);
	assert.equal(catalog.taxonomy.pipelines[0]?.statuses[0]?.order, 0);
	assert.equal(catalog.taxonomy.priorities[0]?.id, 'pr_s');
	assert.equal(catalog.taxonomy.defaultPriority.status, 'resolved');
	assert.equal(catalog.fields.some(field => field.canonicalKey === 'reminders'), false);
	for (const key of ['description', 'checkbox', 'tags', 'representation', 'locator', 'pinned', 'related']) {
		assert.equal(catalog.fields.filter(field => field.canonicalKey === key).length, 1);
	}
	const status = catalog.fields.find(field => field.canonicalKey === 'status');
	assert.equal(status?.mutationClass, 'semantic-capability');
	assert.equal(status?.mutationOwner, 'tasks.transition');
	assert.equal(status?.requiresStableTaxonomyId, true);
	const priority = catalog.fields.find(field => field.canonicalKey === 'priority');
	assert.equal(priority?.mutationClass, 'general-update');
	assert.equal(priority?.requiresStableTaxonomyId, true);
	assert.equal(isGeneralUpdateFieldV1(priority!), true);
	const reminderPolicy = catalog.policies.reminders.fields;
	assert.deepEqual(reminderPolicy.map(field => field.availability), ['available', 'available']);
	assert.deepEqual(catalog.policies.reminders.itemActions, ['add', 'replace', 'remove']);
	assert.equal(catalog.policies.creation.builtInTemplateCandidates[0]?.pipelineId, 'pl_project');
	assert.equal(catalog.policies.creation.builtInTemplateCandidates[0]?.initialStatusId, 'st_project_brainstorming');
	assert.equal(catalog.policies.creation.fileTaskTemplateFolder, '');
	assert.equal(catalog.policies.creation.typedCreateVersion, 1);
	assert.deepEqual(catalog.policies.creation.typedCreateFeatures, [
		'exact-inline-placement',
		'exact-file-target',
		'deterministic-file-template',
		'file-body-replacement',
		'same-source-task-graph',
		'cross-source-parent-related',
	]);
	assert.deepEqual(catalog.policies.creation.fileTaskTemplateCandidates, []);
	assert.equal(catalog.policies.creation.temporalCreateVersion, 1);
	assert.deepEqual(catalog.policies.creation.temporalCreateKeys, [
		'reminderDatetimes',
		'reminderRules',
		'repeat',
		'datetimeRepeatEnd',
	]);
	assert.equal(catalog.policies.creation.compactBatchVersion, 1);
	assert.equal(catalog.policies.creation.compactBatchInputFormat, 'compact-lines');
	assert.equal(catalog.policies.creation.compactBatchMaxItems, 64);
	assert.equal(catalog.policies.taskUpdate.compactUpdateBatchVersion, 1);
	assert.equal(catalog.policies.taskUpdate.compactUpdateBatchInputFormat, 'compact-lines');
	assert.equal(catalog.policies.taskUpdate.compactUpdateBatchMaxItems, 64);
	assert.deepEqual(catalog.policies.taskUpdate.compactUpdateBatchFeatures, [
		'exact-id-targets',
		'heterogeneous-general-updates',
		'explicit-field-clear',
		'single-source-atomic-plan',
		'per-target-postflight',
		'same-plan-recovery',
	]);
	assert.equal(catalog.policies.creation.graphTransactionVersion, 1);
	assert.deepEqual(catalog.policies.creation.graphTransactionFeatures, [
		'vault-wide-graph-transaction',
		'compare-aware-compensation',
		'same-plan-safe-continuation',
		'cross-source-reciprocal-dependency',
	]);
	assert.equal(catalog.policies.sourceTransitionRecoveryVersion, 1);
	assert.deepEqual(catalog.policies.sourceTransitionRecoveryFeatures, [
		'terminal-after-state-verification',
		'same-plan-forward-continuation',
		'compare-aware-compensation',
		'cross-file-transition-journal',
	]);
	assert.equal(JSON.stringify(catalog).includes('externalCalendars'), false);
	assert.equal(JSON.stringify(catalog).includes('reminderSoundFilePath'), false);
}

function testFileTaskTemplateCandidates(): void {
	const result = buildLivePropertyCatalogV1(settings(), {
		fileTaskTemplateCandidates: [
			{
				id: 'folder:Templates/Project.md',
				name: 'Project',
				kind: 'folder',
				sourcePath: 'Templates/Project.md',
			},
			{
				id: 'builtin-pipeline-minimal:pl_project',
				name: 'Minimal Project',
				kind: 'builtin-pipeline-minimal',
				pipelineId: 'pl_project',
				initialStatusId: 'st_project_brainstorming',
			},
		],
	});
	assert.equal(result.ok, true);
	if (!result.ok) return;
	const candidates = result.value.policies.creation.fileTaskTemplateCandidates ?? [];
	assert.deepEqual(candidates.map(candidate => candidate.id), [
		'builtin-pipeline-minimal:pl_project',
		'folder:Templates/Project.md',
	]);
	for (const candidate of candidates) {
		assert.equal('content' in candidate, false);
		assert.equal('body' in candidate, false);
		assert.equal('revision' in candidate, false);
	}
}

function testCustomKeysAndCollisions(): void {
	const customSettings = settings();
	customSettings.keyMappings.push(customMapping('clientReference', 'Client', 'text', 0));
	customSettings.keyMappings.push(customMapping('budget', 'Budget', 'number', 1));
	customSettings.keyMappings.push(customMapping('approved', 'Approved', 'checkbox', 2));
	const result = buildLivePropertyCatalogV1(customSettings);
	assert.equal(result.ok, true);
	if (!result.ok) return;
	for (const [key, type] of [
		['clientReference', 'text'],
		['budget', 'number'],
		['approved', 'checkbox'],
	] as const) {
		const descriptor: FieldDescriptorV1 | undefined = result.value.fields.find(
			candidate => candidate.canonicalKey === key,
		);
		assert.equal(descriptor?.valueType, type);
		assert.equal(descriptor?.mappingStatus, 'mapped');
		assert.equal(descriptor?.mutationClass, 'general-update');
		assert.equal(isGeneralUpdateFieldV1(descriptor!), true);
	}
	assert.equal(
		result.value.fields.find(field => field.canonicalKey === 'clientReference')?.description,
		'Sanitized custom field',
	);

	const visibleCollisionSettings = settings();
	const priority = visibleCollisionSettings.keyMappings.find(mapping => mapping.canonicalKey === 'priority')!;
	visibleCollisionSettings.keyMappings.push(customMapping('clientReference', priority.visiblePropertyName, 'text', 0));
	const visibleCollision = buildLivePropertyCatalogV1(visibleCollisionSettings);
	assert.equal(visibleCollision.ok, true);
	if (visibleCollision.ok) {
		assert.equal(
			visibleCollision.value.fields.find(field => field.canonicalKey === 'priority')?.mappingStatus,
			'collision',
		);
		assert.equal(
			visibleCollision.value.fields.find(field => field.canonicalKey === 'clientReference')?.readable,
			false,
		);
		assert.equal(visibleCollision.value.policies.taskUpdate.writableKeys.includes('priority'), false);
		assert.equal(visibleCollision.value.policies.taskUpdate.writableKeys.includes('clientReference'), false);
	}

	const reminderCollisionSettings = settings();
	reminderCollisionSettings.keyMappings = reminderCollisionSettings.keyMappings
		.filter(mapping => mapping.canonicalKey !== 'reminderRules');
	reminderCollisionSettings.keyMappings.push(customMapping('reminderRules', 'MyReminderRules', 'list', 0));
	const reminderCollision = buildLivePropertyCatalogV1(reminderCollisionSettings);
	assert.equal(reminderCollision.ok, true);
	if (reminderCollision.ok) {
		const field = reminderCollision.value.fields.find(candidate => candidate.canonicalKey === 'reminderRules');
		assert.equal(field?.source, 'built-in');
		assert.equal(field?.mappingStatus, 'collision');
		assert.equal(field?.readable, false);
		assert.equal(isGeneralUpdateFieldV1(field!), false);
		assert.equal(
			reminderCollision.value.policies.reminders.fields.find(policy => policy.canonicalKey === 'reminderRules')?.availability,
			'collision',
		);
	}

	const virtualCollisionSettings = settings();
	virtualCollisionSettings.keyMappings.push(customMapping('description', 'Custom Description', 'text', 0));
	const virtualCollision = buildLivePropertyCatalogV1(virtualCollisionSettings);
	assert.equal(virtualCollision.ok, true);
	if (virtualCollision.ok) {
		const descriptions = virtualCollision.value.fields.filter(field => field.canonicalKey === 'description');
		assert.equal(descriptions.length, 1);
		assert.equal(descriptions[0]?.source, 'built-in');
		assert.equal(virtualCollision.value.warnings.some(warning => warning.code === 'field-mapping-collision'), true);
	}

	const internalSettings = settings();
	const internal = customMapping('__proto__', 'Unsafe', 'text', 0);
	internal.isInternal = true;
	internalSettings.keyMappings.push(internal);
	const internalResult = buildLivePropertyCatalogV1(internalSettings);
	assert.equal(internalResult.ok, true);
	if (internalResult.ok) {
		assert.equal(internalResult.value.fields.some(field => field.canonicalKey === '__proto__'), false);
		assert.equal(internalResult.value.policies.taskUpdate.writableKeys.includes('__proto__'), false);
	}
}

function testTaxonomyAndPolicyFreshness(): void {
	const baselineSettings = settings();
	const baseline = buildLivePropertyCatalogV1(baselineSettings);
	assert.equal(baseline.ok, true);
	if (!baseline.ok) return;

	const described = settings();
	described.pipelines[0].description = 'Updated live pipeline guidance';
	described.priorities[0].description = 'Updated live priority guidance';
	described.keyMappings.find(mapping => mapping.canonicalKey === 'contexts')!.description = 'Updated field guidance';
	const next = buildLivePropertyCatalogV1(described);
	assert.equal(next.ok, true);
	if (!next.ok) return;
	assert.notEqual(next.value.catalogRevision, baseline.value.catalogRevision);
	assert.equal(next.value.taxonomy.pipelines[0]?.description, 'Updated live pipeline guidance');
	assert.equal(next.value.taxonomy.priorities[0]?.description, 'Updated live priority guidance');
	assert.equal(next.value.fields.find(field => field.canonicalKey === 'contexts')?.description, 'Updated field guidance');

	const uiOnly = settings();
	uiOnly.inlineRowWidth = 999;
	uiOnly.language = 'tr';
	uiOnly.reminderSoundFilePath = 'Private/Sound.mp3';
	const uiCatalog = buildLivePropertyCatalogV1(uiOnly);
	assert.equal(uiCatalog.ok, true);
	if (uiCatalog.ok) assert.equal(uiCatalog.value.catalogRevision, baseline.value.catalogRevision);

	const ambiguous = settings();
	ambiguous.pipelines.push({
		...structuredClone(ambiguous.pipelines[0]),
		id: 'pl_duplicate',
	});
	const ambiguousResult = buildLivePropertyCatalogV1(ambiguous);
	assert.equal(ambiguousResult.ok, true);
	if (ambiguousResult.ok) {
		assert.equal(ambiguousResult.value.taxonomy.defaultPipeline.status, 'ambiguous');
		assert.equal(ambiguousResult.value.warnings.some(warning => warning.code === 'taxonomy-identity-ambiguous'), true);
	}
}

function testBoundsAndIsolation(): void {
	const source = settings();
	const first = buildLivePropertyCatalogV1(source);
	assert.equal(first.ok, true);
	if (!first.ok) return;
	first.value.taxonomy.pipelines[0]!.name = 'Consumer mutation';
	first.value.fields[0]!.displayName = 'Consumer mutation';
	assert.equal(source.pipelines[0].name, 'Project');
	const rebuilt = buildLivePropertyCatalogV1(source);
	assert.equal(rebuilt.ok, true);
	if (rebuilt.ok) {
		assert.equal(rebuilt.value.taxonomy.pipelines[0]?.name, 'Project');
		assert.notEqual(rebuilt.value.fields[0]?.displayName, 'Consumer mutation');
	}

	const overflow = settings();
	for (let index = 0; index < 600; index++) {
		overflow.keyMappings.push(customMapping(`custom${index}`, `Custom ${index}`, 'text', index));
	}
	const overflowResult = buildLivePropertyCatalogV1(overflow);
	assert.equal(overflowResult.ok, false);
	assert.equal(overflowResult.ok ? undefined : overflowResult.error.code, 'projection-too-broad');
}

function testFullContractParity(): void {
	const built = buildLivePropertyCatalogV1(settings());
	assert.equal(built.ok, true);
	if (!built.ok) return;
	const fingerprint = computeContextSettingsFingerprintV1(settings());
	const result: OperonCatalogV1 = {
		contractVersion: 1,
		requestId: 'catalog-test-001',
		kind: 'catalog-result',
		ok: true,
		freshness: {
			source: 'live-runtime',
			coherence: 'verified',
			observedAt: '2026-07-23T12:00:00.000Z',
			settled: true,
		},
		warnings: built.value.warnings,
		contextRevision: {
			index: {
				sessionId: 'runtime-test',
				ramGeneration: 1,
				durable: { status: 'missing' },
			},
			settingsFingerprint: fingerprint,
			pinnedGeneration: 0,
			activeTrackerGeneration: 0,
			repeatSeriesRevision: 0,
			projectSerialGeneration: 0,
			projectSerialSignature: 'b'.repeat(64),
		},
		settingsFingerprint: fingerprint,
		catalogRevision: built.value.catalogRevision,
		taxonomy: built.value.taxonomy,
		fields: built.value.fields,
		policies: built.value.policies,
	};
	const decoded = decodeOperonCatalogV1(result);
	assert.equal(decoded.ok, true, JSON.stringify(decoded));
	if (decoded.ok) assert.equal(decoded.value.catalogRevision, result.catalogRevision);
	const olderRuntimeResult = structuredClone(result);
	delete olderRuntimeResult.policies.creation.typedCreateVersion;
	delete olderRuntimeResult.policies.creation.typedCreateFeatures;
	delete olderRuntimeResult.policies.creation.fileTaskTemplateCandidates;
	delete olderRuntimeResult.policies.creation.temporalCreateVersion;
	delete olderRuntimeResult.policies.creation.temporalCreateKeys;
	delete olderRuntimeResult.policies.creation.compactBatchVersion;
	delete olderRuntimeResult.policies.creation.compactBatchInputFormat;
	delete olderRuntimeResult.policies.creation.compactBatchMaxItems;
	delete olderRuntimeResult.policies.creation.graphTransactionVersion;
	delete olderRuntimeResult.policies.creation.graphTransactionFeatures;
	delete olderRuntimeResult.policies.taskUpdate.compactUpdateBatchVersion;
	delete olderRuntimeResult.policies.taskUpdate.compactUpdateBatchInputFormat;
	delete olderRuntimeResult.policies.taskUpdate.compactUpdateBatchMaxItems;
	delete olderRuntimeResult.policies.taskUpdate.compactUpdateBatchFeatures;
	delete olderRuntimeResult.policies.sourceTransitionRecoveryVersion;
	delete olderRuntimeResult.policies.sourceTransitionRecoveryFeatures;
	olderRuntimeResult.catalogRevision = catalogRevision(olderRuntimeResult);
	assert.equal(decodeOperonCatalogV1(olderRuntimeResult).ok, true);
	const partialTemporalAdvertisement = structuredClone(result);
	delete partialTemporalAdvertisement.policies.creation.temporalCreateKeys;
	partialTemporalAdvertisement.catalogRevision = catalogRevision(partialTemporalAdvertisement);
	assert.equal(decodeOperonCatalogV1(partialTemporalAdvertisement).ok, false);
	const partialCompactBatchAdvertisement = structuredClone(result);
	delete partialCompactBatchAdvertisement.policies.creation.compactBatchMaxItems;
	partialCompactBatchAdvertisement.catalogRevision = catalogRevision(partialCompactBatchAdvertisement);
	assert.equal(decodeOperonCatalogV1(partialCompactBatchAdvertisement).ok, false);
	const partialCompactUpdateBatchAdvertisement = structuredClone(result);
	delete partialCompactUpdateBatchAdvertisement.policies.taskUpdate.compactUpdateBatchFeatures;
	partialCompactUpdateBatchAdvertisement.catalogRevision = catalogRevision(
		partialCompactUpdateBatchAdvertisement,
	);
	assert.equal(decodeOperonCatalogV1(partialCompactUpdateBatchAdvertisement).ok, false);
	const invalidCompactBatchMaximum = structuredClone(result);
	invalidCompactBatchMaximum.policies.creation.compactBatchMaxItems = 63 as 64;
	invalidCompactBatchMaximum.catalogRevision = catalogRevision(invalidCompactBatchMaximum);
	assert.equal(decodeOperonCatalogV1(invalidCompactBatchMaximum).ok, false);
	const partialTypedCreateAdvertisement = structuredClone(result);
	delete partialTypedCreateAdvertisement.policies.creation.typedCreateFeatures;
	partialTypedCreateAdvertisement.catalogRevision = catalogRevision(partialTypedCreateAdvertisement);
	assert.equal(decodeOperonCatalogV1(partialTypedCreateAdvertisement).ok, false);
	const reorderedTypedCreateAdvertisement = structuredClone(result);
	const typedCreateFeatures = reorderedTypedCreateAdvertisement.policies.creation.typedCreateFeatures;
	if (typedCreateFeatures) typedCreateFeatures.reverse();
	reorderedTypedCreateAdvertisement.catalogRevision = catalogRevision(reorderedTypedCreateAdvertisement);
	assert.equal(decodeOperonCatalogV1(reorderedTypedCreateAdvertisement).ok, false);
	const partialGraphTransactionAdvertisement = structuredClone(result);
	delete partialGraphTransactionAdvertisement.policies.creation.graphTransactionFeatures;
	partialGraphTransactionAdvertisement.catalogRevision = catalogRevision(partialGraphTransactionAdvertisement);
	assert.equal(decodeOperonCatalogV1(partialGraphTransactionAdvertisement).ok, false);
	const reorderedGraphTransactionAdvertisement = structuredClone(result);
	const graphFeatures = reorderedGraphTransactionAdvertisement.policies.creation.graphTransactionFeatures;
	if (graphFeatures) graphFeatures.reverse();
	reorderedGraphTransactionAdvertisement.catalogRevision = catalogRevision(reorderedGraphTransactionAdvertisement);
	assert.equal(decodeOperonCatalogV1(reorderedGraphTransactionAdvertisement).ok, false);
	const partialSourceTransitionAdvertisement = structuredClone(result);
	delete partialSourceTransitionAdvertisement.policies.sourceTransitionRecoveryFeatures;
	partialSourceTransitionAdvertisement.catalogRevision = catalogRevision(
		partialSourceTransitionAdvertisement,
	);
	assert.equal(decodeOperonCatalogV1(partialSourceTransitionAdvertisement).ok, false);
	const reorderedSourceTransitionAdvertisement = structuredClone(result);
	const sourceTransitionFeatures =
		reorderedSourceTransitionAdvertisement.policies.sourceTransitionRecoveryFeatures;
	if (sourceTransitionFeatures) sourceTransitionFeatures.reverse();
	reorderedSourceTransitionAdvertisement.catalogRevision = catalogRevision(
		reorderedSourceTransitionAdvertisement,
	);
	assert.equal(decodeOperonCatalogV1(reorderedSourceTransitionAdvertisement).ok, false);
	const contentBearingTemplateCandidate = structuredClone(result);
	contentBearingTemplateCandidate.policies.creation.fileTaskTemplateCandidates = [{
		id: 'folder:Templates/Project.md',
		name: 'Project',
		kind: 'folder',
		sourcePath: 'Templates/Project.md',
		content: '# Hidden template body',
	}] as unknown as FileTaskTemplateCandidateV1[];
	contentBearingTemplateCandidate.catalogRevision = catalogRevision(contentBearingTemplateCandidate);
	assert.equal(decodeOperonCatalogV1(contentBearingTemplateCandidate).ok, false);
	const partialFailure = {
		...structuredClone(result),
		ok: false,
		error: {
			contractVersion: 1,
			code: 'live-settling',
			reason: 'Synthetic settling result.',
			retryable: true,
		},
	};
	assert.equal(decodeOperonCatalogV1(partialFailure).ok, false);
}

function catalogRevision(result: OperonCatalogV1): string {
	return sha256HexV1(canonicalJsonV1(toJsonValueV1({
		settingsFingerprint: result.settingsFingerprint,
		taxonomy: result.taxonomy,
		fields: result.fields,
		policies: result.policies,
	})));
}

async function testWarmPerformance(): Promise<void> {
	const source = settings();
	const timings: number[] = [];
	for (let index = 0; index < 50; index++) {
		const startedAt = performance.now();
		const result = buildLivePropertyCatalogV1(source);
		assert.equal(result.ok, true);
		timings.push(performance.now() - startedAt);
	}
	timings.sort((left, right) => left - right);
	assert.ok(timings[Math.floor(timings.length * 0.95)]! < 50);
}

function settings(): OperonSettings {
	return structuredClone(DEFAULT_SETTINGS);
}

function customMapping(
	canonicalKey: string,
	visiblePropertyName: string,
	type: KeyMapping['type'],
	customOrder: number,
): KeyMapping {
	return {
		canonicalKey,
		visiblePropertyName,
		type,
		sync: 'yes',
		enabled: true,
		isSystem: false,
		customOrder,
		description: 'Sanitized custom field',
	};
}
