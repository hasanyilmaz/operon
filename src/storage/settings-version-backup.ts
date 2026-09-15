import type { DataAdapter } from 'obsidian';
import { sha256HexForStorage } from './storage-sha256';

type BackupAdapter = Pick<DataAdapter, 'exists' | 'read' | 'write' | 'remove'>
	& Partial<Pick<DataAdapter, 'mkdir' | 'rename' | 'list'>>;
type Entry = { name: string; digest: string };
type Journal = {
	format: 'operon-settings-backups';
	version: 1;
	generation: number;
	processedVersion: string | null;
	backups: Entry[];
	pending: { targetVersion: string; entry: Entry } | null;
};
type ObservedJournal = { value: Journal; slot: number; sources: (string | null)[] };
const queues = new WeakMap<BackupAdapter, Map<string, Promise<void>>>();
const versionPattern = /^[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?$/u;
const namePattern = /^data-\d{8}T\d{9}Z-before-[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z.-]+)?-[0-9a-f-]{36}\.json$/u;

/** Internal journal, independent of user settings. No automatic restoration. */
export async function prepareSettingsVersionBackup(
	adapter: BackupAdapter, pluginDir: string, canonicalPath: string,
	source: string | null, targetVersion: string, firstInstallation = false,
): Promise<void> {
	let paths = queues.get(adapter);
	if (!paths) { paths = new Map(); queues.set(adapter, paths); }
	const previous = paths.get(pluginDir) ?? Promise.resolve();
	const operation = previous.catch(() => undefined).then(async () => {
		await new SettingsVersionBackup(adapter, pluginDir, canonicalPath).prepare(source, targetVersion, firstInstallation);
	});
	paths.set(pluginDir, operation);
	try { await operation; } finally {
		if (paths.get(pluginDir) === operation) paths.delete(pluginDir);
	}
}

class SettingsVersionBackup {
	private readonly directory: string;
	private readonly temporary: string;
	constructor(private readonly adapter: BackupAdapter, pluginDir: string, private readonly canonicalPath: string) {
		this.directory = `${pluginDir}/backups/settings`;
		this.temporary = `${this.directory}/pending.tmp`;
	}

	async prepare(source: string | null, targetVersion: string, firstInstallation: boolean): Promise<void> {
		if (!versionPattern.test(targetVersion)) throw new Error('Invalid backup target version');
		await this.assertCanonical(source);
		let journal = await this.load();
		await this.assertInventory(journal.value);
		// A missing first-install source has nothing to back up. Record its version only
		// after the first canonical publication, avoiding an orphan installation marker.
		if (source === null) return;
		if (journal.value.pending) {
			// An interrupted operation never adopts a different canonical source.
			if (await sha256HexForStorage(source) !== journal.value.pending.entry.digest) {
				throw new Error('Interrupted settings backup has a different source');
			}
			journal = await this.finish(journal, source);
		}
		if (journal.value.processedVersion === targetVersion) {
			await this.verifyEntries(journal.value.backups);
			await this.assertCanonical(source);
			return;
		}
		if (await this.adapter.exists(this.temporary)) throw new Error('Unowned settings backup temporary file');
		await this.verifyEntries(journal.value.backups);
		await this.ensureDirectory();
		if (firstInstallation) {
			if (journal.value.backups.length || journal.value.processedVersion) throw new Error('Existing backup installation lost its settings');
			await this.save(journal, { ...journal.value, processedVersion: targetVersion });
			await this.assertCanonical(source);
			return;
		}
		const stamp = new Date().toISOString().replace(/[-:.]/gu, '');
		const entry = {
			name: `data-${stamp}-before-${targetVersion}-${crypto.randomUUID()}.json`,
			digest: await sha256HexForStorage(source),
		};
		if (await this.adapter.exists(this.path(entry))) throw new Error('Settings backup name collision');
		journal = await this.save(journal, { ...journal.value, pending: { targetVersion, entry } });
		await this.finish(journal, source);
		await this.assertCanonical(source);
	}

	private async finish(journal: ObservedJournal, source: string): Promise<ObservedJournal> {
		const pending = journal.value.pending!;
		const destination = this.path(pending.entry);
		const published = await this.read(destination);
		const retained = journal.value.backups.length === 2 ? journal.value.backups.slice(1) : journal.value.backups;
		const evicted = journal.value.backups.length === 2 ? journal.value.backups[0] : undefined;
		await this.verifyEntries(retained);
		if (published !== null) {
			if (published !== source) throw new Error('Published settings backup verification failed');
			// The pending journal owns the only temporary path, including a torn write.
			await this.removeVerifiedTemporary(source);
		} else {
			if (await this.read(this.temporary) !== source) {
				await this.writeVerified(this.temporary, source);
			}
			await this.assertCanonical(source);
			await this.assertJournal(journal);
			// Verify the replacement before eviction; keep at most two permanent copies.
			if (evicted) await this.removeOwned(evicted);
			if (!this.adapter.rename) throw new Error('Settings backup publication is unavailable');
			try { await this.adapter.rename(this.temporary, destination); } catch {
				if (await this.read(destination) !== source) throw new Error('Settings backup publication failed');
			}
			if (await this.read(destination) !== source) throw new Error('Settings backup publication was not verified');
			await this.removeVerifiedTemporary(source);
		}
		// An already published copy must not let an unfinished eviction escape retention.
		if (evicted) await this.removeOwned(evicted);
		await this.assertCanonical(source);
		return await this.save(journal, {
			...journal.value, backups: [...retained, pending.entry],
			processedVersion: pending.targetVersion, pending: null,
		});
	}

	private async assertInventory(journal: Journal): Promise<void> {
		if (!await this.adapter.exists(this.directory)) return;
		if (!this.adapter.list) throw new Error('Settings backup inventory is unavailable');
		const owned = new Set(journal.backups.map(entry => this.path(entry)));
		if (journal.pending) owned.add(this.path(journal.pending.entry));
		const inventory = await this.adapter.list(this.directory);
		for (const path of inventory.files) {
			const name = path.slice(this.directory.length + 1);
			if (namePattern.test(name) && !owned.has(path)) throw new Error('Unowned automatic backup requires inspection');
			if (path === this.temporary && !journal.pending) throw new Error('Unowned backup temporary file requires inspection');
		}
	}

	private async removeVerifiedTemporary(source: string): Promise<void> {
		const temporary = await this.read(this.temporary);
		if (temporary === null) return;
		if (temporary !== source) throw new Error('Settings backup temporary contents changed');
		await this.removeAndVerify(this.temporary);
	}

	private async removeOwned(entry: Entry): Promise<void> {
		const raw = await this.read(this.path(entry));
		if (raw === null) return; // Recovery after a completed removal with a lost acknowledgement.
		if (await sha256HexForStorage(raw) !== entry.digest) throw new Error('Owned settings backup changed; preserving it');
		await this.removeAndVerify(this.path(entry));
	}

	private async removeAndVerify(path: string): Promise<void> {
		try { await this.adapter.remove(path); } catch { /* Observe rather than replay. */ }
		if (await this.adapter.exists(path)) throw new Error('Settings backup cleanup failed');
	}

	private path(entry: Entry): string { return `${this.directory}/${entry.name}`; }
	private slot(index: number): string { return `${this.directory}/metadata-${index}.json`; }
	private async read(path: string): Promise<string | null> {
		return await this.adapter.exists(path) ? await this.adapter.read(path) : null;
	}
	private async assertCanonical(source: string | null): Promise<void> {
		if (await this.read(this.canonicalPath) !== source) throw new Error('Settings changed during version backup');
	}
	private async verifyEntries(entries: Entry[]): Promise<void> {
		for (const entry of entries) {
			const raw = await this.read(this.path(entry));
			if (raw === null || await sha256HexForStorage(raw) !== entry.digest) throw new Error('Retained settings backup is missing or changed');
		}
	}
	private async ensureDirectory(): Promise<void> {
		if (!this.adapter.mkdir) throw new Error('Settings backup directories are unavailable');
		const segments = this.directory.split('/');
		for (let length = 1; length <= segments.length; length++) {
			const path = segments.slice(0, length).join('/');
			if (!await this.adapter.exists(path)) await this.adapter.mkdir(path);
		}
	}
	private async writeVerified(path: string, raw: string): Promise<void> {
		try { await this.adapter.write(path, raw); } catch { /* A write may succeed before reporting failure. */ }
		if (await this.read(path) !== raw) throw new Error('Settings backup write was not verified');
	}
	private async assertJournal(journal: ObservedJournal): Promise<void> {
		for (let index = 0; index < 2; index++) {
			if (await this.read(this.slot(index)) !== journal.sources[index]) throw new Error('Settings backup journal changed');
		}
	}
	private async save(previous: ObservedJournal, value: Journal): Promise<ObservedJournal> {
		await this.assertJournal(previous);
		const next = { ...value, generation: previous.value.generation + 1 };
		const payload = JSON.stringify(next);
		const raw = JSON.stringify({ payload: next, sha256: await sha256HexForStorage(payload) });
		// Alternating durable metadata slots preserve the last verified intent during torn writes.
		// They never require another temporary data file.
		const slot = previous.slot === 0 ? 1 : 0;
		await this.writeVerified(this.slot(slot), raw);
		const sources = [...previous.sources];
		sources[slot] = raw;
		return { value: next, slot, sources };
	}
	private async load(): Promise<ObservedJournal> {
		const sources = [await this.read(this.slot(0)), await this.read(this.slot(1))];
		const valid: ObservedJournal[] = [];
		for (let slot = 0; slot < 2; slot++) {
			const raw = sources[slot];
			if (raw === null) continue;
			let envelope: unknown;
			try { envelope = JSON.parse(raw); } catch { continue; }
			if (!record(envelope) || !record(envelope.payload)
				|| envelope.sha256 !== await sha256HexForStorage(JSON.stringify(envelope.payload))) continue;
			// A verified but unsupported journal is not a torn slot. Never downgrade it.
			if (!isJournal(envelope.payload)) throw new Error('Unsupported settings backup journal');
			valid.push({ value: envelope.payload, slot, sources });
		}
		valid.sort((left, right) => right.value.generation - left.value.generation);
		if (valid.length === 2 && valid[0].value.generation === valid[1].value.generation
			&& sources[0] !== sources[1]) throw new Error('Ambiguous settings backup journal');
		if (valid[0]) return valid[0];
		if (sources.some(source => source !== null)) throw new Error('No valid settings backup journal');
		return {
			slot: -1, sources,
			value: { format: 'operon-settings-backups', version: 1, generation: 0, processedVersion: null, backups: [], pending: null },
		};
	}
}

function record(value: unknown): value is Record<string, unknown> {
	return !!value && typeof value === 'object' && !Array.isArray(value);
}
function isEntry(value: unknown): value is Entry {
	return record(value) && typeof value.name === 'string' && namePattern.test(value.name)
		&& typeof value.digest === 'string' && /^[0-9a-f]{64}$/u.test(value.digest);
}
function isJournal(value: unknown): value is Journal {
	if (!record(value) || value.format !== 'operon-settings-backups' || value.version !== 1
		|| !Number.isSafeInteger(value.generation) || (value.generation as number) < 1
		|| !(value.processedVersion === null || typeof value.processedVersion === 'string' && versionPattern.test(value.processedVersion))
		|| !Array.isArray(value.backups) || value.backups.length > 2 || !value.backups.every(isEntry)
		|| new Set(value.backups.map(entry => entry.name)).size !== value.backups.length) return false;
	if (value.pending === null) return true;
	return record(value.pending) && typeof value.pending.targetVersion === 'string'
		&& versionPattern.test(value.pending.targetVersion) && isEntry(value.pending.entry)
		&& value.pending.entry.name.includes(`-before-${value.pending.targetVersion}-`)
		&& !value.backups.some(entry => entry.name === (value.pending as { entry: Entry }).entry.name);
}
