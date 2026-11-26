import { t } from './i18n';
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

function distinguishNames(items: readonly NamedItem[], reservedName?: string): string[] {
	const counts = new Map<string, number>();
	if (reservedName !== undefined) counts.set(reservedName, 1);
	for (const { name } of items) counts.set(name, (counts.get(name) ?? 0) + 1);
	// Reserve literal names first, including user names that already look like generated labels.
	const used = new Set(counts.keys());
	return items.map(({ name, id }) => {
		if (counts.get(name) === 1) return name;
		const base = `${name} [${id}]`;
		let label = base;
		for (let n = 2; used.has(label); n++) label = `${base} (${n})`;
		used.add(label);
		return label;
	});
}

export function buildOperonCommandCatalog(source: OperonCommandSources) {
	const entries: OperonCommandEntry[] = [];
	function add(name: string, target: OperonCommandTarget): void {
		entries.push({ id: commandId(target), name, target });
	}

	const viewLabels: Record<OperonView, string> = {
		table: t('commands', 'openTablePreset'), calendar: t('commands', 'openCalendarPreset'),
		kanban: t('commands', 'openKanbanPreset'), filter: t('commands', 'openFilterPreset'),
	};
	const defaultLabel = t('settings', 'default');
	const tabLabel = t('commands', 'newTab');
	const lightboxLabel = t('settings', 'workspaceTweaksLightboxSection');
	const hasDefaultTable = source.presets.table.some(table => table.id === source.defaultTableId);
	for (const view of OPERON_VIEWS) {
		const items = source.presets[view];
		const names = distinguishNames(items, defaultLabel);
		const addView = (name: string, preset?: string) => {
			const named = preset === undefined ? {} : { preset };
			const prefix = `${viewLabels[view]} › ${name} › `;
			add(prefix + tabLabel, { kind: 'view', view, ...named, paneType: 'tab' });
			const tableId = preset ?? (hasDefaultTable ? source.defaultTableId : null);
			if (view === 'table' && source.desktop && tableId && source.fileTableIds.has(tableId)) {
				add(prefix + lightboxLabel, { kind: 'view', view, ...named, paneType: 'lightbox' });
			}
		};
		addView(defaultLabel);
		items.forEach((item, index) => addView(names[index], item.id));
	}

	// Both explicit actions are available for every saved rule, independent of Auto scheduling.
	const ruleNames = distinguishNames(source.rules);
	const openAutomation = t('commands', 'openAutomation');
	const runAutomation = t('commands', 'runAutomation');
	source.rules.forEach((rule, index) => {
		const name = ruleNames[index];
		add(openAutomation + ' › ' + name, { kind: 'automation', rule: rule.id, action: 'open' });
		add(runAutomation + ' › ' + name, { kind: 'automation', rule: rule.id, action: 'run' });
	});

	// The four default tabs already own their existing command IDs (including any hotkeys).
	const catalogIds = new Set(entries.map(entry => entry.id));
	for (const { id, name } of source.commands) {
		if (catalogIds.has(id) || !isOperonCommandSlug(id) || id === 'cursor-timer' || id === 'open-uri-finder') continue;
		if (id === 'toggle-timer') {
			add(t('commands', 'toggleTimer'), { kind: 'command', command: 'cursor-timer' });
		} else if (id === 'open-uri-builder') {
			add(t('commands', 'openUriBuilder'), { kind: 'command', command: 'open-uri-finder' });
		} else {
			add(name, { kind: 'command', command: id });
		}
	}
	const labels = distinguishNames(entries);
	return { entries: entries.map((entry, index) => ({ ...entry, name: labels[index] })), hasDefaultTable };
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
