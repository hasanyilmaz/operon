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
			// Write echoes and our own rename change other canonical fields, not the title.
			if (title === (before.fieldValues['fileTaskDisplayTitle'] ?? '')) continue;
			this.cancel(after.operonId);
			if (!this.enabled()) continue;
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
		return this.pending.get(operonId) === work && this.enabled()
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

	private cancelPending(): void {
		for (const operonId of this.pending.keys()) this.cancel(operonId);
	}

	destroy(): void {
		this.destroyed = true;
		this.unsubscribe();
		this.cancelPending();
	}
}
