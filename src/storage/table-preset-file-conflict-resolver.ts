import { App, TFile } from 'obsidian';
import { cloneTablePreset, createTablePresetId, isSafeTablePresetId, type TablePreset } from '../types/table';
import type { OperonTableFileDescriptor } from '../types/table-file';
import type {
	TablePresetFileConflictResolutionFailure,
	TablePresetFileConflictResolutionRequest,
	TablePresetFileConflictResolutionResult,
	TablePresetFileConflictResolutionSuccess,
} from '../types/table-preset-file-conflict';
import type { OperonStorage } from './operon-storage';
import type { TablePresetRegistry } from './table-preset-registry';
import {
	buildUniqueOperonTableFilePath,
	isOperonTableFilePath,
	normalizeOperonTableFilePath,
	parseOperonTableFile,
	serializeOperonTableFile,
	getOperonTableFilePathKey,
} from './table-file';

interface ValidTableFile { file: TFile; path: string; preset: TablePreset; fingerprint: string }

export class TablePresetFileConflictResolver<TDescriptor extends OperonTableFileDescriptor = OperonTableFileDescriptor> {
	private mutationQueue: Promise<void> = Promise.resolve();

	constructor(
		private readonly app: App,
		private readonly storage: OperonStorage,
		private readonly registry: TablePresetRegistry<TDescriptor>,
		private readonly createPresetId: () => string = createTablePresetId,
	) {}

	resolveDuplicateIdConflict(request: TablePresetFileConflictResolutionRequest): Promise<TablePresetFileConflictResolutionResult> {
		return this.enqueue(async () => {
			const presetId = request.presetId.trim();
			const chosenPath = normalizeOperonTableFilePath(request.chosenOriginalPath);
			const candidates = (await this.scan()).filter(entry => entry.preset.id === presetId)
				.sort((left, right) => left.path.localeCompare(right.path));
			if (candidates.length < 2) throw new Error(`Table preset ${presetId} does not have a duplicate file conflict.`);
			const chosen = candidates.find(candidate => pathsEqual(candidate.path, chosenPath));
			if (!chosen) throw new Error(`Chosen original is not a valid ${presetId} Table file: ${chosenPath}`);
			if (hashContent(await this.app.vault.read(chosen.file)) !== chosen.fingerprint) {
				throw new Error(`Chosen original changed during conflict review: ${chosen.path}`);
			}
			await this.persistBinding(presetId, chosen.path);
			const succeeded: TablePresetFileConflictResolutionSuccess[] = [];
			const failed: TablePresetFileConflictResolutionFailure[] = [];
			for (const candidate of candidates) {
				if (pathsEqual(candidate.path, chosen.path)) continue;
				try { succeeded.push(await this.rewrite(candidate, presetId)); }
				catch (error) { failed.push({ path: candidate.path, error: describeError(error) }); }
			}
			await this.registry.refresh();
			return { presetId, chosenOriginalPath: chosen.path, succeeded, failed };
		});
	}

	private async rewrite(candidate: ValidTableFile, oldPresetId: string): Promise<TablePresetFileConflictResolutionSuccess> {
		const originalSource = await this.app.vault.read(candidate.file);
		if (hashContent(originalSource) !== candidate.fingerprint) throw new Error(`Table file changed during conflict review: ${candidate.path}`);
		const parsed = parseOperonTableFile(originalSource, candidate.path);
		if (parsed.status !== 'valid' || parsed.preset.id !== oldPresetId) throw new Error(`Table file is no longer a valid ${oldPresetId} document: ${candidate.path}`);
		const occupied = new Set((await this.scan()).map(entry => entry.preset.id));
		for (const id of this.storage.getSettings().tablePresetOrderIds) occupied.add(id);
		let id = '';
		for (let attempt = 0; attempt < 1000; attempt += 1) {
			const candidateId = this.createPresetId();
			if (isSafeTablePresetId(candidateId) && !occupied.has(candidateId)) { id = candidateId; break; }
		}
		if (!id) throw new Error('Could not generate a unique Table preset ID.');
		const preset = { ...cloneTablePreset(parsed.preset), id, name: `${parsed.preset.name} ID Conflict` };
		const destination = buildUniqueOperonTableFilePath(folderPath(candidate.path), preset.name, this.app.vault.getFiles().map(file => file.path));
		const serialized = serializeOperonTableFile(preset);
		const targetFingerprint = hashContent(serialized);
		let renamed = false;
		try {
			await this.app.fileManager.renameFile(candidate.file, destination);
			renamed = true;
			await this.app.vault.modify(candidate.file, serialized);
			const verified = parseOperonTableFile(await this.app.vault.read(candidate.file), destination);
			if (verified.status !== 'valid' || verified.preset.id !== id) throw new Error(`Conflict resolution verification failed: ${destination}`);
			await this.persistBinding(id, destination);
			return { sourcePath: candidate.path, path: destination, oldPresetId, preset, sourceFingerprint: candidate.fingerprint, targetFingerprint };
		} catch (error) {
			if (renamed) await this.rollback(candidate.file, candidate.path, originalSource, targetFingerprint);
			throw error;
		}
	}

	private async persistBinding(id: string, path: string): Promise<void> {
		const settings = this.storage.getSettings();
		const bindings = settings.tablePresetFileBindings.filter(binding => binding.id !== id);
		bindings.push({ id, path });
		const order = settings.tablePresetOrderIds.includes(id) ? [...settings.tablePresetOrderIds] : [...settings.tablePresetOrderIds, id];
		await this.storage.updateSettings({ tablePresetFileBindings: bindings, tablePresetOrderIds: order, tablePresetFileInitialized: true });
	}

	private async scan(): Promise<ValidTableFile[]> {
		const valid: ValidTableFile[] = [];
		for (const file of this.app.vault.getFiles().filter(candidate => isOperonTableFilePath(candidate.path))) {
			const source = await this.app.vault.read(file);
			const parsed = parseOperonTableFile(source, file.path);
			if (parsed.status === 'valid') valid.push({ file, path: normalizeOperonTableFilePath(file.path), preset: parsed.preset, fingerprint: hashContent(source) });
		}
		return valid;
	}

	private async rollback(file: TFile, originalPath: string, originalSource: string, targetFingerprint: string): Promise<void> {
		try {
			const current = await this.app.vault.read(file);
			if (hashContent(current) !== targetFingerprint && current !== originalSource) return;
			await this.app.vault.modify(file, originalSource);
			if (!pathsEqual(file.path, originalPath) && !this.app.vault.getAbstractFileByPath(originalPath)) await this.app.fileManager.renameFile(file, originalPath);
		} catch (error) { console.error('Operon: failed to roll back Table preset conflict rewrite', error); }
	}

	private enqueue<T>(operation: () => Promise<T>): Promise<T> {
		const run = this.mutationQueue.then(operation);
		this.mutationQueue = run.then(() => undefined, () => undefined);
		return run;
	}
}

function folderPath(path: string): string { const normalized = normalizeOperonTableFilePath(path); return normalized.slice(0, Math.max(0, normalized.lastIndexOf('/'))); }
function pathsEqual(left: string, right: string): boolean { return getOperonTableFilePathKey(left) === getOperonTableFilePathKey(right); }
function hashContent(source: string): string { let hash = 2166136261; for (let index = 0; index < source.length; index += 1) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); } return (hash >>> 0).toString(16); }
function describeError(error: unknown): string { return error instanceof Error ? error.message : String(error); }
