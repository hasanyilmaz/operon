import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const [mainSource, taskEditorSource, settingsSource, settingsTabSource, profileStoreSource, catalogBuilderSource, publicCatalogSource, publicDecodeSource, registrySource, moverSource, registrationSource, backfillSource] = await Promise.all([
	readFile(new URL('../main.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/ui/task-editor-content.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/types/settings.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/ui/settings-tab.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/storage/task-creation-profile-store.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/agent-runtime/runtime/catalog-builder.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/agent-runtime/contracts/v1/catalog.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/agent-runtime/contracts/v1/decode.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/storage/periodic-note-container-registry.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/systems/file-task-pipeline-mover.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/core/periodic-note-container-registration.ts', import.meta.url), 'utf8'),
	readFile(new URL('../src/core/periodic-note-container-backfill.ts', import.meta.url), 'utf8'),
]);

function method(source, name, next) {
	const start = source.indexOf(`\tprivate ${name}`);
	const end = source.indexOf(`\n\tprivate ${next}`, start + 1);
	assert.notEqual(start, -1, `${name} should exist`);
	assert.notEqual(end, -1, `${next} should follow ${name}`);
	return source.slice(start, end);
}

test('Weekly Notes is a persisted Task Router destination in the intended order', () => {
	assert.match(settingsSource, /InlineTaskSaveMode = 'daily-notes' \| 'weekly-notes' \| 'specific-file'/);
	assert.match(settingsSource, /raw === 'weekly-notes'/);
	assert.match(profileStoreSource, /raw\.inlineTaskSaveMode === 'weekly-notes'/);
	assert.match(settingsTabSource, /text === 'weekly-notes'/);
	assert.match(settingsTabSource, /'weekly-notes': t\('settings', 'inlineTaskSavePathWeeklyNotes'\)/);
	const daily = settingsTabSource.indexOf("{ value: 'daily-notes'");
	const weekly = settingsTabSource.indexOf("{ value: 'weekly-notes'");
	const specific = settingsTabSource.indexOf("{ value: 'specific-file'");
	const active = settingsTabSource.indexOf("{ value: 'active-file'");
	const ask = settingsTabSource.indexOf("{ value: 'ask-every-time'");
	assert.ok(daily < weekly && weekly < specific && specific < active && active < ask);
});

test('Weekly Task Router target uses the shared periodic adapter and a Daily-format day heading', () => {
	const resolver = method(
		mainSource,
		'async resolveTaskCreatorInlineTargetFile(',
		'async resolvePeriodicNoteFileTaskContainer(',
	);
	assert.match(resolver, /if \(saveMode === 'weekly-notes'\)/);
	assert.match(resolver, /resolveOrCreatePeriodicNoteResult\('weekly', targetDateKey\)/);
	assert.match(resolver, /resolvePeriodicNoteFileTaskContainer\(weeklyNote\)/);
	assert.match(resolver, /resolvePeriodicNoteFileTaskContainer\(dailyNote\)/);
	assert.match(
		resolver,
		/autoParentEnabled: dailyNote\.config\?\.createAsOperonTask \? false : undefined/,
		'Daily routing must not bypass a rejected periodic container through legacy raw-frontmatter auto-parenting',
	);
	assert.match(resolver, /dailyDateHeading: await this\.resolveWeeklyNoteDailyDateHeading\(targetDateKey\)/);
	assert.match(resolver, /autoParentEnabled: false/);

	const heading = method(
		mainSource,
		'async resolveWeeklyNoteDailyDateHeading(',
		'buildTaskCreatorInlineTaskLine(',
	);
	assert.match(heading, /await this\.resolveEffectiveDailyNoteConfig\(\)/);
	assert.match(heading, /formatPeriodicNoteTitleFromDateKey\('daily', dateKey, dailyConfig\.config\.format\)/);
	assert.match(heading, /`## \[\[\$\{dailyTitle \?\? dateKey\}\]\]`/);
});

test('Weekly disabled or invalid management fails before writing and reports a localized reason', () => {
	const adapter = method(
		mainSource,
		'async resolveOrCreatePeriodicNoteResult(',
		'async resolvePeriodicParentConfigs(',
	);
	const configIndex = adapter.indexOf('await this.resolveEffectivePeriodicNoteConfig(kind)');
	const serviceIndex = adapter.indexOf('this.getPeriodicNoteService().getOrCreate');
	assert.ok(configIndex >= 0 && serviceIndex > configIndex);
	assert.match(adapter, /kind === 'weekly' && resolvedConfig\.reason === 'operon-disabled'/);
	assert.match(adapter, /weeklyNotesManagementDisabled/);
	assert.match(adapter, /resolvedConfig\.reason === 'invalid-config'/);
});

test('Weekly File Task container parenting is opt-in and explicit parent clear wins', () => {
	const container = method(
		mainSource,
		'async resolvePeriodicNoteFileTaskContainer(',
		'resolveInlineTaskTargetFilePath(',
	);
	assert.match(container, /!periodicNote\.config\?\.createAsOperonTask/);
	assert.match(container, /getFileTaskByPath\(periodicNote\.file\.path\)/);
	assert.match(container, /managedFieldValues\['operonId'\]/);
	assert.match(container, /resolvePeriodicNoteContainerTask\(\{/);
	assert.match(container, /wasCreated: periodicNote\.wasCreated/);
	assert.match(container, /hasDuplicateOperonIdConflict: this\.indexer\.hasDuplicateOperonIdConflict\(parsedOperonId\)/);

	const defaultInsertion = method(
		mainSource,
		'async insertTaskCreatorInlineTaskUsingDefaultTarget(',
		'async insertTaskCreatorInlineTaskBelowInlineParent(',
	);
	assert.match(defaultInsertion, /isTaskCreatorFieldExplicitlyCleared\(draft, 'parentTask'\)/);
	assert.match(defaultInsertion, /resolveTaskCreatorScheduledPeriodicParent\(draft\)/);
	assert.match(defaultInsertion, /fallbackParentTaskId: parentTaskExplicitlyCleared \|\| useScheduledPeriodicParent/);
	assert.match(defaultInsertion, /autoParentEnabled:.*?false/s);

	const routedInsertion = method(
		mainSource,
		'async insertTaskCreatorInlineTaskWithResolvedTarget(',
		'async createInlineTaskFromCreatorDraftResult(',
	);
	assert.ok(
		routedInsertion.indexOf('if (options.parentAwarePlacement !== false)')
			< routedInsertion.indexOf('insertTaskCreatorInlineTaskUsingDefaultTarget'),
		'parent-aware placement must win before the Weekly default route',
	);

	const calendarCreation = method(
		mainSource,
		'async createCalendarInlineTaskFromCreatorDraft(',
		'async resolveOrCreateCalendarDailyNote(',
	);
	assert.match(
		calendarCreation,
		/if \(!hasExplicitParentTask && saveMode !== 'weekly-notes'\)/,
		'Calendar must not suppress parent-aware placement for Weekly routing',
	);
});

test('scheduled-date planning uses the shared Daily/Weekly parent resolver without moving task sources', () => {
	const resolver = method(
		mainSource,
		'async maybeApplyPeriodicNoteParentRealignmentToPayload(',
		'async ensureParentFolderPathExists(',
	);
	assert.match(resolver, /resolvePeriodicParentConfigs\(\)/);
	assert.match(resolver, /classifyIndexedPeriodicFileTask/);
	assert.match(resolver, /resolvePeriodicParentRealignment\(\{/);
	assert.match(resolver, /resolveOrCreatePeriodicNoteParentTaskId/);
	assert.match(resolver, /wouldCreatePeriodicParentCycle/);
	assert.match(resolver, /payload\['parentTask'\] = ''/);
	assert.match(resolver, /getPeriodicParentBootstrapKind/);
	assert.doesNotMatch(resolver, /move|rename|replaceInlineTaskById/);

	assert.doesNotMatch(mainSource, /queueCalendarDailyNoteParentSeedBackgroundEnsure/);
	assert.doesNotMatch(mainSource, /applyCalendarDailyNoteParentSeedForCreatorSubmit/);
	assert.match(taskEditorSource, /parentTaskIntent\?: 'unchanged' \| 'explicitly-set' \| 'explicitly-cleared'/);
	assert.match(taskEditorSource, /dateScheduledIntent\?: 'unchanged' \| 'explicitly-set' \| 'explicitly-cleared'/);
});

test('durable periodic container identities survive config changes and fail closed for the pipeline mover', () => {
	assert.match(registrySource, /PERIODIC_NOTE_CONTAINER_REGISTRY_VERSION = 1/);
	assert.match(registrySource, /forceAtomicReplacement: true/);
	assert.match(registrySource, /Periodic container registry has a newer unsupported version/);
	assert.match(registrySource, /lastKnownPath !== task\.primary\.filePath/);
	assert.match(registrySource, /kind: 'mismatch'/);
	assert.match(registrySource, /recordVerifiedRename/);
	assert.match(registrySource, /recordVerifiedDelete/);
	assert.match(registrySource, /recordVerifiedDeleteByPath/);
	assert.match(registrySource, /status: 'clean-failure'/);
	assert.match(registrySource, /status: 'uncertain'/);
	assert.match(registrySource, /containers: \[\.\.\.next\.values\(\)\][\s\S]*?sort\(compareEntries\)/);
	assert.match(registrationSource, /service-owned create evidence/);
	assert.match(registrationSource, /registration === 'clean-failure' && snapshot/);
	assert.match(registrationSource, /deleteFileIfContentMatches\(snapshot\.path, snapshot\.content\)/);
	assert.match(backfillSource, /if \(result\.status === 'completed'\)/);
	assert.match(backfillSource, /ports\.markPipelineReconciliationReady\(\)/);
	assert.match(backfillSource, /await ports\.resumePipelineReconciliation\(\)/);

	assert.match(mainSource, /this\.storage\.periodicNoteContainers\.lookup\(task\)/);
	assert.match(mainSource, /registered\.kind !== 'none'\) return true/);
	assert.match(mainSource, /registered\.kind === 'ambiguous' \|\| registered\.kind === 'mismatch' \|\| registered\.kind === 'unhealthy'/);
	assert.match(mainSource, /async ensurePeriodicNoteContainerRegistered\([\s\S]*?reindexFilePath\(file\.path, \{ notify: false \}\)[\s\S]*?periodicNoteContainers\.register/);
	const periodicCreate = method(
		mainSource,
		'async resolveOrCreatePeriodicNoteResult(',
		'async resolvePeriodicParentConfigs(',
	);
	assert.match(mainSource, /createPeriodicNoteCreatedFileSnapshot\(result\.path, result\.operationOwnedContent\)/);
	assert.doesNotMatch(periodicCreate, /cachedRead\(file\)/);
	assert.match(mainSource, /resolvePeriodicNoteContainerRegistrationDisposition\([\s\S]*?registration\.status[\s\S]*?createdSnapshot/);
	assert.match(mainSource, /rollbackPeriodicNoteCreatedFileSnapshot\([\s\S]*?deletePeriodicNoteIfContentMatches\(path, expectedContent\)/);
	assert.match(mainSource, /async backfillPeriodicNoteContainerRegistry\([\s\S]*?backfillPeriodicNoteContainersBeforePipelineResume\([\s\S]*?resolveHistoricalPeriodicParentConfigs/);
	assert.match(mainSource, /await this\.backfillPeriodicNoteContainerRegistry\(\);/);
	assert.match(mainSource, /this\.startupReady = true;/);
	assert.match(mainSource, /markPipelineReconciliationReady: \(\) => \{[\s\S]*?periodicContainerRegistryReadyForMover = true/);
	assert.match(mainSource, /periodicContainerRegistryReadyForMover[\s\S]*?&& this\.storage\.periodicNoteContainers\.isHealthy\(\)/);
	assert.match(mainSource, /recordPeriodicContainerVerifiedRename\(indexedBeforeRename, oldPath, file\.path\)/);
	assert.match(mainSource, /recordPeriodicContainerVerifiedDelete\(indexedBeforeDelete, file\.path\)/);

	assert.match(moverSource, /canReconcile\?: \(\) => boolean/);
	assert.match(moverSource, /if \(!this\.canReconcile\(\)\) return;/);
	assert.match(moverSource, /if \(!this\.canReconcile\(\)\) return 'suspended';/);
	assert.match(moverSource, /outcome === 'failed' \|\| outcome === 'suspended'/);
});

test('Task Editor semantic saves resolve periodic parent companions before coordinator dispatch', () => {
	const instanceSave = method(
		mainSource,
		'async applyEditedTaskInstanceFromView(',
		'scheduleIndexSideEffects(',
	);
	const ordinarySave = method(
		mainSource,
		'async applyEditedTaskFromView(',
		'preserveAuthoritativeRepeatOccurrenceDate(',
	);
	for (const source of [instanceSave, ordinarySave]) {
		const semanticStart = source.indexOf('if (semanticTransition && !semanticTransition.requiresLegacySave)');
		const periodic = source.indexOf('await this.maybeApplyPeriodicNoteParentRealignmentToPayload', semanticStart);
		const rebuilt = source.indexOf('const resolvedSemanticTransition = this.resolveTaskEditorSemanticTransition', periodic);
		const coordinator = source.indexOf('return await this.applyUiSemanticTransition(', rebuilt);
		assert.ok(semanticStart >= 0 && periodic > semanticStart && rebuilt > periodic && coordinator > rebuilt);
		assert.match(source.slice(periodic, coordinator), /setParsedTaskField\(parsed, 'parentTask'/);
	}
});

test('standard indexed inline editor saves use the shared mutation path while retaining a stale-index fallback', () => {
	const editorSave = method(
		mainSource,
		'openInlineTaskEditorForLine(',
		'upgradePlainCheckboxLineToOperonInlineTask(',
	);
	const initiallyIndexed = editorSave.indexOf('const initiallyIndexedTask = task.operonId');
	const sourceView = editorSave.indexOf('const sourceView = this.getMarkdownViewsForPath(filePath)', initiallyIndexed);
	const persist = editorSave.indexOf('await this.persistMarkdownViewBuffer(sourceView)', sourceView);
	const reindex = editorSave.indexOf('await this.indexer.forceReindexFilePathAfterMutation(filePath, { notify: false })', persist);
	const indexed = editorSave.indexOf('const indexedTask = this.indexer.getTask(initiallyIndexedTask.operonId)', reindex);
	const body = editorSave.indexOf('request.fileBody = {', indexed);
	const shared = editorSave.indexOf('await this.applyEditedTaskFromView(indexedTask, request)', body);
	const fallback = editorSave.indexOf('A line that is not indexed yet', shared);
	assert.ok(
		initiallyIndexed >= 0 && sourceView > initiallyIndexed && persist > sourceView && reindex > persist
		&& indexed > reindex && body > indexed && shared > body && fallback > shared,
	);
	assert.match(editorSave, /find\(view => view\.editor === editor\)/);
	assert.match(editorSave, /content: sourceBody/);
	assert.match(editorSave, /splitFrontmatterDocument\(sourceContent\)\.body/);
	assert.match(editorSave, /targetLine: bodyTargetLine/);
	assert.match(editorSave.slice(fallback), /await this\.persistInlineEditorBufferAndReindex\(filePath\)/);
});

test('Live Preview fallback reindexes and refreshes old/new parent aggregates after its local write', () => {
	const fallback = method(
		mainSource,
		'async updateLivePreviewInlineFieldsFallback(',
		'getInlineFieldTypeForKey(',
	);
	const reindex = fallback.indexOf('await this.indexer.forceReindexFilePathAfterMutation');
	const aggregate = fallback.indexOf('await this.refreshAggregateTotalsAfterTaskMutation', reindex);
	const refresh = fallback.indexOf('this.refreshViews()', aggregate);
	assert.ok(reindex >= 0 && aggregate > reindex && refresh > aggregate);
	assert.match(fallback, /let beforeTask: IndexedTask \| null = null/);
	assert.match(fallback, /modifiedTimestamp: now/);
	assert.match(fallback, /autoUnpinCandidate: afterTask/);
	assert.doesNotMatch(fallback, /scheduleReindex\(restoreCursor\.filePath\)/);
});

test('unexpected periodic parent failures leave scheduling/creation safe and show the localized notice', () => {
	const resolver = method(
		mainSource,
		'async maybeApplyPeriodicNoteParentRealignmentToPayload(',
		'async ensureParentFolderPathExists(',
	);
	assert.match(resolver, /try \{/);
	assert.match(resolver, /catch \(error\) \{[\s\S]*?periodic parent realignment failed[\s\S]*?showPeriodicParentUnchangedNotice\(\)/);

	const container = method(
		mainSource,
		'async resolveOrCreatePeriodicNoteParentTaskId(',
		'async maybeApplyPeriodicNoteParentRealignmentToPayload(',
	);
	assert.match(container, /catch \(error\) \{[\s\S]*?periodic parent container resolution failed[\s\S]*?noticeShown: true/);

	const creation = method(
		mainSource,
		'async resolveTaskCreatorScheduledPeriodicParent(',
		'async insertTaskCreatorInlineTaskUsingDefaultTarget(',
	);
	assert.match(creation, /catch \(error\) \{[\s\S]*?scheduled periodic parent bootstrap failed[\s\S]*?attempted: true/);
});

test('Daily routing propagates its Notice state so the generic creator does not duplicate it', () => {
	const resolver = method(
		mainSource,
		'async resolveTaskCreatorInlineTargetFile(',
		'async insertTaskCreatorInlineTaskUsingDefaultTarget(',
	);
	assert.match(
		resolver,
		/if \(!dailyNote\.noticeShown\) new Notice\(t\('notifications', 'dailyNoteResolveFailed'\)\);[\s\S]*?return \{ kind: 'failed', noticeShown: true \}/,
	);
});

test('cursorless file-to-inline conversion cannot create a Weekly file', () => {
	const conversion = method(
		mainSource,
		'async convertFileTaskToInlineTask(',
		'createRepeatSeriesIdFactory(',
	);
	const weeklyGuard = conversion.indexOf("this.resolveEffectiveInlineTaskSaveMode() === 'weekly-notes'");
	const targetResolve = conversion.indexOf('await this.resolveTaskCreatorInlineTargetFile({');
	assert.ok(weeklyGuard >= 0 && targetResolve > weeklyGuard);
	assert.match(conversion, /weeklyNotesConversionRequiresCursor/);
});

test('Runtime V1 projects Weekly Notes to Ask Every Time and rejects implicit creation without changing frozen public vocabulary', () => {
	assert.match(catalogBuilderSource, /settings\.inlineTaskSaveMode === 'weekly-notes'\s*\? 'ask-every-time'/);
	const runtimeTarget = method(
		mainSource,
		'async resolveAgentRuntimeInlineCreationPath(',
		'async resolveAgentRuntimeInlineCreationTarget(',
	);
	assert.match(runtimeTarget, /saveMode === 'weekly-notes'/);
	assert.match(runtimeTarget, /Weekly Notes inline routing is not available to Runtime V1/);
	assert.doesNotMatch(publicCatalogSource, /weekly-notes/);
	assert.doesNotMatch(publicDecodeSource, /weekly-notes/);
});
