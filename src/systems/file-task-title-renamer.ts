import type { IndexReconciliationEvent, OperonIndexer } from '../indexer/indexer';
import type { IndexedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { clearWindowTimeout, setWindowTimeout, type WindowTimeoutHandle } from '../core/dom-compat';
import { deriveTaskFilename } from '../core/filename-rule';
import { t } from '../core/i18n';

export const FILE_TASK_TITLE_RENAME_DELAY_MS = 300;

interface PendingRename {
	title: string;
	sourcePath: string;
	basename: string | null;
	fullScanAt: string | null;
	timer: WindowTimeoutHandle;
}

type TitleRenameIndexer = Pick<OperonIndexer,
	'subscribeIndexReconciliation' | 'getTask' | 'awaitRamSettlement'
	| 'getLiveReadAuthoritySnapshot' | 'hasDuplicateOperonIdConflict' | 'isTaskSourceTransitionActive'>;

export class FileTaskTitleRenamer {
	private readonly pending = new Map<string, PendingRename>();
	private readonly active = new Map<string, Promise<void>>();
	private readonly ownedRenames = new Map<string, { from: string; to: string }>();
	private readonly unsubscribe: () => void;
	private destroyed = false;
 private readonly deferredChanges = new Map<string, IndexReconciliationEvent>();
 private readonly filenameGuards = new Map<string, Set<{ title: string; ownedTitles: Set<string>; active: boolean }>>();

 /** Called only with verified journal preimages and postimages before the source executor runs. */
 preserveJournalTitleEchoes(operonId: string, titles: readonly string[]): void {
  for (const guard of this.filenameGuards.get(operonId) ?? []) {
   if (guard.active) for (const title of titles) guard.ownedTitles.add(title);
  }
 }

 /** Runtime title-only writes must never schedule a second, unplanned rename. */
 async preservingFilename<T extends { mutationMayHaveApplied: boolean }>(operonId: string, title: string, write: () => Promise<T>): Promise<T> {
  const guard = { title, ownedTitles: new Set([title, this.indexer.getTask(operonId)?.fieldValues['fileTaskDisplayTitle'] ?? '']), active: true };
  const guards = this.filenameGuards.get(operonId) ?? new Set<{ title: string; ownedTitles: Set<string>; active: boolean }>();
  guards.add(guard); this.filenameGuards.set(operonId, guards);
  this.cancel(operonId);
  let mayHaveApplied = true;
  try {
   await this.active.get(operonId);
   const result = await write();
   mayHaveApplied = result.mutationMayHaveApplied;
   return result;
  } finally {
   try { await this.indexer.awaitRamSettlement(); } finally {
    guard.active = false;
    if (!mayHaveApplied || (this.indexer.getTask(operonId)?.fieldValues['fileTaskDisplayTitle'] ?? '') === title) guards.delete(guard);
    if (!guards.size) this.filenameGuards.delete(operonId);
    if (![...guards].some(item => item.active)) {
     const deferred = this.deferredChanges.get(operonId);
     this.deferredChanges.delete(operonId);
     const after = deferred?.kind === 'incremental' ? deferred.changes?.[0]?.after : undefined;
     const current = this.indexer.getTask(operonId);
     if (after && current && current.primary.filePath === after.primary.filePath
      && current.fieldValues['fileTaskDisplayTitle'] === after.fieldValues['fileTaskDisplayTitle']) this.onReconciliation(deferred!);
    }
   }
  }
 }


	constructor(
		private readonly indexer: TitleRenameIndexer,
		private readonly getSettings: () => Pick<OperonSettings,
			'fileTaskDisplayTitleEnabled' | 'fileTaskDisplayTitleChangeMode' | 'fileTaskFilenameRule'>,
		private readonly isReady: () => boolean,
		private readonly getBasename: (task: IndexedTask) => string | null,
		private readonly rename: (operonId: string, filename: string) => Promise<void>,
		private readonly notify: (message: string) => void,
	) {
		this.unsubscribe = indexer.subscribeIndexReconciliation(event => this.onReconciliation(event));
	}

	private enabled(): boolean {
		const settings = this.getSettings();
		return !this.destroyed && this.isReady() && settings.fileTaskDisplayTitleEnabled
			&& settings.fileTaskDisplayTitleChangeMode === 'auto';
	}

	private onReconciliation(event: IndexReconciliationEvent): void {
		if (event.kind === 'full') {
			this.cancelPending();
			return;
		}
		for (const { before, after } of event.changes ?? []) {
			if (!after) {
				if (before) this.cancel(before.operonId);
				continue;
			}
			if (!before || before.primary.format !== 'yaml' || after.primary.format !== 'yaml') continue;
			if (before.primary.filePath !== after.primary.filePath) {
				const owned = this.ownedRenames.get(after.operonId);
				if (owned?.from !== before.primary.filePath || owned.to !== after.primary.filePath) {
					this.cancel(after.operonId);
				} else {
					const pending = this.pending.get(after.operonId);
					if (pending?.sourcePath === before.primary.filePath) {
						pending.sourcePath = after.primary.filePath;
						pending.basename = this.getBasename(after);
					}
				}
			}
			const title = after.fieldValues['fileTaskDisplayTitle'] ?? '';
   const guards = this.filenameGuards.get(after.operonId);
   if (guards && title !== (before.fieldValues['fileTaskDisplayTitle'] ?? '')) {
    const active = [...guards].some(guard => guard.active);
    const echo = [...guards].some(guard => guard.ownedTitles.has(title));
    if (active && !echo) this.deferredChanges.set(after.operonId, { ...event, changes: [{ before, after }] });
    const preserve = active || echo;
    for (const guard of guards) if (!guard.active) guards.delete(guard);
    if (!guards.size) this.filenameGuards.delete(after.operonId);
    if (preserve) { this.cancel(after.operonId); continue; }
   }
			// Write echoes and our own rename change other canonical fields, not the title.
			if (title === (before.fieldValues['fileTaskDisplayTitle'] ?? '')) continue;
			this.cancel(after.operonId);
			if (!title.trim() || !this.enabled()) continue;
			const work: PendingRename = {
				title,
				sourcePath: after.primary.filePath,
				basename: this.getBasename(after),
				fullScanAt: this.indexer.getLiveReadAuthoritySnapshot().lastFullScanAt,
				timer: setWindowTimeout(() => {
					const previous = this.active.get(after.operonId) ?? Promise.resolve();
					const run = previous.then(() => this.apply(after.operonId, work));
					this.active.set(after.operonId, run);
					void run.finally(() => {
						if (this.active.get(after.operonId) === run) this.active.delete(after.operonId);
					});
				}, FILE_TASK_TITLE_RENAME_DELAY_MS),
			};
			this.pending.set(after.operonId, work);
		}
	}

	private isCurrent(operonId: string, work: PendingRename): boolean {
		const task = this.indexer.getTask(operonId);
		return this.pending.get(operonId) === work && ![...(this.filenameGuards.get(operonId) ?? [])].some(guard => guard.active) && this.enabled()
			&& this.indexer.getLiveReadAuthoritySnapshot().lastFullScanAt === work.fullScanAt
			&& task?.primary.format === 'yaml' && task.primary.filePath === work.sourcePath
			&& (task.fieldValues['fileTaskDisplayTitle'] ?? '') === work.title
			&& this.getBasename(task) === work.basename
			&& !this.indexer.hasDuplicateOperonIdConflict(operonId)
			&& !this.indexer.isTaskSourceTransitionActive(operonId);
	}

	private async apply(operonId: string, work: PendingRename): Promise<void> {
		try {
			await this.indexer.awaitRamSettlement();
			if (!this.isCurrent(operonId, work)) return;
			const authority = this.indexer.getLiveReadAuthoritySnapshot();
			if (authority.state !== 'verified' || authority.lastFullScanAt !== work.fullScanAt) return;
			const task = this.indexer.getTask(operonId);
			if (!task || task.primary.format !== 'yaml'
				|| (task.fieldValues['fileTaskDisplayTitle'] ?? '') !== work.title
				|| this.indexer.hasDuplicateOperonIdConflict(operonId)
				|| this.indexer.isTaskSourceTransitionActive(operonId)) return;
			const basename = this.getBasename(task);
			if (basename === null) throw new Error(t('taskEditor', 'fileTaskRenameFailed'));
			const filename = deriveTaskFilename(work.title, this.getSettings().fileTaskFilenameRule);
			if (!filename) throw new Error(t('taskEditor', 'fileTaskFilenameFallback', { filename: `${basename}.md` }));
			if (filename !== basename) {
				const folder = work.sourcePath.slice(0, work.sourcePath.lastIndexOf('/') + 1);
				const owned = { from: work.sourcePath, to: `${folder}${filename}.md` };
				this.ownedRenames.set(operonId, owned);
				try {
					await this.rename(operonId, filename);
				} finally {
					if (this.ownedRenames.get(operonId) === owned) this.ownedRenames.delete(operonId);
				}
			}
		} catch (error) {
			this.notify(error instanceof Error ? error.message : String(error));
		} finally {
			if (this.pending.get(operonId) === work) this.pending.delete(operonId);
		}
	}

	private cancel(operonId: string): void {
		const work = this.pending.get(operonId);
		if (work) clearWindowTimeout(work.timer);
		this.pending.delete(operonId);
	}

	cancelPending(): void {
		this.deferredChanges.clear();
		for (const operonId of this.pending.keys()) this.cancel(operonId);
	}

	destroy(): void {
		this.destroyed = true;
		this.unsubscribe();
		this.cancelPending();
		this.filenameGuards.clear();
		this.deferredChanges.clear();
	}
}
