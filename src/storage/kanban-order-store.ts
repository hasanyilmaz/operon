import { App } from 'obsidian';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import type { OperonKanbanOrderPackageV1 } from './operon-data-package';

const KANBAN_ORDER_FILE = '.operon/kanban-order.json';
const KANBAN_ORDER_STORE_VERSION = 1;
const KANBAN_ORDER_STORE_QUEUE_KEY = `${KANBAN_ORDER_FILE}::__store__`;

export type KanbanManualOrderBoard = Record<string, string[]>;

interface KanbanOrderStoreData {
	version: number;
	boards: Record<string, KanbanManualOrderBoard>;
}

export class KanbanOrderStore {
	private app: App;
	private writeQueue: WriteQueue;
	private boards: Record<string, KanbanManualOrderBoard> = {};
	private packagePersist: ((kanbanOrder: OperonKanbanOrderPackageV1) => Promise<void>) | null = null;

	constructor(app: App, writeQueue: WriteQueue) {
		this.app = app;
		this.writeQueue = writeQueue;
	}

	setPackagePersistence(persist: (kanbanOrder: OperonKanbanOrderPackageV1) => Promise<void>): void {
		this.packagePersist = persist;
	}

	loadFromPackage(kanbanOrder: OperonKanbanOrderPackageV1): void {
		this.boards = normalizeBoards(kanbanOrder.boards);
	}

	toPackage(): OperonKanbanOrderPackageV1 {
		return {
			version: KANBAN_ORDER_STORE_VERSION,
			boards: cloneBoards(this.boards),
		};
	}

	async load(): Promise<void> {
		const adapter = this.app.vault.adapter;
		if (!(await adapter.exists(KANBAN_ORDER_FILE))) {
			this.boards = {};
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(KANBAN_ORDER_FILE);
			const parsed = JSON.parse(raw) as Partial<KanbanOrderStoreData>;
			this.boards = normalizeBoards(parsed.boards);
		} catch {
			console.warn('Operon: Failed to parse kanban order store, preserving invalid file and starting with empty manual order');
			await preserveInvalidJsonFile(adapter, KANBAN_ORDER_FILE, raw);
			this.boards = {};
		}
	}

	getBoard(presetId: string): KanbanManualOrderBoard {
		return cloneBoard(this.boards[presetId] ?? {});
	}

	hasBoard(presetId: string): boolean {
		const board = this.boards[presetId];
		return !!board && Object.keys(board).length > 0;
	}

	async replaceBoard(presetId: string, board: KanbanManualOrderBoard): Promise<void> {
		const normalized = cloneBoard(board);
		if (Object.keys(normalized).length > 0) {
			this.boards[presetId] = normalized;
		} else {
			delete this.boards[presetId];
		}
		await this.persist();
	}

	async replaceCells(presetId: string, cells: KanbanManualOrderBoard): Promise<void> {
		const board = cloneBoard(this.boards[presetId] ?? {});
		for (const [cellKey, taskIds] of Object.entries(cells)) {
			const normalized = normalizeTaskIds(taskIds);
			if (normalized.length > 0) {
				board[cellKey] = normalized;
			} else {
				delete board[cellKey];
			}
		}
		if (Object.keys(board).length > 0) {
			this.boards[presetId] = board;
		} else {
			delete this.boards[presetId];
		}
		await this.persist();
	}

	async removeBoard(presetId: string): Promise<void> {
		delete this.boards[presetId];
		await this.persist();
	}

	private async persist(): Promise<void> {
		if (this.packagePersist) {
			await this.packagePersist(this.toPackage());
			return;
		}
		const adapter = this.app.vault.adapter;
		const data: KanbanOrderStoreData = {
			version: KANBAN_ORDER_STORE_VERSION,
			boards: cloneBoards(this.boards),
		};
		await this.writeQueue.enqueue(KANBAN_ORDER_STORE_QUEUE_KEY, async () => {
			await writeJsonSafely(adapter, KANBAN_ORDER_FILE, data);
		});
	}
}

function normalizeBoards(raw: unknown): Record<string, KanbanManualOrderBoard> {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return {};
	const boards: Record<string, KanbanManualOrderBoard> = {};
	const rawBoards = raw as Record<string, unknown>;
	for (const [presetId, boardRaw] of Object.entries(rawBoards)) {
		if (!presetId.trim() || !boardRaw || typeof boardRaw !== 'object' || Array.isArray(boardRaw)) continue;
		const board: KanbanManualOrderBoard = {};
		const boardRecord = boardRaw as Record<string, unknown>;
		for (const [cellKey, taskIdsRaw] of Object.entries(boardRecord)) {
			if (!cellKey.trim() || !Array.isArray(taskIdsRaw)) continue;
			const taskIds = normalizeTaskIds(taskIdsRaw);
			if (taskIds.length > 0) {
				board[cellKey] = taskIds;
			}
		}
		if (Object.keys(board).length > 0) {
			boards[presetId] = board;
		}
	}
	return boards;
}

function cloneBoards(boards: Record<string, KanbanManualOrderBoard>): Record<string, KanbanManualOrderBoard> {
	const cloned: Record<string, KanbanManualOrderBoard> = {};
	for (const [presetId, board] of Object.entries(boards)) {
		cloned[presetId] = cloneBoard(board);
	}
	return cloned;
}

function cloneBoard(board: KanbanManualOrderBoard): KanbanManualOrderBoard {
	const cloned: KanbanManualOrderBoard = {};
	for (const [cellKey, taskIds] of Object.entries(board)) {
		const normalized = normalizeTaskIds(taskIds);
		if (normalized.length > 0) {
			cloned[cellKey] = normalized;
		}
	}
	return cloned;
}

function normalizeTaskIds(raw: unknown[]): string[] {
	const seen = new Set<string>();
	const ids: string[] = [];
	for (const value of raw) {
		if (typeof value !== 'string') continue;
		const id = value.trim();
		if (!id || seen.has(id)) continue;
		seen.add(id);
		ids.push(id);
	}
	return ids;
}
