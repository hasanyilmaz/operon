import { TFile, type Vault } from 'obsidian';
import type { OperonIndexer } from '../indexer/indexer';
import type { PinnedCache } from '../storage/pinned-cache';
import type { IndexedTask } from '../types/fields';

/** Fence reads used by Scope, Target and domain projections, including tasks that receive no write. */
export function captureAutomationReadState(vault: Vault, index: OperonIndexer, pins: PinnedCache, tasks: IndexedTask[], config: () => string) {
	const generation = index.getGeneration(), pinGeneration = pins.getGeneration(), configAtStart = config();
	const paths = new Set(tasks.map(task => task.primary.filePath));
	const ready = () => index.getLiveReadAuthoritySnapshot().settled && index.getGeneration() === generation
		&& pins.getGeneration() === pinGeneration && config() === configAtStart
		&& [...paths].every(path => { const file = vault.getAbstractFileByPath(path); return file instanceof TFile && index.isIndexedSourceCurrent(file); });
	return {
		ready,
		watch() {
			let valid = ready(), pinRevision = pinGeneration;
			const writtenPaths = new Set<string>(), writing = new Set<string>(), allowedPins = new Map<string, boolean>();
			const initialPins = new Set(pins.getPinnedIds());
			const record = (path: string) => {
				if (path.toLowerCase().endsWith('.md') && !writing.has(path)) valid = false;
			};
			const refs = [vault.on('modify', file => record(file.path)), vault.on('delete', file => record(file.path)),
				vault.on('create', file => record(file.path)), vault.on('rename', (file, old) => { record(old); record(file.path); })];
			const off = index.subscribeIndexReconciliation(event => {
				if (event.kind === 'full' || event.affectedOperonIds.some(id => {
					const task = index.getTask(id);
					return !task || !writtenPaths.has(task.primary.filePath);
				})) valid = false;
			});
			return {
				current: () => {
					if (!valid || config() !== configAtStart) return false;
					if (pinRevision !== pins.getGeneration()) {
						const actual = new Set(pins.getPinnedIds());
						for (const id of new Set([...actual, ...initialPins])) {
							if (actual.has(id) !== initialPins.has(id) && actual.has(id) !== allowedPins.get(id)) valid = false;
						}
						pinRevision = pins.getGeneration();
					}
					return valid;
				},
				ownPath: (path: string) => { writtenPaths.add(path); writing.add(path); },
				settled: () => {
					writing.clear();
					for (const [id, pinned] of allowedPins) { if (pinned) initialPins.add(id); else initialPins.delete(id); }
					allowedPins.clear();
				},
				ownPin: (id: string, pinned: boolean) => { allowedPins.set(id, pinned); },
				close: () => { for (const ref of refs) vault.offref(ref); off(); },
			};
		},
	};
}
