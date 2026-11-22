import { isOperonCommandSlug, OPERON_VIEWS, type OperonCommandTarget, type OperonView } from './operon-uri';

interface NamedItem {
	readonly id: string;
	readonly name: string;
}

export interface OperonCommandSources {
	/** Operon-owned registrations with their plugin-local IDs and display names. */
	commands: readonly NamedItem[];
	presets: Readonly<Record<OperonView, readonly NamedItem[]>>;
	rules: readonly NamedItem[];
	desktop: boolean;
	defaultTableId: string | null;
	/** Available, file-backed entries from the Table preset registry. */
	fileTableIds: ReadonlySet<string>;
}

export interface OperonCommandEntry extends NamedItem {
	target: OperonCommandTarget;
}

const viewNames: Record<OperonView, string> = { table: 'Table', calendar: 'Calendar', kanban: 'Kanban', filter: 'Filter' };

function commandId(target: OperonCommandTarget): string {
	switch (target.kind) {
		case 'command':
			if (target.command === 'cursor-timer') return 'toggle-timer';
			if (target.command === 'open-uri-finder') return 'open-uri-builder'; // Keep existing palette hotkeys.
			return target.command;
		case 'automation': return `automation-${target.action}-${encodeURIComponent(target.rule)}`;
		case 'view':
			if (target.preset === undefined) return `open-${target.view}-view${target.paneType === 'tab' ? '' : '-lightbox'}`;
			return `open-${target.view}-preset-${encodeURIComponent(target.preset)}-${target.paneType}`;
	}
}

function distinguishNames(items: readonly NamedItem[], reserveDefault: boolean): string[] {
	const counts = new Map<string, number>();
	if (reserveDefault) counts.set('Default', 1);
	for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
	return items.map(({ name, id }) => (counts.get(name) ?? 0) > 1 ? `${name} [${id}]` : name);
}

export function buildOperonCommandCatalog(source: OperonCommandSources) {
	const entries: OperonCommandEntry[] = [];
	function add(name: string, target: OperonCommandTarget): void {
		entries.push({ id: commandId(target), name, target });
	}

	const hasDefaultTable = source.presets.table.some(table => table.id === source.defaultTableId);
	for (const view of OPERON_VIEWS) {
		const items = source.presets[view];
		const names = distinguishNames(items, true);
		const addView = (name: string, preset?: string) => {
			const named = preset === undefined ? {} : { preset };
			const prefix = `Open ${viewNames[view]} › ${name} › `;
			add(prefix + 'New Tab', { kind: 'view', view, ...named, paneType: 'tab' });
			const tableId = preset ?? (hasDefaultTable ? source.defaultTableId : null);
			if (view === 'table' && source.desktop && tableId && source.fileTableIds.has(tableId)) {
				add(prefix + 'Lightbox', { kind: 'view', view, ...named, paneType: 'lightbox' });
			}
		};
		addView('Default');
		items.forEach((item, index) => addView(names[index], item.id));
	}

	// Both explicit actions are available for every saved rule, independent of Auto scheduling.
	const ruleNames = distinguishNames(source.rules, false);
	source.rules.forEach((rule, index) => {
		const name = ruleNames[index];
		add('Open automation › ' + name, { kind: 'automation', rule: rule.id, action: 'open' });
		add('Run automation › ' + name, { kind: 'automation', rule: rule.id, action: 'run' });
	});

	// The four default tabs already own their existing command IDs (including any hotkeys).
	const catalogIds = new Set(entries.map(entry => entry.id));
	for (const { id, name } of source.commands) {
		if (catalogIds.has(id) || !isOperonCommandSlug(id) || id === 'cursor-timer' || id === 'open-uri-finder') continue;
		if (id === 'toggle-timer') {
			add('Start/stop timer for task at cursor', { kind: 'command', command: 'cursor-timer' });
		} else {
			add(name, { kind: 'command', command: id === 'open-uri-builder' ? 'open-uri-finder' : id });
		}
	}
	return { entries, hasDefaultTable };
}

type CommandCatalog = ReturnType<typeof buildOperonCommandCatalog>;
export interface ActiveMarkdownTimerContext {
	inlineTaskId: string | null;
	fileTaskId: string | null;
}

type CommandResolution =
	| { status: 'ready'; entry: OperonCommandEntry; taskId?: string }
	| { status: 'offer-new-tab'; entry: OperonCommandEntry }
	| { status: 'preset-not-found' | 'rule-not-found' | 'command-unavailable' };

/** Resolve against the destination vault's current catalog and active Markdown editor at invocation. */
export function resolveOperonCommand(target: OperonCommandTarget, catalog: CommandCatalog, editor: ActiveMarkdownTimerContext | null = null): CommandResolution {
	const id = commandId(target);
	const entry = catalog.entries.find(item => item.id === id && item.target.kind === target.kind);
	if (entry) {
		if (target.kind === 'command' && entry.target.kind === 'command') {
			if (entry.target.command !== target.command) return { status: 'command-unavailable' };
			if (target.command === 'cursor-timer') {
				const taskId = editor?.inlineTaskId || editor?.fileTaskId;
				return taskId ? { status: 'ready', entry, taskId } : { status: 'command-unavailable' };
			}
		}
		return { status: 'ready', entry };
	}
	if (target.kind === 'view') {
		if (target.paneType === 'lightbox' && (target.preset !== undefined || catalog.hasDefaultTable)) {
			const tabId = commandId({ ...target, paneType: 'tab' });
			const tab = catalog.entries.find(item => item.target.kind === 'view' && item.id === tabId);
			if (tab) return { status: 'offer-new-tab', entry: tab };
		}
		return { status: 'preset-not-found' };
	}
	return { status: target.kind === 'automation' ? 'rule-not-found' : 'command-unavailable' };
}
