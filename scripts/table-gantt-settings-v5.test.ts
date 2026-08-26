import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, readFile, rename, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
	createDefaultTableGanttSettings,
	createDefaultTablePreset,
	normalizeTableGanttSettings,
	normalizeTableGanttSplitPercent,
	resolveTableGanttVisibility,
} from '../src/types/table';
import { DEFAULT_SETTINGS, migrateSettings } from '../src/types/settings';
import { parseOperonTableFile, serializeOperonTableFile } from '../src/storage/table-file';
import {
	migrateOperonTableFilesToV5,
	TableFileV5MigrationError,
	type TableFileV5MigrationFile,
} from '../src/storage/table-file-v5-migration';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual: unknown, expected: unknown, message?: string): void { assert.deepEqual(actual, expected, message); assertions += 1; }
function ok(value: unknown, message?: string): asserts value { assert.ok(value, message); assertions += 1; }

function sourceAtVersion(version: 1 | 2 | 3 | 4 | 5): string {
	const value = JSON.parse(serializeOperonTableFile(createDefaultTablePreset())) as Record<string, unknown>;
	value.version = version;
	if (version < 5) delete value.gantt;
	if (version < 4) delete value.expandedTaskTreeIds;
	if (version < 2) delete value.collapsedGroupKeys;
	return `${JSON.stringify(value, null, 2)}\n`;
}

class MemoryAdapter {
	readonly files = new Map<string, string>();
	readonly folders = new Set<string>();
	readonly tableFiles: TableFileV5MigrationFile[];
	processCount = 0;
	failTableProcessAt: number | null = null;
	commitThenThrowAt: number | null = null;
	failBackupWrites = false;

	constructor(tableFiles: Record<string, string>) {
		this.tableFiles = Object.keys(tableFiles).sort().map(filePath => ({ path: filePath }));
		for (const [filePath, source] of Object.entries(tableFiles)) this.files.set(filePath, source);
	}

	async exists(filePath: string): Promise<boolean> { return this.files.has(filePath) || this.folders.has(filePath); }
	async read(filePath: string): Promise<string> {
		const source = this.files.get(filePath);
		if (source === undefined) throw new Error(`missing ${filePath}`);
		return source;
	}
	async write(filePath: string, source: string): Promise<void> {
		if (this.failBackupWrites && filePath.includes('/backups/')) throw new Error('backup failed');
		this.files.set(filePath, source);
	}
	async rename(from: string, to: string): Promise<void> {
		const source = await this.read(from);
		this.files.set(to, source);
		this.files.delete(from);
	}
	async remove(filePath: string): Promise<void> { this.files.delete(filePath); }
	async mkdir(folder: string): Promise<void> { this.folders.add(folder); }
	async process(filePath: string, transform: (source: string) => string): Promise<string> {
		const next = transform(await this.read(filePath));
		this.files.set(filePath, next);
		return next;
	}
	async processTable(file: TableFileV5MigrationFile, transform: (source: string) => string): Promise<void> {
		this.processCount += 1;
		if (this.failTableProcessAt === this.processCount) throw new Error('interrupted');
		this.files.set(file.path, transform(await this.read(file.path)));
		if (this.commitThenThrowAt === this.processCount) throw new Error('acknowledgement lost');
	}
}

function migrate(adapter: MemoryAdapter) {
	return migrateOperonTableFilesToV5({
		adapter,
		configDir: '.obsidian',
		listTableFiles: () => adapter.tableFiles,
		readTableFile: file => adapter.read(file.path),
		processTableFile: (file, transform) => adapter.processTable(file, transform),
	});
}

class DiskAdapter {
	constructor(private readonly root: string) {}
	private resolve(filePath: string): string { return path.join(this.root, filePath); }
	async exists(filePath: string): Promise<boolean> { try { await access(this.resolve(filePath)); return true; } catch { return false; } }
	async read(filePath: string): Promise<string> { return await readFile(this.resolve(filePath), 'utf8'); }
	async write(filePath: string, source: string): Promise<void> { await this.mkdir(path.dirname(filePath)); await writeFile(this.resolve(filePath), source, 'utf8'); }
	async rename(from: string, to: string): Promise<void> { await this.mkdir(path.dirname(to)); await rename(this.resolve(from), this.resolve(to)); }
	async remove(filePath: string): Promise<void> { await unlink(this.resolve(filePath)); }
	async mkdir(folder: string): Promise<void> { await mkdir(this.resolve(folder), { recursive: true }); }
	async process(filePath: string, transform: (source: string) => string): Promise<string> { const next = transform(await this.read(filePath)); await writeFile(this.resolve(filePath), next, 'utf8'); return next; }
}

async function run(): Promise<void> {
	deepEqual(createDefaultTableGanttSettings(), {
		enabled: false, splitPercent: 70, scale: 'week', unitWidthMultiplier: 1, barColorMode: 'noColor',
		todayVisibility: 'inherit', weekendVisibility: 'inherit',
	});
	equal(normalizeTableGanttSplitPercent(19.999), 20);
	equal(normalizeTableGanttSplitPercent(80.004), 80);
	equal(normalizeTableGanttSplitPercent(63.456), 63.46);
	equal(resolveTableGanttVisibility('inherit', false), false);
	equal(resolveTableGanttVisibility('show', false), true);
	equal(resolveTableGanttVisibility('hide', true), false);
	deepEqual(normalizeTableGanttSettings({ enabled: true, splitPercent: 64.129, scale: 'month', unitWidthMultiplier: 1.5, barColorMode: 'priorityColor', todayVisibility: 'hide', weekendVisibility: 'show' }), {
		enabled: true, splitPercent: 64.13, scale: 'month', unitWidthMultiplier: 1.5, barColorMode: 'priorityColor', todayVisibility: 'hide', weekendVisibility: 'show',
	});

	const settings = migrateSettings({
		tableGanttDefaultSplitPercent: 60,
		tableGanttDefaultScale: 'month',
		tableGanttDefaultUnitWidthMultiplier: 1.25,
		tableGanttDefaultBarColorMode: 'statusColor',
		tableGanttShowToday: false,
		tableGanttShowWeekends: false,
		tableGanttShowDateStartedMarkers: false,
		tableGanttShowDateScheduledMarkers: false,
		tableGanttShowDateDueMarkers: false,
		tableGanttFocusTodayOnOpen: false,
		tableGanttBarClickAction: 'goToSource',
		tableGanttBarRightClickAction: 'openTaskEditor',
		tableGanttOneDayClickBehavior: 'dateRange',
	});
	equal(settings.tableGanttDefaultSplitPercent, 60);
	equal(migrateSettings({ tableGanttDefaultSplitPercent: 62.35 }).tableGanttDefaultSplitPercent, 70);
	equal(settings.tableGanttDefaultScale, 'month');
	equal(settings.tableGanttDefaultUnitWidthMultiplier, 1.25);
	equal(settings.tableGanttDefaultBarColorMode, 'statusColor');
	equal(settings.tableGanttShowToday, false);
	equal(settings.tableGanttShowWeekends, false);
	equal(settings.tableGanttShowDateStartedMarkers, false);
	equal(settings.tableGanttShowDateScheduledMarkers, false);
	equal(settings.tableGanttShowDateDueMarkers, false);
	equal(DEFAULT_SETTINGS.tableGanttShowDateStartedMarkers, true);
	equal(DEFAULT_SETTINGS.tableGanttShowDateScheduledMarkers, true);
	equal(DEFAULT_SETTINGS.tableGanttShowDateDueMarkers, true);
	equal(settings.tableGanttFocusTodayOnOpen, false);
	equal(settings.tableGanttBarClickAction, 'goToSource');
	equal(DEFAULT_SETTINGS.tableGanttBarClickAction, 'openTaskEditor');
	equal(migrateSettings({ tableGanttBarClickAction: 'invalid' }).tableGanttBarClickAction, 'openTaskEditor');
	equal(migrateSettings({ tableGanttBarClickAction: 'contextMenu' }).tableGanttBarClickAction, 'contextMenu');
	equal(settings.tableGanttBarRightClickAction, 'openTaskEditor');
	equal(DEFAULT_SETTINGS.tableGanttBarRightClickAction, 'contextMenu');
	equal(migrateSettings({ tableGanttBarRightClickAction: 'invalid' }).tableGanttBarRightClickAction, 'contextMenu');
	equal(settings.tableGanttOneDayClickBehavior, 'dateRange');
	equal(DEFAULT_SETTINGS.tableGanttOneDayClickBehavior, 'scheduled');

	for (const version of [1, 2, 3, 4, 5] as const) {
		const parsed = parseOperonTableFile(sourceAtVersion(version));
		equal(parsed.status, 'valid', `V${version} must parse.`);
		if (parsed.status === 'valid') equal(parsed.preset.gantt.scale, 'week');
	}
	const missingGantt = JSON.parse(sourceAtVersion(5)) as Record<string, unknown>;
	delete missingGantt.gantt;
	equal(parseOperonTableFile(JSON.stringify(missingGantt)).status, 'invalid');
	const unknownGantt = JSON.parse(sourceAtVersion(5)) as { gantt: Record<string, unknown> };
	unknownGantt.gantt.future = true;
	equal(parseOperonTableFile(JSON.stringify(unknownGantt)).status, 'invalid');
	for (const splitPercent of [20.01, 64.13, 79.99]) {
		const validDecimalGantt = JSON.parse(sourceAtVersion(5)) as { gantt: Record<string, unknown> };
		validDecimalGantt.gantt.splitPercent = splitPercent;
		equal(parseOperonTableFile(JSON.stringify(validDecimalGantt)).status, 'valid');
	}
	const excessiveDecimalGantt = JSON.parse(sourceAtVersion(5)) as { gantt: Record<string, unknown> };
	excessiveDecimalGantt.gantt.splitPercent = 64.129;
	equal(parseOperonTableFile(JSON.stringify(excessiveDecimalGantt)).status, 'invalid');
	const future = JSON.parse(sourceAtVersion(5)) as Record<string, unknown>;
	future.version = 6;
	equal(parseOperonTableFile(JSON.stringify(future)).status, 'invalid');

	const adapter = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4), 'Tables/B.table': sourceAtVersion(4) });
	const first = await migrate(adapter);
	equal(first.status, 'migrated');
	equal(parseOperonTableFile(await adapter.read('Tables/A.table')).status, 'valid');
	equal((JSON.parse(await adapter.read('Tables/A.table')) as { version: number }).version, 5);
	const writesAfterFirst = adapter.processCount;
	equal((await migrate(adapter)).status, 'not-needed');
	equal(adapter.processCount, writesAfterFirst);

	const backupFailure = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4) });
	backupFailure.failBackupWrites = true;
	await assert.rejects(() => migrate(backupFailure), TableFileV5MigrationError);
	assertions += 1;
	equal((JSON.parse(await backupFailure.read('Tables/A.table')) as { version: number }).version, 4);

	const interrupted = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4), 'Tables/B.table': sourceAtVersion(4) });
	interrupted.failTableProcessAt = 2;
	await assert.rejects(() => migrate(interrupted));
	assertions += 1;
	interrupted.failTableProcessAt = null;
	equal((await migrate(interrupted)).status, 'resumed');
	equal((JSON.parse(await interrupted.read('Tables/B.table')) as { version: number }).version, 5);

	const acknowledgementLost = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4) });
	acknowledgementLost.commitThenThrowAt = 1;
	await assert.rejects(() => migrate(acknowledgementLost));
	assertions += 1;
	acknowledgementLost.commitThenThrowAt = null;
	equal((await migrate(acknowledgementLost)).status, 'resumed');
	equal((JSON.parse(await acknowledgementLost.read('Tables/A.table')) as { version: number }).version, 5);

	const divergent = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4), 'Tables/B.table': sourceAtVersion(4) });
	divergent.failTableProcessAt = 2;
	await assert.rejects(() => migrate(divergent));
	assertions += 1;
	divergent.failTableProcessAt = null;
	divergent.files.set('Tables/B.table', '{"thirdParty":true}\n');
	await assert.rejects(() => migrate(divergent), (error: unknown) => error instanceof TableFileV5MigrationError && error.code === 'target-divergent');
	assertions += 1;

	const corruptMarker = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(4) });
	corruptMarker.files.set('.obsidian/plugins/operon/state/table-file-v5-migration/active.json', '{"corrupt":true}\n');
	await assert.rejects(() => migrate(corruptMarker), (error: unknown) => error instanceof TableFileV5MigrationError && error.code === 'marker-invalid');
	assertions += 1;
	equal((JSON.parse(await corruptMarker.read('Tables/A.table')) as { version: number }).version, 4);

	const finalizedTombstone = new MemoryAdapter({ 'Tables/A.table': sourceAtVersion(5) });
	finalizedTombstone.files.set('.obsidian/plugins/operon/state/table-file-v5-migration/active.json', '');
	equal((await migrate(finalizedTombstone)).status, 'not-needed');

	const tempRoot = await mkdtemp(path.join(tmpdir(), 'operon-table-v5-sanitized-vault-'));
	try {
		const disk = new DiskAdapter(tempRoot);
		const tablePath = 'Tables/Startup.table';
		await disk.write(tablePath, sourceAtVersion(4));
		const diskFile = { path: tablePath };
		const diskResult = await migrateOperonTableFilesToV5({
			adapter: disk,
			configDir: '.obsidian',
			listTableFiles: () => [diskFile],
			readTableFile: file => disk.read(file.path),
			processTableFile: (file, transform) => disk.process(file.path, transform),
		});
		equal(diskResult.status, 'migrated');
		equal((JSON.parse(await disk.read(tablePath)) as { version: number }).version, 5);
		equal((await migrateOperonTableFilesToV5({
			adapter: disk,
			configDir: '.obsidian',
			listTableFiles: () => [diskFile],
			readTableFile: file => disk.read(file.path),
			processTableFile: (file, transform) => disk.process(file.path, transform),
		})).status, 'not-needed');
	} finally {
		await rm(tempRoot, { recursive: true, force: true });
	}

	const workspaceSource = await readFile(path.join(process.cwd(), 'src/ui/table/operon-table-view.ts'), 'utf8');
	const embedSource = await readFile(path.join(process.cwd(), 'src/ui/embed-table-processor.ts'), 'utf8');
	ok(workspaceSource.includes("savePresetPatch({ id: ganttPreset.id, gantt }"));
	ok(embedSource.includes("saveEmbedTablePresetPatch(deps, { id: ganttPreset.id, gantt }"));
	ok(workspaceSource.includes('onCommit: percent =>'));
	ok(embedSource.includes('onCommit: percent =>'));

	console.log(`Table Gantt settings and V5 migration tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttSettingsV5TestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttSettingsV5TestRun = run();
