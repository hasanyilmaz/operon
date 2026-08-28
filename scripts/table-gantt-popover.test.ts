import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { createDefaultTableGanttSettings } from '../src/types/table';
import {
	buildTableGanttSettingsCommit,
	createTableGanttSettingsDraft,
} from '../src/ui/table/table-gantt-settings-popover';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void { assert.equal(actual, expected, message); assertions += 1; }
function deepEqual(actual: unknown, expected: unknown, message?: string): void { assert.deepEqual(actual, expected, message); assertions += 1; }
function match(actual: string, expected: RegExp, message?: string): void { assert.match(actual, expected, message); assertions += 1; }
function doesNotMatch(actual: string, expected: RegExp, message?: string): void { assert.doesNotMatch(actual, expected, message); assertions += 1; }

async function source(filePath: string): Promise<string> {
	return readFile(path.join(process.cwd(), filePath), 'utf8');
}

async function run(): Promise<void> {
	const original = createDefaultTableGanttSettings();
	const draft = createTableGanttSettingsDraft(original);
	draft.scale = 'week';
	draft.splitPercent = 42.34;
	draft.enabled = false;
	equal(original.scale, 'day', 'draft changes must not mutate the source preset');
	equal(original.splitPercent, 70, 'draft split changes must remain local before Save');
	deepEqual(buildTableGanttSettingsCommit({ ...original, enabled: true }, draft), {
		...draft,
		enabled: true,
	}, 'popover commits must preserve the latest preset enabled state');

	const formSource = await source('src/ui/table/table-gantt-settings-form.ts');
	for (const field of [
		'ganttEnabled',
		'ganttSplitPercent',
		'ganttScale',
		'ganttUnitWidth',
		'ganttBarColor',
		'ganttWeekendVisibility',
	]) match(formSource, new RegExp(field), `shared Gantt form must render ${field}`);
	doesNotMatch(formSource, /ganttTodayVisibility|todayVisibility/, 'Today visibility must not remain configurable');
	match(formSource, /if \(options\.includeEnabled\)/, 'the enabled row must be the only optional shared field');

	const modalSource = await source('src/ui/table/table-preset-quick-settings-modal.ts');
	match(modalSource, /renderTableGanttSettingsForm\(\{[\s\S]*?includeEnabled: true,[\s\S]*?onChange: \(\) => this\.markDirty\('gantt'\)/);
	match(modalSource, /getGanttGlobalDefaults[\s\S]*?barColorMode: 'noColor'/, 'new presets must keep the dedicated Gantt no-color default');
	doesNotMatch(modalSource, /barColorMode: settings\.tableGanttDefaultBarColorMode/, 'new preset Gantt colors must not inherit a global color source');
	const popoverSource = await source('src/ui/table/table-gantt-settings-popover.ts');
	match(popoverSource, /renderTableGanttSettingsForm\(\{[\s\S]*?includeEnabled: false/);
	match(popoverSource, /text: t\('buttons', 'cancel'\)/);
	match(popoverSource, /text: t\('buttons', 'save'\)/);
	doesNotMatch(popoverSource, /operon-table-gantt-settings-popover-button mod-cta/);
	match(popoverSource, /outsideClickExclusions: \(\) =>/);
	match(popoverSource, /if \(reason === 'escape'\) restoreFocusOnClose = true/);
	match(popoverSource, /return \{ close: closePopover, id: panel\.id \}/);

	for (const filePath of ['src/ui/table/operon-table-view.ts', 'src/ui/embed-table-processor.ts']) {
		const tableSource = await source(filePath);
		match(tableSource, /Platform\.isPhone \|\| !preset\.gantt\.enabled/);
		match(tableSource, /aria-haspopup': 'dialog'/);
		match(tableSource, /aria-expanded': String\(popoverActive\)/);
		match(tableSource, /setAttribute\('aria-controls', .*ganttSettingsPopoverId\)/);
		match(tableSource, /shouldOpen: \(\) => !popoverOpen && .*ganttSettingsPopoverPresetId !== preset\.id/);
		match(tableSource, /buildTableGanttSettingsCommit\(currentPreset\.gantt, draft\)/);
		doesNotMatch(tableSource, /failed to save (?:embedded )?Gantt visibility/);
	}

	const settingsSource = await source('src/ui/settings-tab.ts');
	doesNotMatch(settingsSource, /ganttDefaultBarColor/, 'global Gantt settings must not render a bar-color selector');
	doesNotMatch(settingsSource, /ganttShowToday|ganttShowWeekends/, 'global Gantt settings must not render visibility toggles');
	const settingsSearchSource = await source('src/ui/settings/settings-search-registry.ts');
	doesNotMatch(settingsSearchSource, /tableGanttDefaultBarColorMode/, 'global Gantt color must not be searchable');
	doesNotMatch(settingsSearchSource, /tableGanttShowToday|tableGanttShowWeekends/, 'retired global Gantt visibility fields must not be searchable');
	const pluginSource = await source('main.ts');
	doesNotMatch(pluginSource, /barColorMode: this\.settings\.tableGanttDefaultBarColorMode/, 'plugin-created presets must not inherit the legacy global color field');

	const cssSource = await source('styles.css');
	match(cssSource, /\.operon-table-gantt-settings-popover\s*\{[\s\S]*?width: min\(720px,[\s\S]*?min-width: min\(620px,[\s\S]*?border-radius: 10px;[\s\S]*?box-shadow: var\(--shadow-l\)/);
	match(cssSource, /\.operon-table-gantt-settings-popover-form\s*\{[\s\S]*?padding: 8px 10px;[\s\S]*?border-radius: 10px;[\s\S]*?background: color-mix/);
	match(cssSource, /\.operon-table-gantt-settings-popover \.operon-table-gantt-settings-row\.setting-item\s*\{[\s\S]*?grid-template-columns: minmax\(0, 1fr\) minmax\(190px, 280px\);[\s\S]*?background: transparent/);
	match(cssSource, /\.operon-table-gantt-settings-popover \.operon-table-gantt-settings-row\.setting-item \+ \.operon-table-gantt-settings-row\.setting-item\s*\{[\s\S]*?border-top: 1px solid/);
	match(cssSource, /\.operon-table-gantt-settings-popover \.setting-item-info\s*\{[\s\S]*?display: block;[\s\S]*?visibility: visible;[\s\S]*?opacity: 1/);
	doesNotMatch(cssSource, /@media \(max-width: 520px\)\s*\{\s*\.operon-table-gantt-settings-popover/);
	match(cssSource, /\.operon-table-gantt-settings-popover input\[type='number'\],[\s\S]*?border-radius: 8px/);
	match(cssSource, /\.operon-table-gantt-settings-popover select\s*\{[\s\S]*?appearance: none;[\s\S]*?background-image: var\(--operon-gantt-popover-control-chevron\);[\s\S]*?padding-inline-end: 28px/);
	match(cssSource, /\.operon-table-gantt-settings-popover input\[type='number'\],[\s\S]*?flex: 1 1 100%;[\s\S]*?width: 100%;[\s\S]*?max-width: none/);
	match(cssSource, /\.operon-table-gantt-settings-popover-footer\s*\{[\s\S]*?justify-content: flex-end/);
	match(cssSource, /button\.operon-table-gantt-settings-popover-button\s*\{[\s\S]*?background: var\(--background-secondary\);[\s\S]*?color: var\(--text-normal\)/);

	for (const locale of ['en', 'tr', 'de', 'es', 'fr', 'it', 'pt-BR', 'ru', 'ja', 'zh-CN', 'zh-TW']) {
		const catalog = JSON.parse(await source(`i18n/locales/${locale}.json`)) as { table?: Record<string, unknown> };
		equal(typeof catalog.table?.ganttView, 'string', `${locale} must localize the Gantt View tooltip`);
	}

	console.log(`Table Gantt popover tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttPopoverTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttPopoverTestRun = run();
