import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const settingsSource = await readFile(path.join(rootDir, 'src/ui/settings-tab.ts'), 'utf8');
const quickSettingsSource = await readFile(
	path.join(rootDir, 'src/ui/kanban/kanban-preset-quick-settings-modal.ts'),
	'utf8',
);
const stylesSource = await readFile(path.join(rootDir, 'styles.css'), 'utf8');

function extractMethod(source, signature) {
	const start = source.indexOf(signature);
	assert.notEqual(start, -1, `missing method: ${signature}`);
	const nextMethod = source.indexOf('\n\tprivate ', start + signature.length);
	return source.slice(start, nextMethod === -1 ? source.length : nextMethod);
}

test('Kanban preset sorting uses the native dropdown on both Settings surfaces', () => {
	const settingsControl = extractMethod(settingsSource, 'private renderKanbanSortModeControl(');
	const quickControl = extractMethod(quickSettingsSource, 'private renderSortModeControl(');
	const settingsDropdown = extractMethod(settingsSource, 'private configureKanbanSortModeDropdown(');
	const quickDropdown = extractMethod(quickSettingsSource, 'private configureSortModeDropdown(');
	for (const [control, dropdownConfiguration] of [
		[settingsControl, settingsDropdown],
		[quickControl, quickDropdown],
	]) {
		assert.match(control, /new Setting\(container\)/u);
		assert.match(control, /\.addDropdown\(dropdown => \{/u);
		assert.match(dropdownConfiguration, /dropdown\.addOption\('automatic',/u);
		assert.match(dropdownConfiguration, /dropdown\.addOption\('manual',/u);
		assert.match(dropdownConfiguration, /dropdown\.setValue\(configuration\.sortMode\)/u);
		assert.match(dropdownConfiguration, /dropdown\.onChange\(async value => \{/u);
	}
});

test('manual mode still hides automatic sort rules for board and column configurations', () => {
	assert.match(settingsSource, /if \(configuration\.sortMode === 'manual'\) \{\s*this\.renderKanbanManualSortMessage\(container\);[\s\S]*?return;/u);
	assert.match(quickSettingsSource, /if \(configuration\.sortMode === 'manual'\) \{\s*this\.renderManualSortMessage\(container\);[\s\S]*?return;/u);
});

test('both Settings surfaces expose unique removable pipeline column sorting overrides', () => {
	for (const source of [settingsSource, quickSettingsSource]) {
		assert.match(source, /kanbanPipelineColumnSorting/u);
		assert.match(source, /const configured = new Set\(\(preset\.columnSortOverrides \?\? \[\]\)\.map/u);
		assert.match(source, /\(current\.columnSortOverrides \?\?= \[\]\)\.push\(\{/u);
		assert.match(source, /sortMode: current\.sortMode/u);
		assert.match(source, /sortRules: current\.sortRules\.map\(rule => \(\{ \.\.\.rule \}\)\)/u);
		assert.match(source, /const overrides = \(current\.columnSortOverrides \?\? \[\]\)\.filter/u);
		const columnSection = extractMethod(source, source === settingsSource
			? 'private renderKanbanPipelineColumnSortSection('
			: 'private renderPipelineColumnSortSection(');
		const dropdownIndex = columnSection.search(/new (?:Obsidian\.)?DropdownComponent\(addRow\)/u);
		assert.notEqual(dropdownIndex, -1);
		assert.ok(dropdownIndex < columnSection.indexOf("text: t('settings', 'kanbanAddColumnSorting')"));
		assert.match(columnSection, /setting-item-control operon-kanban-column-sort-add-row/u);
		assert.match(columnSection, /operon-kanban-column-sort-title/u);
		assert.match(columnSection, /setting-item-control operon-kanban-column-sort-header/u);
		assert.match(columnSection, /configure(?:Kanban)?SortModeDropdown\(modeDropdown/u);
		assert.doesNotMatch(columnSection, /header\.createEl\('button'/u);
		assert.match(columnSection, /addDropdown\.selectEl\.setAttr\('aria-label', t\('settings', 'kanbanPipelineColumnSorting'\)\)/u);
		assert.match(columnSection, /operon-kanban-column-sort-complete-description/u);
		assert.doesNotMatch(columnSection, /new Setting\(block\)\.setName\(status\.label\)\.setHeading\(\)/u);
	}
	assert.match(stylesSource, /\.operon-kanban-column-sort-add-row \{[\s\S]*?grid-template-columns: minmax\(0, 210px\) max-content;[\s\S]*?justify-content: space-between;/u);
	assert.match(stylesSource, /\.operon-kanban-column-sort-header \{[\s\S]*?flex-wrap: nowrap;[\s\S]*?width: 100%;/u);
	assert.match(stylesSource, /\.operon-kanban-column-sort-title \{[\s\S]*?font-weight: 600;/u);
	assert.match(stylesSource, /\.operon-kanban-column-sort-remove-button \{\s*margin-inline-start: auto;/u);
	assert.match(stylesSource, /\.operon-kanban-sort-mode-setting \.setting-item-name \{[\s\S]*?font-weight: 600;/u);
	assert.match(stylesSource, /\.operon-kanban-sort-mode-setting \.setting-item-control \{\s*justify-content: flex-end;/u);
	assert.match(stylesSource, /\.operon-kanban-preset-quick-settings-modal \.operon-kanban-sort-mode-setting \{\s*margin-inline: 8px;/u);
	assert.match(stylesSource, /\.operon-kanban-sort-mode-select \{[\s\S]*?width: 160px;[\s\S]*?max-width: 160px;/u);
	assert.match(stylesSource, /body \.modal\.operon-kanban-preset-quick-settings-modal \.operon-kanban-sort-mode-select \{[\s\S]*?width: 160px;[\s\S]*?max-width: 160px;/u);
	assert.match(stylesSource, /\.operon-kanban-column-sort-footer \{\s*justify-content: space-between;/u);
	assert.match(stylesSource, /\.operon-kanban-preset-quick-settings-modal \.operon-kanban-sort-rules \{\s*margin: 4px 8px 8px;/u);
	assert.match(stylesSource, /\.operon-kanban-preset-quick-settings-modal \.operon-kanban-column-sort-rules \{\s*margin-inline: 0;/u);
});

test('column mode and remove controls use the header and footer while board mode keeps its row', () => {
	for (const source of [settingsSource, quickSettingsSource]) {
		const sortSection = extractMethod(source, source === settingsSource
			? 'private renderKanbanSortConfiguration('
			: 'private renderSortSection(');
		assert.match(sortSection, /if \(statusId === null\) this\.render(?:Kanban)?SortModeControl/u);
		assert.match(sortSection, /operon-kanban-column-sort-footer/u);
		assert.match(sortSection, /render(?:Kanban)?ColumnSortRemoveButton\(addRow, onRemoveOverride\)/u);
	}
});

test('sorting descriptions and re-render scroll jumps stay removed on both Settings surfaces', () => {
	const settingsSort = extractMethod(settingsSource, 'private renderKanbanSortConfiguration(');
	const quickSort = extractMethod(quickSettingsSource, 'private renderSortSection(');
	for (const source of [settingsSort, quickSort]) {
		assert.doesNotMatch(source, /kanbanSortingDesc|kanbanColumnSortingDesc/u);
	}
	assert.doesNotMatch(quickSort, /this\.render\(\);/u);
	assert.match(quickSort, /this\.renderPreservingScroll\(\);/u);
});

test('retired segmented sort mode button code and styles stay absent', () => {
	for (const source of [settingsSource, quickSettingsSource, stylesSource]) {
		assert.doesNotMatch(source, /operon-kanban-sort-mode-button/u);
		assert.doesNotMatch(source, /operon-kanban-sort-mode-control/u);
	}
});

test('Project Serial is localized in both sort pickers and directions use Table-style A-Z icons', () => {
	for (const source of [settingsSource, quickSettingsSource]) {
		assert.match(source, /option\.value === 'projectSerial'[\s\S]*?\? 'projectSerials'/u);
		assert.match(source, /operon-kanban-sort-direction-toggle/u);
		assert.match(source, /setIcon\(directionButton, rule\.direction === 'asc' \? 'arrow-down-a-z' : 'arrow-down-z-a'\)/u);
		assert.doesNotMatch(source, /text: this\.format(?:Kanban)?SortDirection\(rule\.direction\)/u);
	}
	assert.match(stylesSource, /\.operon-kanban-sort-direction-toggle \{[\s\S]*?width: 32px;[\s\S]*?height: 32px;[\s\S]*?border-radius: 8px;/u);
	assert.match(stylesSource, /\.operon-kanban-sort-direction-toggle svg \{[\s\S]*?width: 15px;[\s\S]*?height: 15px;/u);
});
