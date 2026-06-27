import { App } from 'obsidian';
import { FilterSet, normalizeFilterSet } from '../types/settings';
import {
	DYNAMIC_FILE_TASK_FILTER_ID,
	DYNAMIC_SUBTASKS_FILTER_ID,
	createDynamicSubtasksFilterSetFromDynamicFileTaskFilter,
	isSpecialDynamicFilterSetId,
	normalizeDynamicFileTaskFilterSet,
	normalizeSpecialDynamicFilterSet,
	seedDynamicFileTaskFilterDefaultSorts,
	seedDynamicSubtasksFilterDefaultSorts,
} from '../core/dynamic-file-task-filter';
import { WriteQueue } from './write-queue';
import { isRecord } from '../core/unknown-value';
import { writeJsonSafely } from './storage-file-ops';
import type { OperonFiltersPackageV1 } from './operon-data-package';

const FILTERS_FOLDER = '.operon/filters';
const FILTER_INDEX_FILE = `${FILTERS_FOLDER}/index.json`;
const FILTER_STORE_VERSION = 1;
const FILTER_STORE_QUEUE_KEY = `${FILTERS_FOLDER}/__store__`;

interface FilterStoreIndexData {
	version: number;
	filterIds: string[];
}

function cloneFilterSet(filterSet: FilterSet): FilterSet {
	return JSON.parse(JSON.stringify(filterSet)) as FilterSet;
}

function normalizeIndex(raw: unknown): string[] {
	if (!isRecord(raw)) return [];
	const src = raw;
	if (!Array.isArray(src.filterIds)) return [];
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const value of src.filterIds) {
		const trimmed = typeof value === 'string' ? value.trim() : '';
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		ids.push(trimmed);
	}
	return ids;
}

function getFilterFilePath(filterId: string): string {
	return `${FILTERS_FOLDER}/${filterId}.json`;
}

export class FilterStore {
	private app: App;
	private writeQueue: WriteQueue;
	private orderedIds: string[] = [];
	private filters = new Map<string, FilterSet>();
	private packagePersist: ((filters: OperonFiltersPackageV1) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue) {
		this.app = app;
		this.writeQueue = writeQueue;
	}

	getAll(): FilterSet[] {
		return this.orderedIds
			.map(filterId => this.filters.get(filterId))
			.filter((filterSet): filterSet is FilterSet => !!filterSet)
			.map(cloneFilterSet);
	}

	getById(filterId: string): FilterSet | null {
		const filterSet = this.filters.get(filterId);
		return filterSet ? cloneFilterSet(filterSet) : null;
	}

	setPackagePersistence(persist: (filters: OperonFiltersPackageV1) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(filters: OperonFiltersPackageV1, options: { seedDynamicDefaultSorts?: boolean } = {}): void {
		const packageItems = isRecord(filters.itemsById) ? filters.itemsById : {};
		const loadedFilters = new Map<string, FilterSet>();
		const orderedIds: string[] = [];
		const packageIds = Array.isArray(filters.filterIds) ? filters.filterIds : [];
		for (const value of packageIds) {
			const filterId = typeof value === 'string' ? value.trim() : '';
			if (!filterId || loadedFilters.has(filterId)) continue;
			const normalized = normalizeFilterSet(packageItems[filterId]);
			if (!normalized) continue;
			loadedFilters.set(normalized.id, normalized);
			orderedIds.push(normalized.id);
		}
		for (const rawFilterSet of Object.values(packageItems)) {
			const normalized = normalizeFilterSet(rawFilterSet);
			if (!normalized || loadedFilters.has(normalized.id)) continue;
			loadedFilters.set(normalized.id, normalized);
			orderedIds.push(normalized.id);
		}
		this.filters = loadedFilters;
		this.orderedIds = orderedIds;
		this.ensureSpecialDynamicFilters(options);
	}

	toPackage(): OperonFiltersPackageV1 {
		const itemsById: Record<string, FilterSet> = {};
		for (const filterId of this.orderedIds) {
			const filterSet = this.filters.get(filterId);
			if (!filterSet) continue;
			itemsById[filterId] = cloneFilterSet(filterSet);
		}
		return {
			version: FILTER_STORE_VERSION,
			filterIds: [...this.orderedIds],
			itemsById,
		};
	}

	async load(legacyFilterSets: FilterSet[] = []): Promise<void> {
		await this.ensureFolder();
		const adapter = this.app.vault.adapter;
		const hasIndex = await adapter.exists(FILTER_INDEX_FILE);

		if (!hasIndex && legacyFilterSets.length > 0) {
			await this.replaceAll(legacyFilterSets);
			return;
		}

		const indexedIds = await this.readIndexedIds();
		const loadedFilters = new Map<string, FilterSet>();
		const orderedIds: string[] = [];

		for (const filterId of indexedIds) {
			const filterSet = await this.readFilterFile(filterId);
			if (!filterSet) {
				continue;
			}
			loadedFilters.set(filterId, filterSet);
			orderedIds.push(filterId);
		}

		const orphanFilters = await this.readOrphanFilterFiles(new Set(orderedIds));
		for (const filterSet of orphanFilters) {
			loadedFilters.set(filterSet.id, filterSet);
			orderedIds.push(filterSet.id);
		}

		this.filters = loadedFilters;
		this.orderedIds = orderedIds;
		this.ensureSpecialDynamicFilters();
	}

	async upsert(filterSet: FilterSet): Promise<void> {
		const normalized = normalizeFilterSet(filterSet);
		if (!normalized) throw new Error(`Operon: invalid filter set ${filterSet.id ?? '<missing>'}`);
		const persisted = isSpecialDynamicFilterSetId(normalized.id)
			? normalizeSpecialDynamicFilterSet(normalized)
			: normalized;
		this.filters.set(persisted.id, persisted);
		if (!this.orderedIds.includes(persisted.id)) {
			this.orderedIds.push(persisted.id);
		}
		this.ensureSpecialDynamicFilters();
		await this.persistStore();
	}

	async delete(filterId: string): Promise<void> {
		if (isSpecialDynamicFilterSetId(filterId)) {
			this.ensureSpecialDynamicFilters();
			await this.persistStore();
			return;
		}
		this.filters.delete(filterId);
		this.orderedIds = this.orderedIds.filter(id => id !== filterId);
		this.ensureSpecialDynamicFilters();
		await this.persistStore([filterId]);
	}

	async replaceOrder(filterIds: string[]): Promise<void> {
		const seen = new Set<string>();
		const nextOrder: string[] = [];
		for (const filterId of filterIds) {
			if (!this.filters.has(filterId) || seen.has(filterId)) continue;
			seen.add(filterId);
			nextOrder.push(filterId);
		}
		for (const filterId of this.orderedIds) {
			if (seen.has(filterId)) continue;
			seen.add(filterId);
			nextOrder.push(filterId);
		}
		this.orderedIds = nextOrder;
		this.ensureSpecialDynamicFilters();
		await this.persistStore();
	}

	async replaceAll(filterSets: FilterSet[]): Promise<void> {
		const nextFilters = new Map<string, FilterSet>();
		const nextOrder: string[] = [];
		for (const rawFilterSet of filterSets) {
			const filterSet = normalizeFilterSet(rawFilterSet);
			if (!filterSet || nextFilters.has(filterSet.id)) continue;
			nextFilters.set(filterSet.id, filterSet);
			nextOrder.push(filterSet.id);
		}
		this.filters = nextFilters;
		this.orderedIds = nextOrder;
		this.ensureSpecialDynamicFilters();
		await this.persistStore();
	}

	private ensureSpecialDynamicFilters(options: { seedDynamicDefaultSorts?: boolean } = {}): void {
		const existing = this.filters.get(DYNAMIC_FILE_TASK_FILTER_ID) ?? null;
		const normalized = normalizeDynamicFileTaskFilterSet(existing);
		const repairedFileFilter = options.seedDynamicDefaultSorts && normalized.sorts.length === 0
			? normalizeDynamicFileTaskFilterSet(seedDynamicFileTaskFilterDefaultSorts(normalized))
			: normalized;

		const existingSubtasks = this.filters.get(DYNAMIC_SUBTASKS_FILTER_ID) ?? null;
		const normalizedSubtasks = existingSubtasks
			? normalizeSpecialDynamicFilterSet(existingSubtasks)
			: createDynamicSubtasksFilterSetFromDynamicFileTaskFilter(repairedFileFilter);
		const repairedSubtasksFilter = options.seedDynamicDefaultSorts && normalizedSubtasks.sorts.length === 0
			? normalizeSpecialDynamicFilterSet(seedDynamicSubtasksFilterDefaultSorts(normalizedSubtasks))
			: normalizedSubtasks;

		this.filters.set(DYNAMIC_FILE_TASK_FILTER_ID, repairedFileFilter);
		this.filters.set(DYNAMIC_SUBTASKS_FILTER_ID, repairedSubtasksFilter);
		this.orderedIds = this.orderedIds.filter((id, index, ids) =>
			!isSpecialDynamicFilterSetId(id) && ids.indexOf(id) === index
		);
		this.orderedIds.push(DYNAMIC_FILE_TASK_FILTER_ID);
		this.orderedIds.push(DYNAMIC_SUBTASKS_FILTER_ID);
	}

	private async ensureFolder(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(FILTERS_FOLDER))) {
			await adapter.mkdir(FILTERS_FOLDER);
		}
	}

	private async readIndexedIds(): Promise<string[]> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(FILTER_INDEX_FILE))) return [];
		try {
			const raw = await adapter.read(FILTER_INDEX_FILE);
			return normalizeIndex(JSON.parse(raw));
		} catch {
			console.warn('Operon: Failed to parse filter index, rebuilding from files when possible');
			return [];
		}
	}

	private async readFilterFile(filterId: string): Promise<FilterSet | null> {
		const adapter = this.app.vault.adapter;
		const filePath = getFilterFilePath(filterId);
		if (!(await adapter.exists(filePath))) return null;
		try {
			const raw = await adapter.read(filePath);
			const parsed: unknown = JSON.parse(raw);
			const normalized = normalizeFilterSet(parsed);
			if (!normalized) {
				console.warn(`Operon: Invalid filter file skipped (${filePath})`);
				return null;
			}
			return normalized;
		} catch {
			console.warn(`Operon: Failed to parse filter file (${filePath})`);
			return null;
		}
	}

	private async readOrphanFilterFiles(indexedIds: Set<string>): Promise<FilterSet[]> {
		const adapter = this.app.vault.adapter;
		const list = await adapter.list(FILTERS_FOLDER);
		const filterIds = list.files
			.map(path => path.split('/').pop() ?? '')
			.filter(name => name.endsWith('.json') && name !== 'index.json')
			.map(name => name.replace(/\.json$/u, ''))
			.filter(filterId => filterId && !indexedIds.has(filterId))
			.sort((left, right) => left.localeCompare(right));

		const orphanFilters: FilterSet[] = [];
		for (const filterId of filterIds) {
			const filterSet = await this.readFilterFile(filterId);
			if (filterSet) orphanFilters.push(filterSet);
		}
		return orphanFilters;
	}

	private async persistStore(deletedIds: string[] = []): Promise<void> {
		if (this.packagePersist) {
			await this.packagePersist(this.toPackage());
			return;
		}
		const adapter = this.app.vault.adapter;
		const filterSets = this.getAll();
		const deleted = [...new Set(deletedIds)].filter(Boolean);

		await this.writeQueue.enqueue(FILTER_STORE_QUEUE_KEY, async () => {
			await this.ensureFolder();

			for (const filterSet of filterSets) {
				const filePath = getFilterFilePath(filterSet.id);
				await writeJsonSafely(adapter, filePath, filterSet);
			}

			for (const filterId of deleted) {
				const filePath = getFilterFilePath(filterId);
				if (await adapter.exists(filePath)) {
					await adapter.remove(filePath);
				}
			}

			const indexData: FilterStoreIndexData = {
				version: FILTER_STORE_VERSION,
				filterIds: [...this.orderedIds],
			};
			await writeJsonSafely(adapter, FILTER_INDEX_FILE, indexData);
		});
	}
}
