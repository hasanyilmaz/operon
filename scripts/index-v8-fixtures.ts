import type { IndexedTask, IndexedTaskInstance, IndexData } from '../src/types/fields';
import type { IndexV8SourceInput } from '../src/indexer/persistence/index-v8-codec';
import { deriveIndexV8InstanceKey } from '../src/indexer/persistence/index-v8-codec';

const SYNTHETIC_TIMESTAMP = '2026-01-02T03:04:05.000Z';

export function createSyntheticIndexData(taskInstanceCount: number): IndexData {
	const tasks: Record<string, IndexedTask> = {};
	const taskInstances: Record<string, IndexedTaskInstance> = {};
	for (let index = 0; index < taskInstanceCount; index++) {
		const sourceIndex = Math.floor(index / 10);
		const filePath = `Synthetic/Source-${sourceIndex.toString(36)}.md`;
		const lineNumber = index % 10;
		const operonId = `synthetic-${String(index).padStart(7, '0')}`;
		const instanceKey = deriveIndexV8InstanceKey(filePath, lineNumber, 'inline');
		const fieldValues: Record<string, string> = {
			status: index % 4 === 0 ? 'Synthetic.InProgress' : 'Synthetic.Planned',
			priority: ['A', 'B', 'C', 'D'][index % 4],
			datetimeCreated: SYNTHETIC_TIMESTAMP,
			datetimeModified: SYNTHETIC_TIMESTAMP,
			dateDue: `2026-02-${String((index % 28) + 1).padStart(2, '0')}`,
		};
		if (index > 0 && index % 8 === 0) fieldValues.parentTask = `synthetic-${String(index - 1).padStart(7, '0')}`;
		const instance: IndexedTaskInstance = {
			instanceKey,
			operonId,
			description: `Synthetic task ${index}`,
			checkbox: index % 7 === 0 ? 'done' : 'open',
			fieldValues,
			tags: index % 3 === 0 ? ['synthetic', 'benchmark'] : ['synthetic'],
			primary: { filePath, lineNumber, format: 'inline' },
			datetimeModified: SYNTHETIC_TIMESTAMP,
			tier: index % 7 === 0 ? 'warm' : 'hot',
		};
		taskInstances[instanceKey] = instance;
		const task: IndexedTask = { ...instance };
		delete (task as { instanceKey?: string }).instanceKey;
		tasks[operonId] = task;
	}
	return {
		workflowStatusSemanticsSignature: 'synthetic-semantics-v1',
		lastFullReindex: SYNTHETIC_TIMESTAMP,
		tasks,
		taskInstances,
	};
}

export function createV8SourcesFromIndexData(data: IndexData): IndexV8SourceInput[] {
	const grouped = new Map<string, IndexedTaskInstance[]>();
	for (const instance of Object.values(data.taskInstances ?? {})) {
		const instances = grouped.get(instance.primary.filePath) ?? [];
		instances.push(instance);
		grouped.set(instance.primary.filePath, instances);
	}
	return Array.from(grouped, ([path, instances]) => ({
		path,
		mtimeMs: 1_767_326_645_000,
		sizeBytes: Math.max(1, instances.length * 256),
		instances,
	}));
}
