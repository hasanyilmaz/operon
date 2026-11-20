import type { AutomationRule } from '../core/automation-rules';
import type { NativePropertyIndex } from '../indexer/native-property-index';
import type { IndexedTask } from '../types/fields';

interface TaskImage { core: string; native?: string; dates?: string }

export function automationTaskImage(task: IndexedTask, properties: NativePropertyIndex, path = task.primary.filePath): TaskImage {
	const yaml = task.primary.format === 'yaml';
	const fields = Object.entries(task.fieldValues).filter(([key]) => !yaml || key !== 'datetimeCreated' && key !== 'datetimeModified');
	const row = properties.getTask(task);
	// Native values with a supported filter representation are scalars or flat lists.
	const values = [...row.properties].map(([key, prop]) => {
		const value = prop.value;
		const readable = value === null || typeof value !== 'object' || value instanceof Date
			|| Array.isArray(value) && value.every(v => v === null || typeof v !== 'object');
		return [key, readable ? value : null, prop.reason ?? null] as const;
	}).sort(([a], [b]) => a.localeCompare(b));
	return {
		core: JSON.stringify([path, task.primary.format, yaml ? path.split('/').pop()?.replace(/\.md$/iu, '') : task.description,
			task.checkbox, fields.sort(([a], [b]) => a.localeCompare(b)), [...task.tags].sort(), task.plainCheckboxProgress]),
		native: row.available ? JSON.stringify(values) : undefined,
		dates: yaml ? properties.storedTaskDates(task) : undefined,
	};
}

function sameImage(a: TaskImage, b: TaskImage): boolean {
	return a.core === b.core && (a.native === undefined || b.native === undefined || a.native === b.native)
		&& (a.dates === undefined || b.dates === undefined || a.dates === b.dates);
}

interface Change { source?: { before?: TaskImage; sequence: number }; pin?: boolean }
interface Pin { pinned: boolean; updatedAt: string }
interface EventPorts {
	taskIds(): Iterable<string>;
	image(id: string): TaskImage | undefined;
	pins(): string[];
	pin(id: string): Pin | null;
	settled(): boolean;
	settle(): Promise<void>;
	currentPath(id: string): string | undefined;
	run(take: () => Promise<Map<string, Set<string>>>): Promise<unknown>;
	error(error: unknown): void;
}

/** Per-plugin, in-memory observation. Settings and initial hydration only establish a baseline. */
export class AutoAutomationEvents {
	private readonly rules = new Map<string, string>();
	private readonly known = new Map<string, TaskImage>();
	private pins = new Set<string>();
	private pending = new Map<string, Map<string, Change>>();
	private inFlight?: Map<string, Set<string>>;
	private readonly ownSources = new Map<string, { image: TaskImage; since: number }>();
	private readonly ownPins = new Map<string, Pin>();
	private readonly activating = new Map<string, Set<string>>();
	private sequence = 0;
	private scheduled = false;
	private disposed = false;

	constructor(private readonly ports: EventPorts) {}

	configure(rules: readonly AutomationRule[]): void {
		if (this.disposed) return;
		const previouslyEnabled = this.rules.size > 0;
		const next = new Map(rules.filter(rule => rule.active && rule.mode === 'auto').map(rule => [rule.id, JSON.stringify(rule)]));
		for (const [id, version] of this.rules) if (next.get(id) !== version) {
			this.pending.delete(id);
			this.inFlight?.delete(id);
			this.activating.delete(id);
		}
		if (!this.ports.settled()) for (const [id, version] of next) if (this.rules.get(id) !== version) {
			// A file edited before activation may still be in the indexer's debounce queue.
			const paths = new Set<string>();
			this.activating.set(id, paths);
			void this.ports.settle().then(() => {
				if (this.activating.get(id) === paths) this.activating.delete(id);
			}).catch(error => this.ports.error(error));
		}
		this.rules.clear();
		for (const [id, version] of next) this.rules.set(id, version);
		if (!next.size) this.clear();
		else if (!previouslyEnabled) {
			for (const id of this.ports.taskIds()) {
				const image = this.ports.image(id);
				if (image) this.known.set(id, image);
			}
			this.pins = new Set(this.ports.pins());
		}
	}

	get watching(): boolean { return this.rules.size > 0; }

	fileChanged(path: string): void {
		for (const paths of this.activating.values()) paths.add(path);
	}

	/** The sequence separates user edits already pending from later echoes of this write. */
	beginSource(): number { return ++this.sequence; }
	ownSource(id: string, image: TaskImage, since: number): void {
		if (this.watching) this.ownSources.set(id, { image, since });
	}
	ownPin(id: string, pinned: boolean, updatedAt: string): void {
		if (this.watching) this.ownPins.set(id, { pinned, updatedAt });
	}

	/** A full rebuild can change field mappings or admit existing folders. It establishes current membership. */
	rebase(): void {
		if (!this.watching) return;
		this.reconcile(new Set([...this.known.keys(), ...this.ports.taskIds()]), true);
	}

	reconcile(ids: Iterable<string>, baseline = false): void {
		if (!this.watching) return;
		const sequence = ++this.sequence;
		for (const id of ids) {
			const before = this.known.get(id), next = this.ports.image(id);
			if (!next) {
				this.known.delete(id);
				this.ownSources.delete(id); this.ownPins.delete(id);
				for (const changes of this.pending.values()) changes.delete(id);
				continue;
			}
			const after = { ...next, native: next.native ?? before?.native, dates: next.dates ?? before?.dates };
			this.known.set(id, after);
			if (!baseline && (!before || !sameImage(before, after))) this.record(id, change => { change.source ??= { before, sequence }; }, true);
		}
	}

	pinsChanged(): void {
		if (!this.watching) return;
		const after = new Set(this.ports.pins());
		for (const id of new Set([...this.pins, ...after])) {
			const before = this.pins.has(id);
			if (before !== after.has(id) && this.known.has(id)) this.record(id, change => { change.pin ??= before; });
		}
		this.pins = after;
	}

	private record(id: string, update: (change: Change) => void, source = false): void {
		for (const rule of this.rules.keys()) {
			const paths = this.activating.get(rule);
			if (source && paths && !paths.has(this.ports.currentPath(id) ?? '')) continue;
			const changes = this.pending.get(rule) ?? new Map<string, Change>();
			const change = changes.get(id) ?? {};
			update(change);
			changes.set(id, change);
			this.pending.set(rule, changes);
		}
		this.schedule();
	}

	private schedule(): void {
		if (this.scheduled || this.disposed || !this.pending.size) return;
		this.scheduled = true;
		void this.ports.run(async () => {
			await this.ports.settle();
			const batch = this.take();
			this.inFlight = batch;
			return batch;
		}).catch(error => { this.ports.error(error); }).finally(() => {
			this.inFlight = undefined;
			this.scheduled = false;
			this.schedule();
		});
	}

	private take(): Map<string, Set<string>> {
		const result = new Map<string, Set<string>>();
		const observedSources = new Set<string>(), observedPins = new Set<string>();
		for (const [rule, changes] of this.pending) {
			const triggers = new Set<string>();
			for (const [id, change] of changes) {
				const image = this.known.get(id);
				if (!image) continue;
				if (change.source) {
					observedSources.add(id);
					const own = this.ownSources.get(id);
					const echo = own && change.source.sequence > own.since && sameImage(own.image, image);
					if (!echo && (!change.source.before || !sameImage(change.source.before, image))) triggers.add(id);
				}
				if (change.pin !== undefined) {
					observedPins.add(id);
					const actual = this.ports.pin(id), own = this.ownPins.get(id);
					if (change.pin !== this.pins.has(id) && (!own || own.updatedAt !== actual?.updatedAt || own.pinned !== actual.pinned)) triggers.add(id);
				}
			}
			if (triggers.size) result.set(rule, triggers);
		}
		for (const id of observedSources) this.ownSources.delete(id);
		for (const id of observedPins) this.ownPins.delete(id);
		this.pending.clear();
		return result;
	}

	private clear(): void {
		this.pending.clear(); this.known.clear(); this.pins.clear();
		this.ownSources.clear(); this.ownPins.clear(); this.activating.clear();
	}
	dispose(): void {
		this.disposed = true;
		this.rules.clear(); this.inFlight?.clear(); this.clear();
	}
}
