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

test('drop failure keeps one optimistic rollback and one user notice path', () => {
	assert.match(viewSource, /Kanban card drop failed[\s\S]*?kanbanActionFailed[\s\S]*?optimisticMoves\.delete\(context\.taskId\)[\s\S]*?this\.markDirty\(\)/u);
	assert.match(mainSource, /const rollbackManualOrderIfCurrent[\s\S]*?replaceCellsIfCurrent\([\s\S]*?manualOrderCells[\s\S]*?previousManualOrderCells/u);
	assert.match(mainSource, /catch \(error\) \{\s*await rollbackManualOrderIfCurrent\(error\);\s*throw error;/u);
	assert.match(mainSource, /manual-order rollback could not be persisted[\s\S]*?rollbackCause[\s\S]*?combinedError/u);
});

test('drop failure diagnostics preserve sorting and Runtime transition evidence', () => {
	assert.match(viewSource, /buildKanbanDropFailureDiagnostic\(\{[\s\S]*?taskId: context\.taskId[\s\S]*?sourceSortMode[\s\S]*?targetSortMode[\s\S]*?error/u);
	assert.match(mainSource, /attachKanbanDropFailureCause\([\s\S]*?phase: 'transition'[\s\S]*?attemptCount: transitionAttemptCount[\s\S]*?mutationMayHaveApplied/u);
	assert.match(mainSource, /phase: 'target-postflight'[\s\S]*?code: 'target-cell-not-visible'[\s\S]*?mutationMayHaveApplied: true[\s\S]*?mutationStatus: null/u);
	assert.doesNotMatch(mainSource, /rollbackError:\s*rollbackError as unknown/u);
});

test('Runtime mutation settlement forces fresh committed-source visibility', () => {
	assert.match(
		mainSource,
		/reindexAffectedSources: async filePaths => \{\s*await this\.indexer\.reindexCommittedMutationSources\(filePaths, \{ notify: false \}\);\s*\}/u,
	);
});

test('forward manual-order write uses the same expected-state CAS fence', () => {
	assert.match(mainSource, /const applyManualOrderIfCurrent[\s\S]*?replaceCellsIfCurrent\([\s\S]*?previousManualOrderCells[\s\S]*?manualOrderCells/u);
	assert.match(mainSource, /manual order changed before apply/u);
});

test('manual drag behavior resolves source and target column sorting independently', () => {
	assert.match(viewSource, /resolveKanbanEffectiveSorting\(preset, column\.statusId\)\.sortMode === 'manual'/u);
	assert.match(viewSource, /resolveKanbanEffectiveSorting\(preset, targetStatusId\)\.sortMode === 'manual'/u);
	assert.match(mainSource, /const sourceIsManual = context\.sourceStatusId[\s\S]*?resolveKanbanEffectiveSorting\(preset, context\.sourceStatusId\)/u);
	assert.match(mainSource, /const targetIsManual = resolveKanbanEffectiveSorting\(preset, context\.targetStatusId\)/u);
	assert.match(mainSource, /buildKanbanManualDropOrderCells\(preset, context, sourceIsManual, targetIsManual\)/u);
});

test('fresh retry refuses a task that left its original status or swimlane', () => {
	assert.match(mainSource, /attemptIndex > 0[\s\S]*?attemptStatusIdentity\.status\.id !== currentStatusIdentity\.status\.id/u);
	assert.match(mainSource, /attemptIndex > 0[\s\S]*?!attemptLaneKeys\.includes\(context\.sourceLaneKey\)/u);
	assert.match(mainSource, /The Kanban source cell changed before retry/u);
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
