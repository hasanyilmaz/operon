import { App } from 'obsidian';
import { WriteQueue } from './write-queue';
import { preserveInvalidJsonFile, writeJsonSafely } from './storage-file-ops';
import type { OperonKanbanOrderPackageV1 } from './operon-data-package';
import { buildOperonPluginStoragePath } from './operon-storage-paths';

const KANBAN_ORDER_FILE_NAME = 'kanban-order.json';
const KANBAN_ORDER_STORE_VERSION = 1;

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
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(app: App, writeQueue: WriteQueue) {
		this.app = app;
		this.writeQueue = writeQueue;
	}

	private getFilePath(): string {
		return buildOperonPluginStoragePath(this.app.vault.configDir, 'data', KANBAN_ORDER_FILE_NAME);
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
		const filePath = this.getFilePath();
		if (!(await adapter.exists(filePath))) {
			this.boards = {};
			return;
		}

		let raw = '';
		try {
			raw = await adapter.read(filePath);
			const parsed = JSON.parse(raw) as Partial<KanbanOrderStoreData>;
			this.boards = normalizeBoards(parsed.boards);
		} catch {
			console.warn('Operon: Failed to parse kanban order store, preserving invalid file and starting with empty manual order');
			await preserveInvalidJsonFile(adapter, filePath, raw);
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
		await this.enqueueMutation(async () => {
			await this.replaceBoardAndPersist(presetId, board);
		});
	}

	async replaceCells(presetId: string, cells: KanbanManualOrderBoard): Promise<void> {
		await this.enqueueMutation(async () => {
			await this.replaceCellsAndPersist(presetId, cells);
		});
	}

	async replaceCellsIfCurrent(
		presetId: string,
		expectedCells: KanbanManualOrderBoard,
		cells: KanbanManualOrderBoard,
	): Promise<boolean> {
		return await this.enqueueMutation(async () => {
			const current = this.boards[presetId] ?? {};
			if (!boardCellsMatch(current, expectedCells)) return false;
			await this.replaceCellsAndPersist(presetId, cells);
			return true;
		});
	}

	async removeBoard(presetId: string): Promise<void> {
		await this.enqueueMutation(async () => {
			if (!Object.prototype.hasOwnProperty.call(this.boards, presetId)) return;
			await this.replaceBoardAndPersist(presetId, {});
		});
	}

	private async enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return await run;
	}

	private async replaceBoardAndPersist(
		presetId: string,
		board: KanbanManualOrderBoard,
	): Promise<void> {
		const previous = cloneBoard(this.boards[presetId] ?? {});
		const normalized = cloneBoard(board);
		this.setBoard(presetId, normalized);
		try {
			await this.persist();
		} catch (error) {
			if (boardsEqual(this.boards[presetId] ?? {}, normalized)) {
				this.setBoard(presetId, previous);
			}
			throw error;
		}
	}

	private async replaceCellsAndPersist(
		presetId: string,
		cells: KanbanManualOrderBoard,
	): Promise<void> {
		const board = cloneBoard(this.boards[presetId] ?? {});
		for (const [cellKey, taskIds] of Object.entries(cells)) {
			const normalized = normalizeTaskIds(taskIds);
			if (normalized.length > 0) board[cellKey] = normalized;
			else delete board[cellKey];
		}
		await this.replaceBoardAndPersist(presetId, board);
	}

	private setBoard(presetId: string, board: KanbanManualOrderBoard): void {
		if (Object.keys(board).length > 0) this.boards[presetId] = cloneBoard(board);
		else delete this.boards[presetId];
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
		const filePath = this.getFilePath();
		await this.writeQueue.enqueue(`${filePath}::__store__`, async () => {
			await writeJsonSafely(adapter, filePath, data);
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

function boardCellsMatch(
	board: KanbanManualOrderBoard,
	expectedCells: KanbanManualOrderBoard,
): boolean {
	return Object.entries(expectedCells).every(([cellKey, taskIds]) => (
		stringArraysEqual(board[cellKey] ?? [], normalizeTaskIds(taskIds))
	));
}

function boardsEqual(left: KanbanManualOrderBoard, right: KanbanManualOrderBoard): boolean {
	const leftKeys = Object.keys(left).sort();
	const rightKeys = Object.keys(right).sort();
	return stringArraysEqual(leftKeys, rightKeys)
		&& leftKeys.every(key => stringArraysEqual(left[key] ?? [], right[key] ?? []));
}

function stringArraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
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
