import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewSource = await readFile(path.join(rootDir, 'src/ui/kanban/kanban-view.ts'), 'utf8');
const mainSource = await readFile(path.join(rootDir, 'main.ts'), 'utf8');

test('desktop native, mobile pointer, and keyboard drops share one completion method', () => {
	const completionCalls = viewSource.match(/this\.completeKanbanCardDrop\(/gu) ?? [];
	assert.equal(completionCalls.length, 3);
	assert.match(viewSource, /cell\.addEventListener\('drop',[\s\S]*?this\.completeKanbanCardDrop\(/u);
	assert.match(viewSource, /const commitMobileCardDrag[\s\S]*?this\.completeKanbanCardDrop\(/u);
});

test('only mobile pointer drops hold global refresh until persistence settles', () => {
	assert.match(
		viewSource,
		/const commitMobileCardDrag[\s\S]*?this\.completeKanbanCardDrop\(targetCell, dragged, context, targetBeforeTaskId, preset, true\)/u,
	);
	assert.match(viewSource, /freezeRefreshUntilSettled[\s\S]*?mobileDropPersistenceGate\.begin\(\)/u);
	assert.match(viewSource, /\.finally\(\(\) => \{[\s\S]*?mobileDropPersistenceGate\.end\(\)[\s\S]*?onDragInteractionEnd/u);
	const desktopDropStart = viewSource.indexOf("cell.addEventListener('drop'");
	const mobileDropStart = viewSource.indexOf('const commitMobileCardDrag');
	const desktopDropSection = viewSource.slice(desktopDropStart, mobileDropStart);
	assert.doesNotMatch(
		desktopDropSection,
		/this\.completeKanbanCardDrop\([^;]*preset, true\)/u,
	);
});

test('view and global refreshes are gated by active Kanban drag state', () => {
	assert.match(viewSource, /private render\(\): void \{\s*if \(this\.dragInteractionGate\.deferRenderIfActive\(\)\) return;/u);
	assert.match(viewSource, /private scheduleRender[\s\S]*?if \(this\.dragInteractionGate\.deferRenderIfActive\(\)\) return;/u);
	assert.match(mainSource, /private shouldFreezeKanbanRefresh[\s\S]*?this\.hasActiveKanbanDragInteraction\(\)/u);
	assert.match(mainSource, /onDragInteractionEnd: \(\) => this\.flushPendingKanbanRefresh\(\)/u);
});

test('verified status movement settles before manual order and never rolls the task back', () => {
	assert.match(viewSource, /Kanban card drop failed[\s\S]*?kanbanActionFailed[\s\S]*?clearOptimisticMove\(context\.taskId, operation\.id\)/u);
	const transition = mainSource.indexOf('runKanbanDropTransition');
	const manualOrder = mainSource.indexOf('await persistManualOrderIfCurrent()', transition);
	assert.ok(transition >= 0);
	assert.ok(manualOrder > transition);
	assert.match(mainSource, /catch \(error\) \{\s*console\.warn\('Operon: Kanban card moved but manual order could not be saved'[\s\S]*?kanbanManualOrderSaveFailed/u);
	assert.doesNotMatch(mainSource, /rollbackManualOrderIfCurrent|manual-order rollback could not be persisted/u);
});

test('drop failure diagnostics preserve sorting and Runtime transition evidence', () => {
	assert.match(viewSource, /buildKanbanDropFailureDiagnostic\(\{[\s\S]*?taskId: context\.taskId[\s\S]*?sourceSortMode[\s\S]*?targetSortMode[\s\S]*?error/u);
	assert.match(mainSource, /attachKanbanDropFailureCause\([\s\S]*?phase: 'transition'[\s\S]*?attemptCount: transitionAttemptCount[\s\S]*?mutationMayHaveApplied/u);
	assert.match(mainSource, /phase: 'target-postflight'[\s\S]*?code: 'target-cell-not-visible'[\s\S]*?mutationMayHaveApplied: true[\s\S]*?mutationStatus: null/u);
	assert.doesNotMatch(mainSource, /rollbackError:\s*rollbackError as unknown/u);
});

test('settings changes invalidate Runtime field-catalog caches before Kanban views refresh', () => {
	assert.match(
		mainSource,
		/private invalidateAgentRuntimeSettingsProjectionCaches\(\): void \{\s*this\.agentRuntimeSettingsFingerprintCache = null;\s*this\.agentRuntimeCatalogCache = null;\s*\}/u,
	);
	assert.match(
		mainSource,
		/private handleSettingsChanged[\s\S]*?invalidateAgentRuntimeSettingsProjectionCaches\(\)[\s\S]*?writer\.updateKeyMappings[\s\S]*?refreshViews\(\)/u,
	);
});

test('Kanban alone opts into unavailable-ancestor tolerance and distinguishes parent from higher ancestor', () => {
	assert.match(
		mainSource,
		/attemptUiSemanticTransition\([\s\S]*?semanticChanges\.changes,[\s\S]*?\{ allowUnavailableAncestors: true \}/u,
	);
	assert.match(
		mainSource,
		/unavailableAncestorWarning[\s\S]*?Kanban card moved with unavailable ancestor[\s\S]*?'\/target\/parentTask'[\s\S]*?kanbanMovedParentUnavailable[\s\S]*?kanbanMovedAncestorUnavailable/u,
	);
	assert.match(
		mainSource,
		/postflightSettlement !== 'target'[\s\S]*?throw postflightError;[\s\S]*?unavailableAncestorWarning/u,
	);
});

test('Runtime mutation settlement forces fresh committed-source visibility', () => {
	assert.match(
		mainSource,
		/reindexAffectedSources: async filePaths => \{\s*await this\.indexer\.reindexCommittedMutationSources\(filePaths, \{ notify: false \}\);\s*\}/u,
	);
});

test('forward manual-order write uses the same expected-state CAS fence', () => {
	assert.match(mainSource, /const persistManualOrderIfCurrent[\s\S]*?replaceCellsIfCurrent\([\s\S]*?previousManualOrderCells[\s\S]*?manualOrderCells/u);
	assert.match(mainSource, /manual order changed before apply/u);
});

test('uncertain mutations refresh explicitly and recurrence replacement is a successful settlement', () => {
	assert.match(mainSource, /mutationMayHaveApplied[\s\S]*?reindexCommittedMutationSources[\s\S]*?classifyKanbanDropSettlement/u);
	assert.match(mainSource, /settlement === 'target' \|\| settlement === 'recurrence-replacement'/u);
	assert.match(mainSource, /settlement === 'source'[\s\S]*?verifiedSourceFailure = true/u);
	assert.match(mainSource, /Kanban card move remains uncertain[\s\S]*?clearOptimisticMove[\s\S]*?refreshViews\(\)[\s\S]*?kanbanMoveUncertain/u);
	assert.match(mainSource, /targetStatus\.isFinished[\s\S]*?resolveKanbanRecurrenceReplacement\(task\)/u);
	assert.match(
		mainSource,
		/resolveKanbanRecurrenceReplacement[\s\S]*?repeatSeries\.getEntry[\s\S]*?indexer\.getTask\(sourceTask\.operonId\)[\s\S]*?resolveKanbanRecurrenceReplacementCandidate/u,
	);
});

test('manual drag behavior resolves source and target column sorting independently', () => {
	assert.match(viewSource, /resolveKanbanEffectiveSorting\(preset, column\.statusId\)\.sortMode === 'manual'/u);
	assert.match(viewSource, /resolveKanbanEffectiveSorting\(preset, targetStatusId\)\.sortMode === 'manual'/u);
	assert.match(mainSource, /const sourceIsManual = context\.sourceStatusId[\s\S]*?resolveKanbanEffectiveSorting\(preset, context\.sourceStatusId\)/u);
	assert.match(mainSource, /const targetIsManual = resolveKanbanEffectiveSorting\(preset, context\.targetStatusId\)/u);
	assert.match(mainSource, /buildKanbanManualDropOrderCells\(preset, context, sourceIsManual, targetIsManual\)/u);
});

test('fresh retry refuses a task that left its original status or swimlane', () => {
	assert.match(mainSource, /attemptIndex > 0[\s\S]*?matchesKanbanDropSource\(\{[\s\S]*?actualStatusId: attemptStatusIdentity\.status\.id/u);
	assert.match(mainSource, /attemptIndex > 0[\s\S]*?actualStatusValue: attemptTask\.fieldValues\['status'\] \?\? ''/u);
	assert.match(mainSource, /attemptIndex > 0[\s\S]*?sourceStatusId: context\.sourceStatusId[\s\S]*?sourceLaneKey: context\.sourceLaneKey/u);
	assert.match(mainSource, /The Kanban source cell changed before retry/u);
});

test('first drop attempt rejects a stale board source before manual-order or Runtime writes', () => {
	const sourceFence = mainSource.indexOf('if (!matchesKanbanDropSource({');
	const manualOrderBuild = mainSource.indexOf('const sourceIsManual', sourceFence);
	const manualOrderApply = mainSource.indexOf('await persistManualOrderIfCurrent()', sourceFence);
	const runtimeApply = mainSource.indexOf('runKanbanDropTransition', sourceFence);
	assert.ok(sourceFence >= 0);
	assert.ok(manualOrderBuild > sourceFence);
	assert.ok(manualOrderApply > sourceFence);
	assert.ok(runtimeApply > sourceFence);
	assert.match(mainSource.slice(sourceFence, manualOrderBuild), /code: 'stale-source'[\s\S]*?mutationMayHaveApplied: false/u);
});

test('pending card drops are operation-owned and mobile commits use the final pointer cell', () => {
	assert.match(viewSource, /cardOperations\.begin\([\s\S]*?context\.taskId,[\s\S]*?preset\.id,[\s\S]*?'drop',[\s\S]*?context\.boardSignature/u);
	assert.match(viewSource, /operationId: operation\.id[\s\S]*?presetId: preset\.id/u);
	assert.match(viewSource, /if \(!this\.cardOperations\.owns\(operation\)\) return;/u);
	assert.match(viewSource, /this\.cardOperations\.end\(operation\)/u);
	assert.match(viewSource, /if \(this\.cardOperations\.isTaskPending\(taskId\)\)[\s\S]*?event\.preventDefault\(\)/u);
	assert.match(viewSource, /const targetCell = resolveMobileDropCell\(event\.clientX, event\.clientY\);/u);
	assert.doesNotMatch(viewSource, /gesture\.activeDropCell \?\? resolveMobileDropCell\(event\.clientX, event\.clientY\)/u);
});

test('interactive descendants cannot start desktop or touch card drags', () => {
	assert.match(viewSource, /KANBAN_CARD_INTERACTIVE_SELECTOR[\s\S]*?'a'[\s\S]*?'button'[\s\S]*?'input'[\s\S]*?'textarea'[\s\S]*?'select'[\s\S]*?contenteditable[\s\S]*?operon-kanban-card-chip-row[\s\S]*?operon-kanban-card-note-preview/u);
	assert.match(viewSource, /dragstart[\s\S]*?isKanbanCardInteractionTarget\(target\)[\s\S]*?event\.preventDefault\(\)[\s\S]*?event\.stopPropagation\(\)/u);
	assert.match(viewSource, /resolveGestureCard[\s\S]*?isKanbanCardInteractionTarget\(target\)/u);
});

test('mobile gesture cleanup covers cancel, blur, scroll intent, and unmount', () => {
	assert.match(viewSource, /removeEventListener\('pointercancel', onMobileCardPointerCancel, true\)[\s\S]*?removeEventListener\('blur', onMobileWindowBlur, true\)[\s\S]*?removeEventListener\('scroll', onMobileWindowScroll, true\)/u);
	assert.match(viewSource, /onMobileWindowScroll[\s\S]*?mobileGesture\?\.mode === 'pending'[\s\S]*?cleanupMobileCardGesture\(true\)/u);
	assert.match(viewSource, /kanbanMobileLayoutCleanup = \(\) => \{[\s\S]*?cleanupMobileCardGesture\(true\)[\s\S]*?mobileClickSuppressionCleanup\?\.\(\)/u);
});

test('mobile click suppression consumes only the originating card click', () => {
	assert.match(viewSource, /const sourceTaskId = gesture\.cardEl\.dataset\.operonTaskId[\s\S]*?clickedTaskId[\s\S]*?shouldSuppressKanbanGestureClick\(sourceTaskId, clickedTaskId\)[\s\S]*?stopImmediatePropagation\(\)[\s\S]*?cleanup\(\)/u);
});

test('keyboard card movement uses the shared drop coordinator and announces settlement', () => {
	assert.match(viewSource, /card\.tabIndex = 0;[\s\S]*?aria-grabbed/u);
	assert.match(viewSource, /wasDraggable: card\.draggable[\s\S]*?card\.draggable = false/u);
	assert.match(viewSource, /role: 'status'[\s\S]*?'aria-live': 'polite'/u);
	assert.match(viewSource, /event\.key === ' ' \|\| event\.key === 'Enter'[\s\S]*?dropKeyboardMove\(\)[\s\S]*?startKeyboardMove\(card\)/u);
	assert.match(viewSource, /event\.key === 'Escape'[\s\S]*?cancelKeyboardMove\(\)/u);
	assert.match(viewSource, /addEventListener\('focusout'[\s\S]*?boardEl\.contains\(nextTarget\)[\s\S]*?cancelKeyboardMove\(\)/u);
	assert.match(viewSource, /event\.key === 'ArrowLeft' \|\| event\.key === 'ArrowRight'[\s\S]*?setKeyboardTarget\(nextCell, true\)/u);
	assert.match(viewSource, /moveKanbanKeyboardInsertionIndex[\s\S]*?event\.key === 'ArrowUp' \? -1 : 1/u);
	assert.match(viewSource, /dropKeyboardMove[\s\S]*?this\.completeKanbanCardDrop\([\s\S]*?outcome => announce[\s\S]*?outcome === 'cancelled'[\s\S]*?buttons[\s\S]*?cancel/u);
	assert.match(viewSource, /then\(result => notifySettlement\(classifyKanbanDropCallbackSettlement\(result\)\)\)/u);
});

test('status clicks share card ownership and operation-scoped cleanup with drops', () => {
	assert.match(viewSource, /cardOperations\.begin\([\s\S]*?task\.operonId,[\s\S]*?preset\.id,[\s\S]*?'status',[\s\S]*?buildKanbanDropBoardSignature\(preset, pipeline\)/u);
	assert.match(viewSource, /\.\.\.optimisticMove,[\s\S]*?operationId: operation\.id,[\s\S]*?presetId: preset\.id/u);
	assert.match(viewSource, /clearOptimisticMove\(task\.operonId, operation\.id\)/u);
	assert.match(viewSource, /cardOperations\.isUiCurrent\([\s\S]*?operation,[\s\S]*?currentPreset\.id,[\s\S]*?resolveKanbanDropBoardSignature\(currentPreset\)/u);
});

test('drag context seals the exact raw status for unconfigured source cells', () => {
	assert.match(viewSource, /card\.dataset\.kanbanStatusValue = task\.fieldValues\['status'\] \?\? '';/u);
	assert.equal((viewSource.match(/sourceStatusValue: [^\n]+dataset\.kanbanStatusValue \?\? ''/gu) ?? []).length, 3);
	assert.equal((viewSource.match(/sourceStatusValue: [^\n]+\.sourceStatusValue/gu) ?? []).length, 3);
	assert.match(mainSource, /actualStatusValue: task\.fieldValues\['status'\] \?\? ''[\s\S]*?sourceStatusValue: context\.sourceStatusValue/u);
});

test('same-ID preset and pipeline changes are fenced by a captured board signature', () => {
	assert.match(viewSource, /kanbanDropBoardSignature = buildKanbanDropBoardSignature\(board\.preset, board\.pipeline\)/u);
	assert.equal((viewSource.match(/boardSignature: dragged\.boardSignature/gu) ?? []).length, 2);
	assert.match(viewSource, /move\.boardSignature !== boardSignature/u);
	assert.match(viewSource, /boardSignature: operation\.boardSignature/u);
	assert.match(mainSource, /context\.boardSignature !== buildKanbanDropBoardSignature\(preset, pipeline\)[\s\S]*?code: 'stale-context'/u);
});

test('card image remains non-draggable and does not introduce a special click action', () => {
	assert.match(viewSource, /image\.draggable = false;/u);
	const imageSectionStart = viewSource.indexOf('private renderKanbanCardImage');
	const imageSectionEnd = viewSource.indexOf('\n\tprivate ', imageSectionStart + 1);
	const imageSection = viewSource.slice(imageSectionStart, imageSectionEnd);
	assert.doesNotMatch(imageSection, /addEventListener\('click'/u);
});

test('swimlane title rendering remains on the existing formatter and renderer', () => {
	assert.match(viewSource, /formatKanbanSwimlaneDisplayLabel\(lane\.label\)/u);
	assert.match(viewSource, /renderKanbanSwimlaneTitle\(laneTitle, laneDisplayLabel\)/u);
});
