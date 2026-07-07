import type { OperonSettings } from '../../types/settings';
import { buildTaskStatusIconRenderSettingsSignature } from '../task-status-icon-signature';

type TableRelevantSettings = Pick<
	OperonSettings,
	'filterSets'
	| 'keyMappings'
	| 'pipelines'
	| 'priorities'
	| 'timeFormat'
	| 'tableShowLineNumbers'
	| 'tableEmbedVisibleRows'
	| 'tableShowTaskIcon'
	| 'tableShowTaskTypeIcon'
	| 'fallbackTaskIconSource'
	| 'taskStatusIconColorSource'
	| 'fallbackStateIcons'
>;

export function buildTableRelevantSettingsSignature(settings: TableRelevantSettings): string {
	return JSON.stringify({
		filterSets: settings.filterSets,
		keyMappings: settings.keyMappings,
		pipelines: settings.pipelines,
		priorities: settings.priorities,
		timeFormat: settings.timeFormat,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskTypeIcon: settings.tableShowTaskTypeIcon,
		taskStatusIconRender: buildTaskStatusIconRenderSettingsSignature(settings),
	});
}
