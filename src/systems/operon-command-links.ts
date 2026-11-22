import type { Command, ObsidianProtocolData } from 'obsidian';
import { buildOperonCommandCatalog, resolveOperonCommand, type ActiveMarkdownTimerContext, type OperonCommandSources } from '../core/operon-command-catalog';
import { parseOperonUri, type OperonCommandTarget, type OperonView } from '../core/operon-uri';

export type OperonViewSources = Pick<OperonCommandSources, 'presets' | 'desktop' | 'defaultTableId' | 'fileTableIds'>;

interface Ports {
	register(command: Command): Command;
	remove(id: string): void;
	viewSources(): OperonViewSources;
	rules(): OperonCommandSources['rules'];
	openRule(id: string): void;
	runRule(id: string): Promise<void>;
	vaultName(): string;
	cursor(): ActiveMarkdownTimerContext | null;
	openPresetTab(view: OperonView, id: string): Promise<void> | void;
	openTableLightbox(id: string): Promise<void>;
	confirmTableTab(): Promise<boolean>;
	unavailable(reason: 'invalid' | 'preset' | 'rule' | 'command'): void;
}

interface Registration {
	name: string;
	registered: Command;
}

/** Own the same local IDs as the palette. Obsidian prefixes (and mutates) commands when registering them. */
export class OperonCommandLinks {
	private readonly commands = new Map<string, Registration & { id: string; sourceName: string }>();
	private readonly dynamicCommands = new Map<string, Registration>();
	private readonly listeners = new Set<() => void>();
	private catalog: ReturnType<typeof buildOperonCommandCatalog>;

	constructor(private readonly ports: Ports) {
		this.catalog = this.buildCatalog();
	}

	register(command: Command): Command {
		const { id } = command;
		const viewEntry = this.catalog.entries.find(entry => entry.target.kind === 'view' && entry.id === id);
		const name = viewEntry?.name ?? command.name;
		const callback = command.callback;
		const registered = this.ports.register(viewEntry && callback
			? { ...command, name, callback: () => this.withFeedback(callback) }
			: { ...command, name });
		this.commands.set(id, { id, name, registered, sourceName: command.name });
		return registered;
	}

	private buildCatalog(sources = this.ports.viewSources()) {
		return buildOperonCommandCatalog({ ...sources, rules: this.ports.rules(),
			commands: Array.from(this.commands.values(), ({ id, sourceName }) => ({ id, name: sourceName })),
		});
	}

	get entries() { return this.catalog.entries; }

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	refresh(): void {
		const previous = this.entries;
		this.catalog = this.buildCatalog();
		const retained = new Set<string>();
		for (const entry of this.entries) {
			const dynamic = entry.target.kind === 'automation' || (entry.target.kind === 'view' &&
				(entry.target.preset !== undefined || entry.target.paneType === 'lightbox'));
			if (dynamic) retained.add(entry.id);
			const registration = this.commands.get(entry.id) ?? this.dynamicCommands.get(entry.id);
			if (registration) {
				if (registration.name !== entry.name) {
					// Obsidian prepends the plugin name. Keep that prefix and the host's original object.
					const prefix = registration.registered.name.slice(0, registration.registered.name.length - registration.name.length);
					registration.registered.name = prefix + entry.name;
					registration.name = entry.name;
				}
			} else if (dynamic) {
				const registered = this.ports.register({ id: entry.id, name: entry.name, callback: () => this.withFeedback(() => this.invoke(entry.target)) });
				this.dynamicCommands.set(entry.id, { name: entry.name, registered });
			}
		}
		for (const id of this.dynamicCommands.keys()) {
			if (retained.has(id)) continue;
			this.ports.remove(id);
			this.dynamicCommands.delete(id);
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
		await this.withFeedback(() => this.invoke(link.target));
	}

	private async withFeedback(action: () => unknown): Promise<void> {
		try { await action(); }
		catch (error) {
			console.error('Operon: command failed', error);
			this.ports.unavailable('command');
		}
	}

	private async invoke(target: OperonCommandTarget): Promise<void> {
		const cursor = target.kind === 'command' && target.command === 'cursor-timer' ? this.ports.cursor() : null;
		const sources = target.kind !== 'command' ? this.ports.viewSources() : undefined;
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
			this.ports.unavailable(result.status === 'preset-not-found' ? 'preset' : result.status === 'rule-not-found' ? 'rule' : 'command');
			return;
		}
		if (target.kind === 'automation') {
			if (target.action === 'open') this.ports.openRule(target.rule);
			else await this.ports.runRule(target.rule);
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
			await registered.callback();
			return;
		}
		this.ports.unavailable('command');
	}
}
