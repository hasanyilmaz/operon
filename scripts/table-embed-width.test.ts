import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
	exportOperonSettingsBackupJsonV1,
} from '../src/core/settings-backup-export';
import { validateOperonSettingsBackupGroupsV1 } from '../src/core/settings-backup-group-validation';
import {
	buildOperonDataPackageFromSettings,
	composeOperonSettingsFromDataPackage,
} from '../src/storage/operon-data-package';
import {
	DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT,
	TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS,
	normalizeTableEmbedDefaultWidthPercent,
} from '../src/types/table';
import { DEFAULT_SETTINGS, migrateSettings, type OperonSettings } from '../src/types/settings';
import {
	parseTableEmbedReference,
	resolveTableEmbedWidthPercent,
	shouldRebindTableEmbedWidth,
} from '../src/ui/embed-table-processor';
import {
	parseEmbedWidthPercent,
	resolveEmbedPercentWidthGeometry,
} from '../src/ui/embed-percent-width';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void {
	assert.equal(actual, expected, message);
	assertions += 1;
}
function deepEqual(actual: unknown, expected: unknown, message?: string): void {
	assert.deepEqual(actual, expected, message);
	assertions += 1;
}
function ok(value: unknown, message?: string): asserts value {
	assert.ok(value, message);
	assertions += 1;
}

function clone<T>(value: T): T {
	return JSON.parse(JSON.stringify(value)) as T;
}

function settingsWith(overrides: Record<string, unknown> = {}): OperonSettings {
	return migrateSettings({ ...clone(DEFAULT_SETTINGS), ...overrides });
}

async function run(): Promise<void> {
	deepEqual(TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS, [50, 75, 100, 125, 150, 175, 200, 225, 250]);
	equal(DEFAULT_TABLE_EMBED_DEFAULT_WIDTH_PERCENT, 175);
	for (const width of TABLE_EMBED_DEFAULT_WIDTH_PERCENT_OPTIONS) {
		equal(normalizeTableEmbedDefaultWidthPercent(width), width);
		equal(normalizeTableEmbedDefaultWidthPercent(String(width)), width);
	}
	for (const invalid of [undefined, null, '', '49', '176', 49, 176, 300, Number.NaN]) {
		equal(normalizeTableEmbedDefaultWidthPercent(invalid), 175, `fallback for ${String(invalid)}`);
	}

	const settings = settingsWith({ tableEmbedDefaultWidthPercent: 225 });
	const dataPackage = buildOperonDataPackageFromSettings(settings);
	equal(dataPackage.views.tablePresets.tableEmbedDefaultWidthPercent, 225);
	equal(composeOperonSettingsFromDataPackage(dataPackage, DEFAULT_SETTINGS).tableEmbedDefaultWidthPercent, 225);
	const legacyPackage = clone(dataPackage);
	delete legacyPackage.views.tablePresets.tableEmbedDefaultWidthPercent;
	equal(
		composeOperonSettingsFromDataPackage(legacyPackage, DEFAULT_SETTINGS).tableEmbedDefaultWidthPercent,
		175,
		'legacy Table manifest falls back to the new default',
	);

	const backup = exportOperonSettingsBackupJsonV1({
		settings,
		source: { pluginVersion: '3.3.2', obsidianVersion: '1.13.0', dataPackageSchemaVersion: 2 },
		createdAt: '2026-08-17T00:00:00.000Z',
	});
	if (!backup.ok) throw new Error(backup.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
	const tableGlobalBackup = backup.backup.body.groups['table-global'];
	ok(tableGlobalBackup);
	equal((tableGlobalBackup.data as { tableEmbedDefaultWidthPercent?: number }).tableEmbedDefaultWidthPercent, 225);
	const legacyBackupGroups = {
		'table-global': {
			codecVersion: 1,
			data: {
				tableEmbedVisibleRows: 20,
				tableShowLineNumbers: true,
				tableShowTaskIcon: false,
				tableShowTaskTypeIcon: false,
			},
		},
	};
	const decodedLegacyBackup = validateOperonSettingsBackupGroupsV1(legacyBackupGroups, {
		targetSettings: settingsWith({ tableEmbedDefaultWidthPercent: 250 }),
	});
	ok(decodedLegacyBackup.ok, decodedLegacyBackup.diagnostics.map(diagnostic => diagnostic.message).join('\n'));
	equal(decodedLegacyBackup.payloads['table-global']?.tableEmbedDefaultWidthPercent, undefined, 'old backups preserve the target preference');

	deepEqual(parseTableEmbedReference('presetId: "table-default"'), {
		presetId: 'table-default', rows: null, widthPercent: null,
	});
	deepEqual(parseTableEmbedReference('presetId: "table-narrow"\nwidth: 50%'), {
		presetId: 'table-narrow', rows: null, widthPercent: 50,
	});
	deepEqual(parseTableEmbedReference('presetId: "table-last-width"\nwidth: 50%\nwidth: 200%'), {
		presetId: 'table-last-width', rows: null, widthPercent: 200,
	});
	deepEqual(parseTableEmbedReference('presetId: "table-invalid"\nwidth: 49%'), {
		presetId: 'table-invalid', rows: null, widthPercent: null,
	});
	equal(parseEmbedWidthPercent('50%', 50), 50);
	equal(parseEmbedWidthPercent('75%', 50), 75);
	equal(parseEmbedWidthPercent('200%', 50), 200);
	equal(parseEmbedWidthPercent('50%'), null, 'Filter embeds keep their 100% minimum');
	equal(parseEmbedWidthPercent('75%'), null, 'Filter embeds keep their 100% minimum');

	const defaultWidthSettings = settingsWith({ tableEmbedDefaultWidthPercent: 175 });
	equal(resolveTableEmbedWidthPercent(null, defaultWidthSettings), 175);
	equal(resolveTableEmbedWidthPercent(100, defaultWidthSettings), 100);
	equal(resolveTableEmbedWidthPercent(200, defaultWidthSettings), 200);
	equal(resolveTableEmbedWidthPercent(50, defaultWidthSettings), 50);
	equal(resolveTableEmbedWidthPercent(null, settingsWith({ tableEmbedDefaultWidthPercent: 176 })), 175, 'invalid stored settings fall back');

	const centeredInput = { lineLeftPx: 500, lineWidthPx: 800, paneLeftPx: 0, paneRightPx: 1800 };
	deepEqual(resolveEmbedPercentWidthGeometry({ ...centeredInput, widthPercent: 50 }), { widthPx: 400, offsetXPx: 200 });
	deepEqual(resolveEmbedPercentWidthGeometry({ ...centeredInput, widthPercent: 75 }), { widthPx: 600, offsetXPx: 100 });
	deepEqual(resolveEmbedPercentWidthGeometry({ ...centeredInput, widthPercent: 200 }), { widthPx: 1600, offsetXPx: -400 });
	deepEqual(resolveEmbedPercentWidthGeometry({
		lineLeftPx: 500, lineWidthPx: 800, paneLeftPx: 100, paneRightPx: 1400, widthPercent: 250,
	}), { widthPx: 1000, offsetXPx: -100 }, 'wide values retain the pane clamp');
	equal(resolveEmbedPercentWidthGeometry({ ...centeredInput, widthPercent: 49 }), null);

	equal(shouldRebindTableEmbedWidth(false, null, 175), true, 'first global binding attaches');
	equal(shouldRebindTableEmbedWidth(true, 175, 175), false, 'unchanged effective width avoids rebinding');
	equal(shouldRebindTableEmbedWidth(true, 175, 50), true, 'global width changes rebind active embeds');
	equal(shouldRebindTableEmbedWidth(true, 200, resolveTableEmbedWidthPercent(200, settingsWith({ tableEmbedDefaultWidthPercent: 50 }))), false, 'explicit widths stay bound when the global setting changes');

	const [settingsTabSource, embedProcessorSource] = await Promise.all([
		readFile(path.join(process.cwd(), 'src/ui/settings-tab.ts'), 'utf8'),
		readFile(path.join(process.cwd(), 'src/ui/embed-table-processor.ts'), 'utf8'),
	]);
	ok(settingsTabSource.includes("'tableEmbedDefaultWidthPercent'"));
	ok(settingsTabSource.includes("t('settings', 'tableEmbedDefaultWidthPercent')"));
	ok(embedProcessorSource.includes('syncEmbedTableWidthBinding(instance, settings, deps);'));
	ok(embedProcessorSource.includes('instance.widthCleanup?.();'));
	ok(embedProcessorSource.includes('bindEmbedPercentWidth(instance.el, nextWidthPercent'));

	console.log(`Table embed width tests passed: ${assertions} assertions`);
}

(globalThis as typeof globalThis & { __operonTableEmbedWidthTestRun?: Promise<void> }).__operonTableEmbedWidthTestRun = run();
