import assert from 'node:assert/strict';

import {
	buildParentTaskDateRangeExpansionPatch,
	mergeParentTaskDateRangeBounds,
	resolveTaskDateRangeBounds,
} from '../src/core/parent-task-date-range';
import { AggregateCoordinator } from '../src/systems/aggregate-coordinator';
import type { TaskWriter } from '../src/core/task-writer';
import type { OperonIndexer } from '../src/indexer/indexer';
import type { IndexedTask } from '../src/types/fields';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { buildOperonDataPackageFromSettings, composeOperonSettingsFromDataPackage } from '../src/storage/operon-data-package';
import { SETTINGS_BACKUP_GROUPS } from '../src/core/settings-backup-compatibility';

const cases: Array<{ name: string; run: () => void | Promise<void> }> = [];

function test(name: string, run: () => void | Promise<void>): void {
	cases.push({ name, run });
}

function task(
	operonId: string,
	fieldValues: Record<string, string> = {},
	checkbox: IndexedTask['checkbox'] = 'open',
): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox,
		fieldValues,
		tags: [],
		primary: { filePath: `${operonId}.md`, format: 'yaml', lineNumber: 0 },
		datetimeModified: '',
		tier: 'hot',
	};
}

test('expands a 20-25 parent to descendant bounds 19-27 without contracting later', () => {
	const parent = task('parent', { dateStarted: '2026-08-20', dateDue: '2026-08-25' });
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(parent, {
		earliestStarted: '2026-08-19',
		latestFinished: '2026-08-27',
	}, true), {
		dateStarted: '2026-08-19',
		dateDue: '2026-08-27',
	});
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(parent, {
		earliestStarted: '2026-08-21',
		latestFinished: '2026-08-24',
	}, true), {});
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(parent, {
		earliestStarted: '2026-08-19',
		latestFinished: '2026-08-27',
	}, false), {});
});

test('uses only valid start, due and completed dates and ignores a cancelled task own dates', () => {
	const scheduledOnly = task('scheduled', {
		dateScheduled: '2026-08-01',
		datetimeStart: '2026-08-02T09:00:00',
		datetimeEnd: '2026-08-02T10:00:00',
		dateCancelled: '2026-08-03',
	});
	assert.deepEqual(resolveTaskDateRangeBounds(scheduledOnly), {
		earliestStarted: '',
		latestFinished: '',
	});
	assert.deepEqual(resolveTaskDateRangeBounds(task('valid', {
		dateStarted: '2024-02-29',
		dateDue: '2026-08-25',
		dateCompleted: '2026-08-27',
	})), {
		earliestStarted: '2024-02-29',
		latestFinished: '2026-08-27',
	});
	assert.deepEqual(resolveTaskDateRangeBounds(task('invalid', {
		dateStarted: '2025-02-29',
		dateDue: '2026-13-40',
		dateCompleted: 'not-a-date',
	})), {
		earliestStarted: '',
		latestFinished: '',
	});
	assert.deepEqual(resolveTaskDateRangeBounds(task('cancelled', {
		dateStarted: '2026-01-01',
		dateDue: '2026-12-31',
	}, 'cancelled')), {
		earliestStarted: '',
		latestFinished: '',
	});
});

test('fills blank boundaries, preserves malformed parent values and refuses inverted output', () => {
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(task('blank'), {
		earliestStarted: '2026-08-19',
		latestFinished: '2026-08-27',
	}, true), {
		dateStarted: '2026-08-19',
		dateDue: '2026-08-27',
	});
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(task('malformed', {
		dateStarted: 'invalid',
		dateDue: 'also-invalid',
	}), {
		earliestStarted: '2026-08-19',
		latestFinished: '2026-08-27',
	}, true), {});
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(task('inverted', {
		dateDue: '2026-08-10',
	}), {
		earliestStarted: '2026-08-20',
		latestFinished: '',
	}, true), {});
	assert.deepEqual(buildParentTaskDateRangeExpansionPatch(task('cancelled-parent', {}, 'cancelled'), {
		earliestStarted: '2026-08-19',
		latestFinished: '2026-08-27',
	}, true), {});
});

test('bottom-up projection includes every descendant while excluding cancelled nodes own dates', () => {
	const parent = task('parent', { dateStarted: '2026-08-20', dateDue: '2026-08-25' });
	const cancelledChild = task('cancelled-child', {
		parentTask: 'parent',
		dateStarted: '2026-08-01',
		dateDue: '2026-09-30',
	}, 'cancelled');
	const grandchild = task('grandchild', {
		parentTask: 'cancelled-child',
		dateStarted: '2026-08-19',
		dateCompleted: '2026-08-27',
	});
	const tasks = [parent, cancelledChild, grandchild];
	const coordinator = new AggregateCoordinator({
		getAllTasks: () => tasks,
	} as unknown as OperonIndexer, {} as TaskWriter, () => true);
	const patches = coordinator.planCreationAggregatePatches([], '2026-08-28T10:00:00', ['parent']);
	const patch = patches.find(entry => entry.operonId === 'parent')?.fieldValues;
	assert.equal(patch?.['dateStarted'], '2026-08-19');
	assert.equal(patch?.['dateDue'], '2026-08-27');
	assert.equal(patch?.['dateCompleted'], undefined);
});

test('one-time reconciliation writes only real expansions and the second run is idempotent', async () => {
	const parent = task('parent', { dateStarted: '2026-08-20', dateDue: '2026-08-25' });
	const child = task('child', {
		parentTask: 'parent',
		dateStarted: '2026-08-19',
		dateDue: '2026-08-27',
	});
	const tasks = new Map([parent, child].map(entry => [entry.operonId, entry]));
	const childIds = new Map<string, Set<string>>([
		['parent', new Set(['child'])],
		['child', new Set()],
	]);
	const writtenPayloads: Record<string, string>[] = [];
	const indexer = {
		getAllTasks: () => [...tasks.values()],
		getTask: (operonId: string) => tasks.get(operonId),
		secondary: {
			getChildIds: (operonId: string) => childIds.get(operonId) ?? new Set<string>(),
			getAllDescendantIds: (operonId: string) => operonId === 'parent' ? new Set(['child']) : new Set<string>(),
		},
		commitAggregateFieldPatches: async () => true,
		reindexFilesBatch: async () => undefined,
	} as unknown as OperonIndexer;
	const writer = {
		writeTaskFields: async (operonId: string, payload: Record<string, string>) => {
			writtenPayloads.push({ ...payload });
			const current = tasks.get(operonId);
			if (current) current.fieldValues = { ...current.fieldValues, ...payload };
			return true;
		},
	} as unknown as TaskWriter;
	let enabled = false;
	const coordinator = new AggregateCoordinator(indexer, writer, () => enabled);
	assert.equal((await coordinator.refreshAllParents()).writeCount, 0);
	enabled = true;
	assert.equal((await coordinator.refreshAllParents()).writeCount, 1);
	assert.equal(writtenPayloads[0]?.['dateStarted'], '2026-08-19');
	assert.equal(writtenPayloads[0]?.['dateDue'], '2026-08-27');
	assert.equal(writtenPayloads[0]?.['datetimeModified']?.length > 0, true);
	assert.equal((await coordinator.refreshAllParents()).writeCount, 0);
});

test('normal child mutations expand ancestors and report partial parent write failures', async () => {
	const parentA = task('parent-a', { dateStarted: '2026-08-20', dateDue: '2026-08-25' });
	const parentB = task('parent-b', { dateStarted: '2026-08-20', dateDue: '2026-08-25' });
	const childA = task('child-a', {
		parentTask: 'parent-a',
		dateStarted: '2026-08-19',
		dateDue: '2026-08-27',
	});
	const childB = task('child-b', {
		parentTask: 'parent-b',
		dateStarted: '2026-08-18',
		dateCompleted: '2026-08-28',
	});
	const tasks = new Map([parentA, parentB, childA, childB].map(entry => [entry.operonId, entry]));
	const childIds = new Map<string, Set<string>>([
		['parent-a', new Set(['child-a'])],
		['parent-b', new Set(['child-b'])],
	]);
	const indexer = {
		getAllTasks: () => [...tasks.values()],
		getTask: (operonId: string) => tasks.get(operonId),
		secondary: {
			getChildIds: (operonId: string) => childIds.get(operonId) ?? new Set<string>(),
			getAllDescendantIds: (operonId: string) => childIds.get(operonId) ?? new Set<string>(),
		},
		commitAggregateFieldPatches: async () => true,
		reindexFilesBatch: async () => undefined,
	} as unknown as OperonIndexer;
	const writes = new Map<string, Record<string, string>>();
	const writer = {
		writeTaskFields: async (operonId: string, payload: Record<string, string>) => {
			if (operonId === 'parent-b') return false;
			writes.set(operonId, { ...payload });
			return true;
		},
	} as unknown as TaskWriter;
	const coordinator = new AggregateCoordinator(indexer, writer, () => true);
	const result = await coordinator.refreshAfterTaskMutations([
		{ before: childA, after: childA },
		{ before: childB, after: childB },
	]);
	assert.equal(result.writeCount, 1);
	assert.equal(result.failedWriteCount, 1);
	assert.equal(writes.get('parent-a')?.['dateStarted'], '2026-08-19');
	assert.equal(writes.get('parent-a')?.['dateDue'], '2026-08-27');
	assert.equal(writes.get('parent-a')?.['dateCompleted'], undefined);
});

test('settings default, package round-trip and portable general backup group own the policy', () => {
	assert.equal(DEFAULT_SETTINGS.autoExpandParentTaskDateRange, false);
	assert.equal(migrateSettings({ autoExpandParentTaskDateRange: 'yes' }).autoExpandParentTaskDateRange, false);
	assert.equal(migrateSettings({ autoExpandParentTaskDateRange: true }).autoExpandParentTaskDateRange, true);
	const settings = migrateSettings({ autoExpandParentTaskDateRange: true });
	const dataPackage = buildOperonDataPackageFromSettings(settings);
	assert.equal(dataPackage.automation.taskAutomationPolicy.autoExpandParentTaskDateRange, true);
	assert.equal(composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).autoExpandParentTaskDateRange, true);
	const general = SETTINGS_BACKUP_GROUPS.find(group => group.id === 'general');
	assert.ok(general?.settingKeys.includes('autoExpandParentTaskDateRange'));
});

test('bounds merge remains deterministic and independent of traversal order', () => {
	const left = { earliestStarted: '2026-08-20', latestFinished: '2026-08-25' };
	const right = { earliestStarted: '2026-08-19', latestFinished: '2026-08-27' };
	assert.deepEqual(mergeParentTaskDateRangeBounds(left, right), mergeParentTaskDateRangeBounds(right, left));
});

declare global {
	var __operonParentTaskDateRangeTestRun: Promise<void> | undefined;
}

async function run(): Promise<void> {
	for (const entry of cases) await entry.run();
	console.log(`Parent task date range tests passed (${cases.length} cases).`);
}

globalThis.__operonParentTaskDateRangeTestRun = run();
