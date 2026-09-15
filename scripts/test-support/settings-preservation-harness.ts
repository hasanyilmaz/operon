import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
	existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
	rmSync, statSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { App } from 'obsidian';
import { OperonStorage } from '../../src/storage/operon-storage';
import type { OperonDataPackageV1 } from '../../src/storage/operon-data-package';

export type SourceVersion = '3.8.0' | '3.9.0';
export type ReadFault = 'none' | 'null' | 'undefined' | 'throw' | 'array' | 'scalar' | 'unreadable';
export type WriteFault = 'none' | 'throw-before' | 'silent-before' | 'partial-throw' | 'partial-success' | 'commit-throw';
type Operation = { kind: 'mkdir' | 'write' | 'remove' | 'rename'; path: string; target?: string };

export function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

export function sha256(source: string | Buffer): string {
	return createHash('sha256').update(source).digest('hex');
}

export function readSealedFixture(name: string): string {
	const directory = path.resolve('scripts/fixtures/settings-preservation');
	const manifest = JSON.parse(readFileSync(path.join(directory, 'manifest.json'), 'utf8')) as {
		files: Record<string, { sha256: string; bytes: number }>;
	};
	const expected = manifest.files[name];
	assert.ok(expected, `Unsealed fixture: ${name}`);
	const bytes = readFileSync(path.join(directory, name));
	assert.equal(bytes.byteLength, expected.bytes, `Fixture length changed: ${name}`);
	assert.equal(sha256(bytes), expected.sha256, `Fixture contents changed: ${name}`);
	return bytes.toString('utf8');
}

export function assertBytesEqual(actual: string | null, expected: string | null, message = 'Canonical bytes changed'): void {
	assert.equal(actual === expected, true, message);
}

export function sourcePackage(version: SourceVersion = '3.8.0'): OperonDataPackageV1 {
	return JSON.parse(readSealedFixture(`data-${version}.json`)) as OperonDataPackageV1;
}

/** Compare saved user choices, not the two new optional 3.9 fields or release-notes bookkeeping. */
export function assertPersonalSettingsPreserved(actual: OperonDataPackageV1, expected: OperonDataPackageV1): void {
	const slices = (value: OperonDataPackageV1): Record<string, unknown> => ({
		schemaVersion: value.schemaVersion,
		settings: withoutNewFields(value.settings, ['releaseNotesLastShownVersion']),
		taxonomy: value.taxonomy,
		views: value.views,
		ui: {
			...value.ui,
			taskCreationProfile: withoutNewFields(value.ui.taskCreationProfile, ['inheritPropertiesOnParentLink']),
			taskUiPreferences: withoutNewFields(value.ui.taskUiPreferences, ['assigneeImageProperty']),
		},
		automation: value.automation,
		integrations: value.integrations,
		state: value.state,
	});
	const expectedSlices = slices(expected);
	for (const [key, value] of Object.entries(slices(actual))) {
		assert.equal(sha256(JSON.stringify(value)), sha256(JSON.stringify(expectedSlices[key])), `User settings changed: ${key}`);
	}
	for (const key of ['assigneeImageProperty', 'inheritPropertiesOnParentLink'] as const) {
		const domain = key === 'assigneeImageProperty' ? 'taskUiPreferences' : 'taskCreationProfile';
		const source = expected.ui[domain] as unknown as Record<string, unknown>;
		if (Object.prototype.hasOwnProperty.call(source, key)) {
			assert.equal((actual.ui[domain] as unknown as Record<string, unknown>)[key], source[key], `User setting changed: ${key}`);
		}
	}
}

function withoutNewFields(value: unknown, keys: string[]): unknown {
	const copy = clone(value) as Record<string, unknown>;
	for (const key of keys) delete copy[key];
	return copy;
}

/** A real disposable filesystem, with a sealed preimage outside the simulated vault. */
export class SettingsPreservationHarness {
	readonly root = mkdtempSync(path.join(tmpdir(), 'operon-settings-preservation-'));
	readonly vaultRoot = path.join(this.root, 'vault');
	readonly canonicalPath: string;
	readonly source: OperonDataPackageV1;
	readonly initialRaw: string | null;
	readonly operations: Operation[] = [];
	readonly storages: OperonStorage[] = [];
	readonly sentinels = new Map<string, string>();
	readFault: ReadFault = 'none';
	writeFault: WriteFault = 'none';
	canonicalAttempts = 0;
	canonicalCommits = 0;
	pluginReads = 0;
	private allowVersionBackups = false;
	private processQueue: Promise<unknown> = Promise.resolve();

	constructor(options: { version?: SourceVersion; initialRaw?: string | null; configDir?: string; table?: boolean } = {}) {
		this.configDir = options.configDir ?? '.obsidian';
		this.canonicalPath = `${this.configDir}/plugins/operon/data.json`;
		this.source = sourcePackage(options.version);
		this.initialRaw = options.initialRaw === undefined ? readSealedFixture(`data-${options.version ?? '3.8.0'}.json`) : options.initialRaw;
		mkdirSync(this.vaultRoot);
		if (this.initialRaw !== null) {
			writeFileSync(path.join(this.root, 'sealed-preimage.json'), this.initialRaw);
			this.seed(this.canonicalPath, this.initialRaw);
		}
		this.addSentinel('Notes/Do not change.md', '---\nType: Reference\n---\nUntouched synthetic note.\n');
		this.addSentinel(`${this.configDir}/plugins/unrelated/data.json`, '{"keep":"unrelated"}\n');
		if (this.initialRaw !== null) this.addSentinel(`${this.configDir}/plugins/operon/backups/manual.json`, '{"keep":"manual"}\n');
		if (options.table !== false) this.addSentinel('Tables/Personal.table', readSealedFixture('Personal.table'));
	}

	readonly configDir: string;

	resolve(relative: string): string {
		const absolute = path.resolve(this.vaultRoot, relative);
		const within = path.relative(this.vaultRoot, absolute);
		assert.ok(within && within !== '..' && !within.startsWith(`..${path.sep}`) && !path.isAbsolute(within), 'Fixture path escaped its disposable vault');
		return absolute;
	}

	seed(relative: string, contents: string): void {
		const absolute = this.resolve(relative);
		mkdirSync(path.dirname(absolute), { recursive: true });
		writeFileSync(absolute, contents);
	}

	addSentinel(relative: string, contents: string): void {
		this.seed(relative, contents);
		this.sentinels.set(relative, contents);
	}

	raw(): string | null {
		return existsSync(this.resolve(this.canonicalPath)) ? readFileSync(this.resolve(this.canonicalPath), 'utf8') : null;
	}

	package(): OperonDataPackageV1 {
		const raw = this.raw();
		assert.notEqual(raw, null, 'Canonical data.json is missing');
		return JSON.parse(raw!) as OperonDataPackageV1;
	}

	readonly adapter = {
		list: async (relative: string): Promise<{ files: string[]; folders: string[] }> => {
			const entries = readdirSync(this.resolve(relative));
			return {
				files: entries.filter(name => !statSync(this.resolve(`${relative}/${name}`)).isDirectory()).map(name => `${relative}/${name}`),
				folders: entries.filter(name => statSync(this.resolve(`${relative}/${name}`)).isDirectory()).map(name => `${relative}/${name}`),
			};
		},
		exists: async (relative: string): Promise<boolean> => {
			if (relative === this.canonicalPath && this.readFault === 'unreadable') throw new Error('Injected canonical stat failure');
			return existsSync(this.resolve(relative));
		},
		read: async (relative: string): Promise<string> => {
			if (relative === this.canonicalPath && this.readFault === 'unreadable') throw new Error('Injected canonical read failure');
			return readFileSync(this.resolve(relative), 'utf8');
		},
		mkdir: async (relative: string): Promise<void> => {
			this.operations.push({ kind: 'mkdir', path: relative });
			mkdirSync(this.resolve(relative), { recursive: true });
		},
		write: async (relative: string, contents: string): Promise<void> => this.write(relative, contents),
		writeExclusive: async (relative: string, contents: string): Promise<void> => {
			assert.equal(existsSync(this.resolve(relative)), false, 'Exclusive fixture creation found an existing file');
			await this.write(relative, contents);
		},
		remove: async (relative: string): Promise<void> => {
			this.operations.push({ kind: 'remove', path: relative });
			rmSync(this.resolve(relative));
		},
		rename: async (from: string, to: string): Promise<void> => {
			this.operations.push({ kind: 'rename', path: from, target: to });
			assert.equal(existsSync(this.resolve(to)), false, 'Obsidian rename rejects an existing destination');
			await this.write(to, readFileSync(this.resolve(from), 'utf8'));
			rmSync(this.resolve(from));
		},
		process: (relative: string, callback: (contents: string) => string): Promise<string> => {
			const operation = this.processQueue.then(async () => {
				const previous = await this.adapter.read(relative);
				const next = callback(previous);
				if (next !== previous) await this.write(relative, next);
				return next;
			});
			this.processQueue = operation.catch(() => undefined);
			return operation;
		},
	};

	private async write(relative: string, contents: string): Promise<void> {
		this.operations.push({ kind: 'write', path: relative });
		if (relative !== this.canonicalPath) {
			this.seed(relative, contents);
			return;
		}
		this.canonicalAttempts++;
		const fault = this.writeFault;
		this.writeFault = 'none';
		if (fault === 'throw-before') throw new Error('Injected write rejected before apply');
		if (fault === 'silent-before') return; // Model a host wrapper swallowing the adapter failure.
		this.seed(relative, fault.startsWith('partial-') ? '{"interrupted":' : contents);
		this.canonicalCommits++;
		if (fault === 'partial-throw' || fault === 'commit-throw') throw new Error('Injected acknowledgement failure after apply');
	}

	readonly pluginData = {
		loadData: async (): Promise<unknown> => {
			this.pluginReads++;
			switch (this.readFault) {
				case 'null': return null;
				case 'undefined': case 'unreadable': return undefined;
				case 'throw': throw new Error('Injected loadData rejection');
				case 'array': return [];
				case 'scalar': return 17;
				case 'none': {
					const raw = this.raw();
					if (raw === null) return null;
					try { return JSON.parse(raw) as unknown; } catch { return undefined; }
				}
			}
		},
		saveData: async (value: unknown): Promise<void> => this.write(this.canonicalPath, JSON.stringify(value, null, '\t')),
	};

	createStorage(onSettingsWriteBlocked?: () => void, pluginVersion?: string): OperonStorage {
		if (pluginVersion) this.allowVersionBackups = true;
		const tableExists = existsSync(this.resolve('Tables/Personal.table'));
		const app = {
			locale: 'en',
			vault: {
				configDir: this.configDir,
				adapter: this.adapter,
				getFiles: () => tableExists ? [{ path: 'Tables/Personal.table', stat: { mtime: 1 } }] : [],
				read: async (file: { path: string }) => this.adapter.read(file.path),
			},
		} as unknown as App;
		const storage = new OperonStorage(app, { ...this.pluginData, onSettingsWriteBlocked, pluginVersion });
		this.storages.push(storage);
		return storage;
	}

	assertIsolation(): void {
		for (const [relative, contents] of this.sentinels) {
			assert.equal(readFileSync(this.resolve(relative), 'utf8'), contents, `Unrelated file changed: ${relative}`);
		}
		if (this.initialRaw !== null) {
			assert.equal(readFileSync(path.join(this.root, 'sealed-preimage.json'), 'utf8'), this.initialRaw, 'Sealed preimage changed');
		}
		const allowedFile = (relative: string): boolean => this.allowVersionBackups && relative.startsWith(`${this.configDir}/plugins/operon/backups/settings/`)
			|| relative === this.canonicalPath
			|| relative.startsWith(`${this.canonicalPath}.tmp-`)
			|| relative.startsWith(`${this.canonicalPath}.replace-backup.tmp-`)
			|| new RegExp(`^${this.canonicalPath.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}\\.invalid-\\d+\\.bak(?:\\.tmp-[\\w-]+)?$`, 'u').test(relative);
		for (const operation of this.operations) {
			if (operation.kind === 'mkdir') {
				assert.ok([`${this.configDir}/plugins/operon`, ...(this.allowVersionBackups ? ['backups', 'backups/settings'] : []).map(name => `${this.configDir}/plugins/operon/${name}`), ...['state', 'runtime', 'cache'].map(name => `${this.configDir}/plugins/operon/${name}`)].includes(operation.path), `Unexpected directory creation: ${operation.path}`);
			} else {
				assert.ok(allowedFile(operation.path), `Write outside the allowed set: ${operation.path}`);
				if (operation.target) assert.ok(allowedFile(operation.target), `Rename outside the allowed set: ${operation.target}`);
			}
		}
		const visit = (directory: string): void => {
			for (const entry of readdirSync(directory)) {
				const absolute = path.join(directory, entry);
				if (statSync(absolute).isDirectory()) visit(absolute);
				else {
					const relative = path.relative(this.vaultRoot, absolute).split(path.sep).join('/');
					assert.ok(this.sentinels.has(relative) || allowedFile(relative), `Unexpected file left in vault: ${relative}`);
				}
			}
		};
		visit(this.vaultRoot);
	}

	async dispose(): Promise<void> {
		try {
			for (const storage of this.storages) {
				await storage.flushPendingWrites();
				storage.destroy();
			}
			this.assertIsolation();
		} finally {
			rmSync(this.root, { recursive: true, force: true });
		}
	}
}

export async function withSettingsFixture(
	options: ConstructorParameters<typeof SettingsPreservationHarness>[0],
	run: (fixture: SettingsPreservationHarness) => Promise<void>,
): Promise<void> {
	const fixture = new SettingsPreservationHarness(options);
	try { await run(fixture); } finally { await fixture.dispose(); }
}
