import type { Command, ObsidianProtocolData } from 'obsidian';
import { buildOperonCommandCatalog, resolveOperonCommand, type ActiveMarkdownTimerContext } from '../core/operon-command-catalog';
import { parseOperonUri, type OperonCommandTarget } from '../core/operon-uri';

interface Ports {
	register(command: Command): Command;
	remove(id: string): void;
	kanbanPresets(): readonly { id: string; name: string }[];
	vaultName(): string;
	cursor(): ActiveMarkdownTimerContext | null;
	openKanban(id: string): Promise<void>;
	unavailable(reason: 'invalid' | 'preset' | 'command'): void;
}

/** Own the same local IDs as the palette. Obsidian prefixes (and mutates) commands when registering them. */
export class OperonCommandLinks {
	private readonly commands = new Map<string, { id: string; name: string; registered: Command }>();
	private readonly presets = new Map<string, string>();
	private readonly listeners = new Set<() => void>();
	private catalog: ReturnType<typeof buildOperonCommandCatalog>;

	constructor(private readonly ports: Ports) {
		this.catalog = this.buildCatalog();
	}

	register(command: Command): Command {
		const { id } = command;
		const catalogName = id === 'open-kanban-view'
			? this.catalog.entries.find(entry => entry.id === id)?.name : undefined;
		const name = catalogName ?? command.name;
		const registered = this.ports.register({ ...command, name });
		this.commands.set(id, { id, name, registered });
		return registered;
	}

	private buildCatalog() {
		const catalog = buildOperonCommandCatalog({
			commands: [...this.commands.values()], rules: [], desktop: false, defaultTableId: null, fileTableIds: new Set(),
			presets: { kanban: this.ports.kanbanPresets(), calendar: [], table: [], filter: [] },
		});
		return { ...catalog, entries: catalog.entries.map(entry => ({
			...entry, name: this.commands.get(entry.id)?.name ?? entry.name,
		})) };
	}

	get entries() { return this.catalog.entries; }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	refresh(): void {
		this.catalog = this.buildCatalog();
		const next = new Map(this.entries.filter(entry => entry.target.kind === 'view' && entry.target.preset !== undefined)
			.map(entry => [entry.id, entry]));
		let changed = false;
		for (const [id, name] of this.presets) {
			if (next.get(id)?.name === name) continue;
			this.ports.remove(id);
			this.presets.delete(id);
			changed = true;
		}
		for (const entry of next.values()) {
			if (this.presets.has(entry.id)) continue;
			this.ports.register({ id: entry.id, name: entry.name, callback: () => this.invoke(entry.target).catch(() => this.ports.unavailable('command')) });
			this.presets.set(entry.id, entry.name);
			changed = true;
		}
		if (changed) for (const listener of this.listeners) listener();
	}

	async handleProtocol(data: ObsidianProtocolData): Promise<void> {
		const params = new URLSearchParams();
		for (const [key, value] of Object.entries(data)) {
			if (key !== 'action') params.append(key, value);
		}
		const receivingVault = this.ports.vaultName();
		// Desktop removes the vault parameter after routing the URI to this window.
		if (!params.has('vault')) params.set('vault', receivingVault);
		const link = parseOperonUri('obsidian://operon?' + params.toString());
		if (data.action !== 'operon' || !link || link.vault !== receivingVault) {
			this.ports.unavailable('invalid');
			return;
		}
		await this.invoke(link.target);
	}

	private async invoke(target: OperonCommandTarget): Promise<void> {
		const cursor = target.kind === 'command' && target.command === 'cursor-timer' ? this.ports.cursor() : null;
		const result = resolveOperonCommand(target, this.catalog, cursor);
		if (result.status !== 'ready') {
			this.ports.unavailable(result.status === 'preset-not-found' ? 'preset' : 'command');
			return;
		}
		if (target.kind === 'view' && target.view === 'kanban' && target.preset !== undefined) {
			if (!this.ports.kanbanPresets().some(preset => preset.id === target.preset)) {
				this.ports.unavailable('preset');
				return;
			}
			await this.ports.openKanban(target.preset);
			return;
		}
		const registered = this.commands.get(result.entry.id)?.registered;
		// Obsidian also installs the active-editor guard here for registered editor commands.
		if (registered?.checkCallback) {
			if (registered.checkCallback(true)) { registered.checkCallback(false); return; }
		} else if (registered?.callback) {
			registered.callback();
			return;
		}
		this.ports.unavailable('command');
	}
}
