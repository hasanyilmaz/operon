import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const settingsTabSource = await readFile(new URL('../src/ui/settings-tab.ts', import.meta.url), 'utf8');
const registrySource = await readFile(new URL('../src/ui/settings/settings-search-registry.ts', import.meta.url), 'utf8');
const settingsUiSource = await readFile(new URL('../src/ui/settings/settings-ui.ts', import.meta.url), 'utf8');
const stylesSource = await readFile(new URL('../styles.css', import.meta.url), 'utf8');
const englishLocale = JSON.parse(await readFile(new URL('../i18n/locales/en.json', import.meta.url), 'utf8'));

const ROUTER_SETTING_IDS = [
	'inlineTaskSaveMode',
	'inlineTaskTargetFile',
	'inlineTaskHeading',
	'inlineTaskParentInlineTargetMode',
	'inlineTaskParentFileTargetMode',
	'inlineTaskParentFileHeadingKeyword',
	'fileTasksFolder',
	'fileTaskParentInlineTargetMode',
	'fileTaskParentFileTargetMode',
	'fileTaskAutoArchiveEnabled',
	'fileTaskArchiveFolder',
	'fileTaskArchiveDelaySeconds',
	'fileTaskArchiveOnlyFromFileTasksFolder',
];

const ROUTER_DESCRIPTOR_SNAPSHOT = `e('automation', '<tab>', 'fileTaskArchiveDelaySeconds', 'settings', 'fileTaskArchiveDelaySeconds', 'fileTaskArchiveDelaySecondsDesc', 'number', ['file task', 'archive', 'archive delay', 'file task archive']),
e('automation', '<tab>', 'fileTaskArchiveFolder', 'settings', 'fileTaskArchiveFolder', 'fileTaskArchiveFolderDesc', 'folder', ['file task', 'archive', 'archive folder', 'file task archive']),
e('automation', '<tab>', 'fileTaskArchiveOnlyFromFileTasksFolder', 'settings', 'fileTaskArchiveOnlyFromFileTasksFolder', 'fileTaskArchiveOnlyFromFileTasksFolderDesc', 'toggle', ['file task', 'archive', 'archive scope', 'file task archive']),
e('automation', '<tab>', 'fileTaskAutoArchiveEnabled', 'settings', 'fileTaskAutoArchiveEnabled', 'fileTaskAutoArchiveEnabledDesc', 'toggle', ['file task', 'archive', 'auto archive', 'file task archive']),
e('automation', '<tab>', 'fileTaskParentFileTargetMode', 'settings', 'fileTaskFileParentTargetMode', 'fileTaskFileParentTargetModeDesc', 'dropdown', ['new task', 'task creator', 'file task', 'parent', 'parent placement']),
e('automation', '<tab>', 'fileTaskParentInlineTargetMode', 'settings', 'fileTaskInlineParentTargetMode', 'fileTaskInlineParentTargetModeDesc', 'dropdown', ['new task', 'task creator', 'file task', 'inline task', 'parent', 'parent placement']),
e('automation', '<tab>', 'fileTasksFolder', 'settings', 'fileTasksFolder', 'fileTasksFolderDesc', 'folder', ['new task', 'task creator', 'file task', 'file task folder']),
e('automation', '<tab>', 'inlineTaskHeading', 'settings', 'inlineTaskHeading', 'inlineTaskHeadingDesc', 'text', ['new task', 'task creator', 'inline task', 'heading', 'section']),
e('automation', '<tab>', 'inlineTaskParentFileHeadingKeyword', 'settings', 'parentFileHeadingKeyword', 'parentFileHeadingKeywordDesc', 'text', ['new task', 'task creator', 'inline task', 'parent file heading']),
e('automation', '<tab>', 'inlineTaskParentFileTargetMode', 'settings', 'fileParentTaskTargetMode', 'fileParentTaskTargetModeDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'file task', 'parent', 'parent placement']),
e('automation', '<tab>', 'inlineTaskParentInlineTargetMode', 'settings', 'inlineParentTaskTargetMode', 'inlineParentTaskTargetModeDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'parent', 'parent placement', 'inline parent']),
e('automation', '<tab>', 'inlineTaskSaveMode', 'settings', 'inlineTaskDefaultSavePath', 'inlineTaskDefaultSavePathDesc', 'dropdown', ['new task', 'task creator', 'inline task', 'inline save path', 'active file']),
e('automation', '<tab>', 'inlineTaskTargetFile', 'settings', 'inlineTaskTargetFile', 'inlineTaskTargetFileSearchDesc', 'file', ['new task', 'task creator', 'inline task', 'specific file']),`;

function extractMethod(source, methodName, nextMethodName) {
	const start = source.indexOf(`\tprivate ${methodName}`);
	const end = source.indexOf(`\n\tprivate ${nextMethodName}`, start + 1);
	assert.notEqual(start, -1, `${methodName} should exist`);
	assert.notEqual(end, -1, `${nextMethodName} should follow ${methodName}`);
	return source.slice(start, end);
}

test('Task Router is the third Tasks page and has native Settings Search wiring', () => {
	const inlineIndex = settingsTabSource.indexOf("{ id: 'tasksInlineTasks', groupId: 'tasks'");
	const fileIndex = settingsTabSource.indexOf("{ id: 'tasksFileTasks', groupId: 'tasks'");
	const routerIndex = settingsTabSource.indexOf("{ id: 'tasksTaskRouter', groupId: 'tasks'");
	const relationshipsIndex = settingsTabSource.indexOf("{ id: 'tasksRelationships', groupId: 'tasks'");

	assert.ok(inlineIndex < fileIndex && fileIndex < routerIndex && routerIndex < relationshipsIndex);
	assert.match(settingsTabSource, /\| 'tasksTaskRouter'/);
	assert.match(settingsTabSource, /'tasksTaskRouter',\n/);
	assert.match(settingsTabSource, /tasksTaskRouter: \{ namespace: 'settings', key: 'settingsPageTaskRouterDesc' \}/);
	assert.match(settingsTabSource, /tabId === 'tasksTaskRouter'[\s\S]*?this\.renderTasksTaskRouterTab\(contentEl\)/);
});

test('exactly the 13 existing routing settings belong to Task Router search', () => {
	const routerEntries = [...registrySource.matchAll(/e\('[^']+', 'tasksTaskRouter', '([^']+)'/g)]
		.map(match => match[1])
		.filter(id => ROUTER_SETTING_IDS.includes(id));
	assert.deepEqual(routerEntries.sort(), [...ROUTER_SETTING_IDS].sort());
	const descriptorSnapshot = registrySource
		.split('\n')
		.filter(line => ROUTER_SETTING_IDS.some(id => line.includes(`'${id}'`)))
		.map(line => line.replace("'tasksTaskRouter'", "'<tab>'").trim())
		.sort()
		.join('\n');
	assert.equal(descriptorSnapshot, ROUTER_DESCRIPTOR_SNAPSHOT);
	for (const id of ROUTER_SETTING_IDS) {
		assert.equal(
			registrySource.split('\n').filter(line => line.includes(`'${id}'`)).length,
			1,
			`${id} should have exactly one Settings Search entry`,
		);
	}

	for (const id of [
		'inlineTaskDailyNoteAddStartDate',
		'inlineTaskDailyNoteAddScheduledDate',
		'inlineTaskShowTasksEmojiConvertIcon',
		'inlineTaskShowPlainCheckboxConvertIcon',
	]) {
		assert.match(registrySource, new RegExp(`'tasksInlineTasks', '${id}'`));
	}
	for (const id of [
		'inlineToFileTaskMovePlainCheckboxes',
		'taskCreatorDefaultToFileTask',
		'taskCreatorDefaultFileTemplateId',
		'fileTaskTemplateFolder',
		'manageDailyNotesWithOperon',
		'dailyNoteFormat',
		'dailyNoteTemplate',
		'dailyNoteFolder',
		'createDailyNotesAsOperonTask',
		'manageWeeklyNotesWithOperon',
		'weeklyNoteFormat',
		'weeklyNoteTemplate',
		'weeklyNoteFolder',
		'createWeeklyNotesAsOperonTask',
		'excludedFolders',
		'fileTaskMigration',
	]) {
		assert.match(registrySource, new RegExp(`'tasksFileTasks', '${id}'`));
	}
	assert.match(registrySource, /section\('automation', 'tasksTaskRouter', 'fileTaskPipelineLocations'/);
	assert.match(registrySource, /'tasksTaskRouter', 'moveConvertedNotesToPipelineLocation'/);
});

test('File Tasks renders managed Daily and Weekly Notes and Task Router exposes the Weekly destination', () => {
	const periodicMethod = extractMethod(settingsTabSource, 'renderFileTaskDailyNotesSettings', 'renderPeriodicNoteSettings');
	const sharedMethod = extractMethod(settingsTabSource, 'renderPeriodicNoteSettings', 'renderPeriodicNoteFormatSetting');
	const formatMethod = extractMethod(settingsTabSource, 'renderPeriodicNoteFormatSetting', 'renderFileTaskArchiveSettings');

	assert.match(periodicMethod, /kind: 'daily'[\s\S]*?docsTarget: 'DOCS-050 Daily Notes workflows'/);
	assert.match(periodicMethod, /kind: 'weekly'/);
	assert.doesNotMatch(periodicMethod, /weekly[\s\S]*?docsTarget/u);
	assert.match(sharedMethod, /managedFieldsEl\.empty\(\)/);
	assert.match(sharedMethod, /if \(!this\.settings\[options\.managementKey\]\) return/);
	assert.ok(
		sharedMethod.indexOf('renderManagedFields();')
			< sharedMethod.indexOf("t('settings', options.createAsTaskKey)"),
		'create-as-task must remain outside the hidden managed fields',
	);
	assert.match(sharedMethod, /onAfterChange: renderManagedFields/);
	assert.doesNotMatch(sharedMethod, /redisplayPreservingScroll/);
	assert.match(sharedMethod, /new FileSuggest[\s\S]*?file\.extension === 'md'/);
	assert.match(sharedMethod, /new FolderSuggest/);
	assert.match(formatMethod, /formatPeriodicNoteTitleFromDateKey\(kind, localToday\(\), value\)/);
	assert.match(formatMethod, /https:\/\/momentjs\.com\/docs\/#\/displaying\/format\//);
	assert.match(formatMethod, /rel: 'noopener noreferrer'/);
	assert.match(formatMethod, /periodicNoteSyntaxInvalid/);
	assert.match(formatMethod, /normalize: value => value \|\| \(kind === 'daily' \? DEFAULT_DAILY_NOTE_FORMAT : DEFAULT_WEEKLY_NOTE_FORMAT\)/);
	assert.match(formatMethod, /setAttribute\('role', 'status'\)/);
	assert.match(formatMethod, /setAttribute\('aria-live', 'polite'\)/);
	assert.match(settingsTabSource, /value: 'weekly-notes'/);
});

test('routing sections render only from Task Router and archive is not duplicated', () => {
	const routerMethod = extractMethod(settingsTabSource, 'renderTasksTaskRouterTab', 'renderTasksInlineTasksTab');
	const inlineMethod = extractMethod(settingsTabSource, 'renderTasksInlineTasksTab', 'getInlineTaskTargetFileDescription');
	const fileMethod = extractMethod(settingsTabSource, 'renderTasksFileTasksTab', 'renderInlineTaskRoutingSettings');

	assert.match(routerMethod, /renderInlineTaskRoutingSettings\(containerEl\)/);
	assert.match(routerMethod, /renderFileTaskRoutingSettings\(containerEl\)/);
	assert.match(routerMethod, /renderFileTaskArchiveSettings\(containerEl\)/);
	assert.doesNotMatch(inlineMethod, /renderInlineTaskRoutingSettings/);
	assert.doesNotMatch(fileMethod, /renderFileTaskRoutingSettings|renderFileTaskArchiveSettings/);
	assert.equal((settingsTabSource.match(/this\.renderFileTaskArchiveSettings\(/g) ?? []).length, 1);
});

test('File Tasks keeps section copy and documentation attached while rendering the approved order', () => {
	const fileMethod = extractMethod(settingsTabSource, 'renderTasksFileTasksTab', 'renderInlineTaskRoutingSettings');
	const templateMethod = extractMethod(settingsTabSource, 'renderFileTaskTemplateSettings', 'getDefaultFileTaskTemplateDropdownOptions');
	const orderedCalls = [
		'renderNewFileTaskCreationDefaultSettings',
		'renderFileTaskTemplateSettings',
		'renderFileTaskDailyNotesSettings',
		"t('settings', 'fileTaskConversion')",
		'renderExcludedFolderSettings',
		'renderFileTaskMigrationSettings',
	];
	let priorIndex = -1;
	for (const call of orderedCalls) {
		const index = fileMethod.indexOf(call);
		assert.ok(index > priorIndex, `${call} should follow the preceding File Tasks section`);
		priorIndex = index;
	}

	assert.match(fileMethod, /creationDefaultsTitle, 'DOCS-020 Task Creator'/);
	assert.match(fileMethod, /templateTitle, 'DOCS-024 Task templates'/);
	assert.match(fileMethod, /conversionTitle, 'DOCS-019 Converting inline and file tasks'/);
	assert.doesNotMatch(
		templateMethod,
		/renderExcludedFolderSettings|renderFileTaskDailyNotesSettings|renderFileTaskMigrationSettings/,
	);
});

test('Task Router preserves the intended docs targets', () => {
	assert.match(settingsTabSource, /tasksTaskRouter: 'DOCS-008 Essential settings to configure first'/);
	assert.match(settingsTabSource, /defaultLocationTitle, 'DOCS-011 Inline tasks'/);
	assert.match(settingsTabSource, /placementTitle, 'DOCS-094 How to create a task with Task Creator'/);
	assert.match(settingsTabSource, /defaultLocationTitle, 'DOCS-013 File tasks'/);
	assert.match(settingsTabSource, /title, 'DOCS-052 Completed task review'/);
});

test('Pipeline Locations uses labeled native controls with a neutral add action', () => {
	const routingMethod = extractMethod(settingsTabSource, 'renderFileTaskRoutingSettings', 'renderInlineTaskRoutingSettings');

	assert.match(routingMethod, /createDiv\('operon-file-task-pipeline-location-row'\)/);
	assert.match(routingMethod, /new Obsidian\.DropdownComponent\(rowEl\)/);
	assert.match(routingMethod, /new Obsidian\.TextComponent\(rowEl\)/);
	assert.match(routingMethod, /fileTaskPipelineLocationPipeline/);
	assert.match(routingMethod, /fileTaskPipelineLocationFolder/);
	assert.match(routingMethod, /createSettingsAddButton\(addRowEl, t\('settings', 'addFileTaskPipelineLocation'\)\)/);
	assert.match(routingMethod, /operon-file-task-pipeline-location-add-button/);
	assert.doesNotMatch(routingMethod, /\.setCta\(\)/);
	assert.match(settingsUiSource, /setIcon\(iconEl, 'plus'\)/);
	assert.match(stylesSource, /\.operon-file-task-pipeline-location-rows \{[\s\S]*?padding-inline: 24px;/);
	assert.match(stylesSource, /\.operon-file-task-pipeline-location-row \{[\s\S]*?grid-template-columns: max-content minmax\(180px, 1fr\) max-content minmax\(180px, 1fr\) auto;/);
	assert.match(stylesSource, /\.operon-file-task-pipeline-location-select \{[\s\S]*?text-align: start;[\s\S]*?text-align-last: start;/);
	assert.match(stylesSource, /\.operon-file-task-pipeline-location-add-row \{[\s\S]*?padding: 12px 24px 0;/);
	assert.match(stylesSource, /\.operon-file-task-pipeline-location-add-button \{[\s\S]*?background: transparent;/);
	assert.match(stylesSource, /@media \(max-width: 720px\) \{[\s\S]*?\.operon-file-task-pipeline-location-rows \{[\s\S]*?padding-inline: 16px;/);
	assert.match(stylesSource, /@media \(max-width: 720px\) \{[\s\S]*?\.operon-file-task-pipeline-location-add-row \{[\s\S]*?padding-inline: 16px;/);
	assert.match(stylesSource, /@media \(max-width: 480px\) \{[\s\S]*?\.operon-file-task-pipeline-location-rows \{[\s\S]*?padding-inline: 12px;/);
	assert.match(stylesSource, /@media \(max-width: 480px\) \{[\s\S]*?\.operon-file-task-pipeline-location-add-row \{[\s\S]*?padding-inline: 12px;/);
	assert.match(englishLocale.settings.fileTaskPipelineLocationsDesc, /New File Tasks are created/);
	assert.match(englishLocale.settings.fileTaskPipelineLocationsDesc, /about 30 seconds/);
	assert.equal(englishLocale.settings.fileTaskPipelineLocationFolder, 'Folder');
});
