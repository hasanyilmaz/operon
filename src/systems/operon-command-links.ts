import type { Command, ObsidianProtocolData } from 'obsidian';
import { buildOperonCommandCatalog, resolveOperonCommand, type ActiveMarkdownTimerContext, type OperonCommandSources } from '../core/operon-command-catalog';
import { parseOperonUri, type OperonCommandTarget, type OperonView } from '../core/operon-uri';

export type OperonViewSources = Pick<OperonCommandSources, 'presets' | 'desktop' | 'defaultTableId' | 'fileTableIds'>;

interface Ports {
	register(command: Command): Command;
	remove(id: string): void;
	viewSources(): OperonViewSources;
	vaultName(): string;
	cursor(): ActiveMarkdownTimerContext | null;
	openPresetTab(view: OperonView, id: string): Promise<void> | void;
	openTableLightbox(id: string): Promise<void>;
	confirmTableTab(): Promise<boolean>;
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
		const viewEntry = this.catalog.entries.find(entry => entry.target.kind === 'view' && entry.id === id);
		const name = viewEntry?.name ?? command.name;
		const registered = this.ports.register({ ...command, name });
		this.commands.set(id, { id, name, registered });
		return registered;
	}

	private buildCatalog(sources = this.ports.viewSources()) {
		const catalog = buildOperonCommandCatalog({ ...sources, commands: [...this.commands.values()], rules: [] });
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
		const previous = this.entries;
		this.catalog = this.buildCatalog();
		const next = new Map(this.entries.filter(entry => entry.target.kind === 'view' && (entry.target.preset !== undefined || entry.target.paneType === 'lightbox'))
			.map(entry => [entry.id, entry]));
		for (const [id, name] of this.presets) {
			if (next.get(id)?.name === name) continue;
			this.ports.remove(id);
			this.presets.delete(id);
		}
		for (const entry of next.values()) {
			if (this.presets.has(entry.id)) continue;
			this.ports.register({ id: entry.id, name: entry.name, callback: () => this.invoke(entry.target).catch(() => this.ports.unavailable('command')) });
			this.presets.set(entry.id, entry.name);
		}
		if (previous.length !== this.entries.length || this.entries.some((entry, index) =>
			entry.id !== previous[index]?.id || entry.name !== previous[index]?.name)) {
			for (const listener of this.listeners) listener();
		}
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
		const sources = target.kind === 'view' ? this.ports.viewSources() : undefined;
		const result = resolveOperonCommand(target, sources ? this.buildCatalog(sources) : this.catalog, cursor);
		if (target.kind === 'view' && target.paneType === 'lightbox') {
			const tableId = target.preset ?? sources?.defaultTableId;
			if (tableId && result.status === 'offer-new-tab') {
				if (await this.ports.confirmTableTab()) {
					await this.invoke({ kind: 'view', view: 'table', paneType: 'tab', preset: tableId });
				}
				return;
			}
			if (tableId && result.status === 'ready') {
				await this.ports.openTableLightbox(tableId);
				return;
			}
		}
		if (result.status !== 'ready') {
			this.ports.unavailable(result.status === 'preset-not-found' ? 'preset' : 'command');
			return;
		}
		if (target.kind === 'view' && target.preset !== undefined) {
			await this.ports.openPresetTab(target.view, target.preset);
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
