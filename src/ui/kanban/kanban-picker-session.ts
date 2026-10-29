import type { App } from 'obsidian';
import { createKanbanPropertyAccess, type KanbanPropertyRead } from '../../core/kanban-axis-properties';
import type { KanbanPropertyReference } from '../../core/kanban-axis-model';
import { getNativePropertyIndex } from '../../indexer/native-property-index';
import { collectKanbanScope, type KanbanGroupingOptions } from '../../systems/kanban-grouping';
import type { OperonSettings } from '../../types/settings';
import type { IndexedTask } from '../../types/fields';

export type KanbanPickerContext = Pick<KanbanGroupingOptions, 'tasks' | 'filterSet' | 'filterEvaluationOptions' | 'pinnedCache'> & { settings: OperonSettings };
export type KanbanPickerData = KanbanPickerContext & {
	access: ReturnType<typeof createKanbanPropertyAccess>;
	scope: ReturnType<typeof collectKanbanScope>;
	memo?: <T>(key: string, calculate: () => T) => T;
};

/** Owned by one settings modal. Never used by the board or persisted. */
export class KanbanPickerSession {
	private key = '';
	private epoch = 0;
	private closed = false;
	private access?: ReturnType<typeof createKanbanPropertyAccess>;
	private reads = new WeakMap<IndexedTask, Map<string, KanbanPropertyRead>>();
	private prepared = new Map<string, string>();
	private results = new Map<string, unknown>();
	private scopeKey = '';
	constructor(private app: App, private context: () => KanbanPickerContext, private revision: () => number | string,
		private yieldControl: () => Promise<void>) {}
	cancelPending(): void { this.epoch++; this.reads = new WeakMap(); this.prepared.clear(); }
	invalidate(): void { this.key = ''; this.epoch++; this.access = undefined; this.reads = new WeakMap(); this.prepared.clear(); this.results.clear(); this.scopeKey = ''; }
	dispose(): void { this.closed = true; this.invalidate(); }
	/** A changing index invalidates a computation, not the user's click. */
	async prepareLatest(property: KanbanPropertyReference | undefined, isCurrent: () => boolean): Promise<KanbanPickerData | null> {
		for (let attempt = 0; attempt < 3; attempt++) {
			if (this.closed || !isCurrent()) return null;
			const data = await this.prepare(property);
			if (this.closed || !isCurrent()) return null;
			if (data) return data;
		}
		throw new Error('Kanban picker data kept changing during preparation');
	}
	private stamp(settings: OperonSettings): string {
		return JSON.stringify([this.revision(), getNativePropertyIndex(this.app).getRevision(), settings.keyMappings,
			settings.inlinePropertyDefinitions, settings.priorities, settings.pipelines, settings.filterSets, settings.projectSerialScopes]);
	}
	async prepare(property?: KanbanPropertyReference): Promise<KanbanPickerData | null> {
		if (this.closed) return null;
		const context = this.context(), native = getNativePropertyIndex(this.app);
		native.configure(context.settings);
		const stamp = this.stamp(context.settings);
		if (stamp !== this.key) {
			this.invalidate(); this.key = stamp;
			const base = createKanbanPropertyAccess(context.settings, native), keys = new WeakMap<KanbanPropertyReference, string>();
			this.access = { ...base, read: (task, reference) => {
				let row = this.reads.get(task); if (!row) { row = new Map(); this.reads.set(task, row); }
				let id = keys.get(reference); if (!id) { id = JSON.stringify(reference); keys.set(reference, id); }
				let read = row.get(id); if (!read) { read = base.read(task, reference); row.set(id, read); }
				return read;
			} };
		}
		const epoch = this.epoch, access = this.access!, revision = this.revision();
		// Filters can depend on time, trackers or pin state: re-evaluate on each request.
		const scope = collectKanbanScope(context);
		const scopeKey = JSON.stringify([scope.scope.scopeComplete, scope.scoped.map(task => task.operonId)]);
		if (scopeKey !== this.scopeKey) { this.results.clear(); this.scopeKey = scopeKey; }
		const resultKey = property ? `values:${JSON.stringify(property)}` : 'properties';
		const fields = this.results.has(resultKey) ? [] : property ? [property] : access.fields.map(field => field.reference);
		const tasks = property ? context.tasks : scope.scoped;
		let budgetStart = performance.now();
		for (const field of fields) {
			const fieldKey = JSON.stringify(field), prepared = this.prepared.get(fieldKey);
			if (prepared === '*' || !property && prepared === scopeKey) continue;
			for (const task of tasks) {
				access.read(task, field);
				if (performance.now() - budgetStart >= 6) {
					await this.yieldControl();
					if (this.closed || epoch !== this.epoch) return null;
					if (revision !== this.revision() || access.revision !== native.getRevision()) { this.invalidate(); return null; }
					budgetStart = performance.now();
				}
			}
			this.prepared.set(fieldKey, property ? '*' : scopeKey);
		}
		if (this.closed || epoch !== this.epoch) return null;
		const latestContext = this.context();
		if (stamp !== this.stamp(latestContext.settings)) { this.invalidate(); return null; }
		const latest = collectKanbanScope(latestContext);
		if (scopeKey !== JSON.stringify([latest.scope.scopeComplete, latest.scoped.map(task => task.operonId)])) { this.cancelPending(); this.results.clear(); return null; }
		return { ...context, access, scope, memo: <T>(key: string, calculate: () => T): T => {
			if (!this.results.has(key)) {
				if (this.results.size >= 16) { const oldest: unknown = this.results.keys().next().value; if (typeof oldest === 'string') this.results.delete(oldest); }
				this.results.set(key, calculate());
				// Keep small picker results, not every task's full read/write-target payload.
				this.reads = new WeakMap(); this.prepared.clear();
			}
			return this.results.get(key) as T;
		} };
	}
}
