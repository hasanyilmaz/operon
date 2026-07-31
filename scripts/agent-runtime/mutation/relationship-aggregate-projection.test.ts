import assert from 'node:assert/strict';
import test from 'node:test';

import type { TaskWriter } from '../../../src/core/task-writer';
import type { OperonIndexer } from '../../../src/indexer/indexer';
import { AggregateCoordinator } from '../../../src/systems/aggregate-coordinator';
import type { IndexedTask } from '../../../src/types/fields';

function task(
	operonId: string,
	fieldValues: Record<string, string>,
	filePath: string,
): IndexedTask {
	return {
		operonId,
		description: operonId,
		checkbox: 'open',
		fieldValues,
		tags: [],
		primary: { filePath, format: 'inline', lineNumber: 0 },
		datetimeModified: '',
		tier: 'hot',
	};
}

test('relationship projection recomputes both old and new ancestor chains before writes', () => {
	const child = task('child01', { parentTask: 'old0001' }, 'Child.md');
	const oldParent = task('old0001', {
		progress: '0',
		directSubtaskCount: '1',
		treeDescendantCount: '1',
	}, 'Old.md');
	const newParent = task('new0001', {}, 'New.md');
	const tasks = [child, oldParent, newParent];
	const coordinator = new AggregateCoordinator({
		getAllTasks: () => tasks,
	} as unknown as OperonIndexer, {} as TaskWriter);
	const modifiedTimestamp = '2026-07-27T12:00:00';

	const patches = coordinator.planCreationAggregatePatches([{
		operonId: child.operonId,
		checkbox: child.checkbox,
		fieldValues: { ...child.fieldValues, parentTask: newParent.operonId },
		filePath: child.primary.filePath,
		format: child.primary.format,
		lineNumber: child.primary.lineNumber,
	}], modifiedTimestamp, [oldParent.operonId]);

	const byId = new Map(patches.map(patch => [patch.operonId, patch]));
	assert.deepEqual([...byId.keys()].sort(), ['new0001', 'old0001']);
	assert.equal(byId.get('new0001')?.fieldValues['directSubtaskCount'], '1');
	assert.equal(byId.get('old0001')?.fieldValues['directSubtaskCount'], '');
	assert.equal(byId.get('old0001')?.fieldValues['datetimeModified'], modifiedTimestamp);
	assert.equal(byId.get('new0001')?.fieldValues['datetimeModified'], modifiedTimestamp);
});
