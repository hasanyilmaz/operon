import { buildOperonDataPackageFromSettings } from '../../src/storage/operon-data-package';
import { serializeOperonTableFile } from '../../src/storage/table-file';
import {
	CURRENT_TASK_STATS_BACKFILL_VERSION,
	DEFAULT_SETTINGS,
	type KeyMapping,
	type OperonSettings,
} from '../../src/types/settings';
import { createDefaultTablePreset } from '../../src/types/table';

export function buildSanitizedAgentRuntimeDataPackage(): unknown {
	const settings = JSON.parse(JSON.stringify(DEFAULT_SETTINGS)) as OperonSettings;
	settings.pipelines = [{
		id: 'pl_fixture_work',
		name: 'Work',
		description: 'Synthetic workflow used only by the Operon Agent Runtime Phase 1 test vault.',
		statuses: [
			{
				id: 'st_fixture_inbox',
				label: 'Inbox',
				color: '#4f6b88',
				isFinished: false,
				isCancelled: false,
				isScheduledTarget: false,
				isTrackingTarget: false,
				propertyMapping: null,
			},
			{
				id: 'st_fixture_active',
				label: 'Active',
				color: '#336699',
				isFinished: false,
				isCancelled: false,
				isScheduledTarget: false,
				isTrackingTarget: true,
				propertyMapping: null,
			},
			{
				id: 'st_fixture_done',
				label: 'Done',
				color: '#5f7f5f',
				isFinished: true,
				isCancelled: false,
				isScheduledTarget: false,
				isTrackingTarget: false,
				propertyMapping: null,
			},
		],
	}];
	settings.defaultPipelineName = 'Work';
	settings.priorities = [
		{
			id: 'pr_fixture_p1',
			label: 'P1',
			color: '#b64242',
			description: 'Urgent synthetic priority used only by portable tests.',
		},
		{
			id: 'pr_fixture_p2',
			label: 'P2',
			color: '#336699',
			description: 'Normal synthetic priority used only by portable tests.',
		},
	];
	settings.defaultPriority = 'P2';
	const customMapping: KeyMapping = {
		canonicalKey: 'fixtureTopic',
		visiblePropertyName: 'Fixture Topic',
		type: 'text',
		sync: 'auto',
		enabled: true,
		hideInFileTaskView: false,
		icon: 'shapes',
		isSystem: false,
		isInternal: false,
		customOrder: 0,
		showInEditor: true,
		showInCreator: true,
		showInChips: true,
		showInKanbanSwimlane: true,
		description: 'Portable custom field used only by Phase 1 fixtures.',
	};
	settings.keyMappings = [
		...settings.keyMappings.filter(mapping => mapping.canonicalKey !== customMapping.canonicalKey),
		customMapping,
	];
	settings.fileTasksFolder = 'Tasks';
	settings.fileTaskArchiveFolder = 'Archive';
	settings.fileTaskTemplateFolder = 'Templates';
	settings.inlineToFileTaskMovePlainCheckboxes = true;
	settings.inlineTaskSaveMode = 'daily-notes';
	settings.inlineTaskUseDailyNote = true;
	settings.inlineTaskParentInlineTargetMode = 'below-parent';
	settings.trackerSplitSessionsAtMidnight = true;
	settings.childTaskInheritanceFields = Array.from(new Set([
		...settings.childTaskInheritanceFields,
		'tags',
	]));
	settings.checkForUpdatesOnStartup = false;
	settings.releaseNotesShowOnUpdate = false;
	settings.demoWorkspacePromptDismissed = true;
	settings.operonDocsAutoUpdateEnabled = false;
	settings.taskStatsBackfillVersion = CURRENT_TASK_STATS_BACKFILL_VERSION;
	return buildOperonDataPackageFromSettings(settings);
}

export function buildSanitizedDefaultTableFile(): string {
	return serializeOperonTableFile(createDefaultTablePreset());
}
