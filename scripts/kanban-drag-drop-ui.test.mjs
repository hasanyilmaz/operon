import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const viewSource = await readFile(path.join(rootDir, 'src/ui/kanban/kanban-view.ts'), 'utf8');
const mainSource = await readFile(path.join(rootDir, 'main.ts'), 'utf8');

test('desktop native and mobile pointer drops share one completion method', () => {
	const completionCalls = viewSource.match(/this\.completeKanbanCardDrop\(/gu) ?? [];
	assert.equal(completionCalls.length, 2);
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
	assert.match(viewSource, /Kanban card drop failed[\s\S]*?settleKanbanDropDomInPlace[\s\S]*?resolveKanbanDropNoticeKey\(error\)/u);
	const pluginWrite = mainSource.indexOf('const outcome = await this.updatePluginUiTaskStatusAndRefresh');
	const manualOrder = mainSource.indexOf('await persistManualOrderIfCurrent()', pluginWrite);
	assert.ok(pluginWrite >= 0);
	assert.ok(manualOrder > pluginWrite);
	assert.match(mainSource, /catch \(error\) \{\s*console\.warn\('Operon: Kanban card moved but manual order could not be saved'[\s\S]*?kanbanManualOrderSaveFailed/u);
	assert.doesNotMatch(mainSource, /rollbackManualOrderIfCurrent|manual-order rollback could not be persisted/u);
});

test('drop failure diagnostics preserve sorting and Plugin-native fence evidence', () => {
	assert.match(viewSource, /buildKanbanDropFailureDiagnostic\(\{[\s\S]*?taskId: context\.taskId[\s\S]*?sourceSortMode[\s\S]*?targetSortMode[\s\S]*?error/u);
	assert.match(mainSource, /attachKanbanDropFailureCause\([\s\S]*?phase: 'preflight'[\s\S]*?stage: 'prepare'[\s\S]*?code: 'stale-context'/u);
	assert.match(mainSource, /phase: 'target-postflight'[\s\S]*?stage: 'postflight'[\s\S]*?code: postflightSettlement === 'source'[\s\S]*?'move-not-applied'[\s\S]*?'move-outcome-unknown'/u);
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

test('Kanban UI writes full status and swimlane payloads without Runtime admission', () => {
	assert.match(mainSource, /const plan = buildKanbanWritebackPlan\([\s\S]*?updatePluginUiTaskStatusAndRefresh\(task\.operonId, plan\.payload/u);
	assert.doesNotMatch(mainSource, /attemptUiSemanticTransition|runKanbanDropTransition|buildUiSemanticTransitionChanges/u);
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

test('Plugin-native writes use one attempt and recurrence replacement remains a successful settlement', () => {
	const handlerStart = mainSource.indexOf('private async handleKanbanCardDrop(');
	const handlerEnd = mainSource.indexOf('\n\tprivate isKanbanTaskAtDropTarget(', handlerStart);
	const handler = mainSource.slice(handlerStart, handlerEnd);
	assert.equal((handler.match(/updatePluginUiTaskStatusAndRefresh\(/gu) ?? []).length, 1);
	assert.doesNotMatch(handler, /retry|mutationMayHaveApplied|reindexCommittedMutationSources/u);
	assert.match(handler, /outcome === 'outcome-unknown'[\s\S]*?'move-outcome-unknown'/u);
	assert.match(handler, /postflightSettlement !== 'target' && postflightSettlement !== 'recurrence-replacement'/u);
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

test('a stale board source is rejected before manual-order or Plugin-native writes', () => {
	const sourceFence = mainSource.indexOf('if (!matchesKanbanDropSource({');
	const manualOrderBuild = mainSource.indexOf('const sourceIsManual', sourceFence);
	const manualOrderApply = mainSource.indexOf('await persistManualOrderIfCurrent()', sourceFence);
	const pluginWrite = mainSource.indexOf('updatePluginUiTaskStatusAndRefresh', sourceFence);
	assert.ok(sourceFence >= 0);
	assert.ok(manualOrderBuild > sourceFence);
	assert.ok(manualOrderApply > sourceFence);
	assert.ok(pluginWrite > sourceFence);
	assert.match(mainSource.slice(sourceFence, manualOrderBuild), /phase: 'preflight'[\s\S]*?code: 'stale-source'/u);
});

test('pending card drops are operation-owned and mobile commits use the final pointer cell', () => {
	assert.match(viewSource, /cardOperations\.begin\([\s\S]*?context\.taskId,[\s\S]*?preset\.id,[\s\S]*?'drop',[\s\S]*?context\.boardSignature/u);
	assert.match(viewSource, /operationId: operation\.id[\s\S]*?presetId: preset\.id/u);
	assert.match(viewSource, /operationId: operation\.id[\s\S]*?boardSignature: operation\.boardSignature/u);
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

test('Kanban cards remain pointer-drag surfaces without a keyboard move mode', () => {
	assert.doesNotMatch(viewSource, /bindBoardKeyboardCardMoves|startKeyboardMove|dropKeyboardMove|cancelKeyboardMove/u);
	assert.doesNotMatch(viewSource, /card\.tabIndex\s*=|aria-grabbed|moveKanbanKeyboardInsertionIndex/u);
	assert.match(viewSource, /card\.draggable = !dropPending;[\s\S]*?is-draggable/u);
	assert.match(viewSource, /dragstart[\s\S]*?this\.draggedCardContext = \{[\s\S]*?this\.beginKanbanDragInteraction\(\)/u);
});

test('success, cancellation, and failure settle in place before feedback without rebuilding the board', () => {
	assert.doesNotMatch(mainSource, /callUnknownMethod\(leaf\.view, 'clearOptimisticMove', context\.taskId, context\.operationId\)/u);
	assert.match(viewSource, /then\(result => \{[\s\S]*?settledInPlace = this\.settleKanbanDropDomInPlace\([\s\S]*?this\.settleDropViewportAnchor\(dropViewportAnchor, outcome\);\s*notifySettlement\(outcome\);/u);
	assert.match(viewSource, /catch\(error => \{[\s\S]*?settledInPlace = this\.settleKanbanDropDomInPlace\([\s\S]*?new Notice\(t\('notifications', resolveKanbanDropNoticeKey\(error\)\)\)/u);
	assert.match(viewSource, /if \(ended && this\.containerEl\.isConnected && !settledInPlace\) this\.markDirty\(\);/u);
	const completionStart = viewSource.indexOf('private completeKanbanCardDrop(');
	const completionEnd = viewSource.indexOf('\n\tprivate deleteOptimisticMove(', completionStart);
	const completionBody = viewSource.slice(completionStart, completionEnd);
	assert.doesNotMatch(completionBody, /this\.render\(\)/u);
	assert.match(completionBody, /if \(ended\) this\.clearDropPendingCardState\(context\.taskId\);/u);
});

test('in-place settlement preserves board roots and limits writes to affected cells and rows', () => {
	const patchStart = viewSource.indexOf('private applyKanbanBoardPatchInPlace(');
	const patchEnd = viewSource.indexOf('\n\tprivate buildKanbanBoardTaskSignatures(', patchStart);
	const patchBody = viewSource.slice(patchStart, patchEnd);
	assert.match(patchBody, /collectKanbanInPlaceChangedCellKeys\([\s\S]*?forcedCellKeys/u);
	assert.match(patchBody, /this\.pendingCellMaterializers\.set\(cell, materialize\)/u);
	assert.match(patchBody, /this\.clearCellQuickAdd\(cell\)/u);
	assert.match(viewSource, /private unobserveKanbanCellContent[\s\S]*?this\.clearCellLazySentinelObserver\(cell\)/u);
	assert.match(patchBody, /cell\.empty\(\)/u);
	assert.match(patchBody, /row\.remove\(\)/u);
	assert.doesNotMatch(patchBody, /boardEl\.empty\(\)|gridViewport\.empty\(\)|this\.contentEl\.empty\(\)/u);
	const immediateStart = viewSource.indexOf('private applyImmediateCardDrop(');
	const immediateEnd = viewSource.indexOf('\n\tprivate registerOptimisticMove(', immediateStart);
	const immediateBody = viewSource.slice(immediateStart, immediateEnd);
	assert.match(immediateBody, /const affectedRows = Array\.from\(new Set\(\[sourceRow, targetRow\]\)\)/u);
	assert.match(immediateBody, /this\.syncRowCellHeights\(affectedRows\)/u);
	assert.doesNotMatch(immediateBody, /querySelectorAll<HTMLElement>\('\.operon-kanban-row'\)/u);
});

test('successful late callbacks are fenced before touching a replaced board scope', () => {
	assert.match(
		viewSource,
		/then\(result => \{[\s\S]*?const currentPreset = this\.resolveCurrentPreset\(\);[\s\S]*?this\.cardOperations\.isUiCurrent\([\s\S]*?settledInPlace = this\.settleKanbanDropDomInPlace/u,
	);
});

test('status clicks share card ownership and operation-scoped cleanup with drops', () => {
	assert.match(viewSource, /cardOperations\.begin\([\s\S]*?task\.operonId,[\s\S]*?preset\.id,[\s\S]*?'status',[\s\S]*?buildKanbanDropBoardSignature\(preset, pipeline\)/u);
	assert.match(viewSource, /\.\.\.optimisticMove,[\s\S]*?operationId: operation\.id,[\s\S]*?presetId: preset\.id/u);
	assert.match(viewSource, /clearOptimisticMove\(task\.operonId, operation\.id\)/u);
	assert.match(viewSource, /cardOperations\.isUiCurrent\([\s\S]*?operation,[\s\S]*?currentPreset\.id,[\s\S]*?resolveKanbanDropBoardSignature\(currentPreset\)/u);
});

test('drag context seals the exact raw status for unconfigured source cells', () => {
	assert.match(viewSource, /card\.dataset\.kanbanStatusValue = task\.fieldValues\['status'\] \?\? '';/u);
	assert.equal((viewSource.match(/sourceStatusValue: [^\n]+dataset\.kanbanStatusValue \?\? ''/gu) ?? []).length, 2);
	assert.equal((viewSource.match(/sourceStatusValue: [^\n]+\.sourceStatusValue/gu) ?? []).length, 2);
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
