import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { resolveNextTableGanttEnabled } from '../src/ui/table/table-gantt-toolbar-toggle';

let assertions = 0;
function equal<T>(actual: T, expected: T, message?: string): void { assert.equal(actual, expected, message); assertions += 1; }
function match(actual: string, expected: RegExp, message?: string): void { assert.match(actual, expected, message); assertions += 1; }
function doesNotMatch(actual: string, expected: RegExp, message?: string): void { assert.doesNotMatch(actual, expected, message); assertions += 1; }

async function source(filePath: string): Promise<string> {
	return readFile(path.join(process.cwd(), filePath), 'utf8');
}

async function run(): Promise<void> {
	equal(resolveNextTableGanttEnabled(false), true, 'an inactive Gantt preset must toggle on');
	equal(resolveNextTableGanttEnabled(true), false, 'an active Gantt preset must toggle off');

	const formSource = await source('src/ui/table/table-gantt-settings-form.ts');
	for (const field of [
		'ganttEnabled',
		'ganttSplitPercent',
		'ganttScale',
		'ganttUnitWidth',
		'ganttBarColor',
		'ganttWeekendVisibility',
	]) match(formSource, new RegExp(field), `preset Gantt settings must retain ${field}`);
	match(formSource, /if \(options\.includeEnabled\)/, 'Open Gantt by default must remain in preset settings');

	const toggleSource = await source('src/ui/table/table-gantt-toolbar-toggle.ts');
	match(toggleSource, /options\.container\.createEl\('button'/, 'the toggle must be a direct toolbar button');
	match(toggleSource, /'aria-pressed': String\(options\.enabled\)/, 'the pressed state must expose the persisted preset value');
	match(toggleSource, /classList\.toggle\('is-active', options\.enabled\)/, 'the visual active state must follow the preset');
	match(toggleSource, /button\.disabled = !options\.canChangePreset/, 'non-writable surfaces must retain a disabled button');
	match(toggleSource, /content: label[\s\S]*preferredVertical: 'below'/, 'the Gantt view tooltip must remain available');
	match(toggleSource, /button\.disabled = true;[\s\S]*options\.onToggle\(\)\.catch/, 'an in-flight toggle must reject duplicate activation');
	match(toggleSource, /button\.disabled = !options\.canChangePreset;[\s\S]*options\.onToggleError\(error\)/, 'failed writes must restore availability and report the error');
	doesNotMatch(toggleSource, /aria-haspopup|aria-expanded|aria-controls/, 'the toggle must not retain dialog semantics');

	for (const filePath of ['src/ui/table/operon-table-view.ts', 'src/ui/embed-table-processor.ts']) {
		const tableSource = await source(filePath);
		match(tableSource, /if \(Platform\.isPhone\) return;/, 'phone surfaces must retain the existing Gantt restriction');
		match(tableSource, /renderTableGanttToolbarToggle\(\{/, 'workspace and embedded surfaces must use the shared toggle');
		match(tableSource, /enabled: preset\.gantt\.enabled/, 'the rendered state must follow the active preset');
		match(tableSource, /enabled: resolveNextTableGanttEnabled\(currentPreset\.gantt\.enabled\)/, 'each click must invert the latest persisted preset state');
		match(tableSource, /presetActionFailed/, 'toggle failures must use the existing localized notice');
		doesNotMatch(tableSource, /ganttSettingsPopover|showTableGanttSettingsPopover|buildTableGanttSettingsCommit/);
		doesNotMatch(tableSource, /Platform\.isPhone \|\| !preset\.gantt\.enabled/, 'disabled Gantt presets must no longer hide the toolbar button');
	}

	const cssSource = await source('styles.css');
	doesNotMatch(cssSource, /operon-table-gantt-settings-popover/, 'popover-specific CSS must be removed');
	match(cssSource, /\.operon-table-toolbar-end > button\.operon-table-toolbar-icon-button/, 'direct toolbar buttons must retain fixed geometry');

	const packageSource = await source('package.json');
	match(packageSource, /"table:gantt-toggle:test"/);
	doesNotMatch(packageSource, /table:gantt-popover:test|run-table-gantt-popover-tests/);

	for (const locale of ['en', 'tr', 'de', 'es', 'fr', 'it', 'pt-BR', 'ru', 'ja', 'zh-CN', 'zh-TW']) {
		const catalog = JSON.parse(await source(`i18n/locales/${locale}.json`)) as { table?: Record<string, unknown> };
		equal(typeof catalog.table?.ganttView, 'string', `${locale} must localize the Gantt View tooltip`);
	}

	console.log(`Table Gantt toggle tests passed (${assertions} assertions).`);
}

declare global {
	var __operonTableGanttToggleTestRun: Promise<void> | undefined;
}

globalThis.__operonTableGanttToggleTestRun = run();
