import type { TableTaskField } from './table-field-catalog';
import { localToday } from '../../core/local-time';
import type { OperonSettings } from '../../types/settings';
import { buildTaskStatusIconRenderSettingsSignature } from '../task-status-icon-signature';

type TableRelevantSettings = Pick<
	OperonSettings,
	'filterSets'
	| 'keyMappings'
	| 'pipelines'
	| 'priorities'
	| 'calendarWeekStart'
	| 'timeFormat'
	| 'tableShowLineNumbers'
	| 'tableEmbedVisibleRows'
	| 'tableShowTaskIcon'
	| 'tableShowTaskDataTypeIcon'
	| 'tableGanttShowDateStartedMarkers'
	| 'tableGanttShowDateScheduledMarkers'
	| 'tableGanttShowDateDueMarkers'
	| 'tableGanttBarClickAction'
	| 'tableGanttBarRightClickAction'
	| 'fallbackTaskIconSource'
	| 'taskStatusIconColorSource'
	| 'fallbackStateIcons'
>;

export function buildTableRelevantSettingsSignature(settings: TableRelevantSettings): string {
	return JSON.stringify({
		day: localToday(),
		weekStart: settings.calendarWeekStart,
		filterSets: settings.filterSets,
		keyMappings: settings.keyMappings,
		pipelines: settings.pipelines,
		priorities: settings.priorities,
		timeFormat: settings.timeFormat,
		tableShowLineNumbers: settings.tableShowLineNumbers,
		tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
		tableShowTaskIcon: settings.tableShowTaskIcon,
		tableShowTaskDataTypeIcon: settings.tableShowTaskDataTypeIcon,
		tableGanttShowDateStartedMarkers: settings.tableGanttShowDateStartedMarkers,
		tableGanttShowDateScheduledMarkers: settings.tableGanttShowDateScheduledMarkers,
		tableGanttShowDateDueMarkers: settings.tableGanttShowDateDueMarkers,
		tableGanttBarClickAction: settings.tableGanttBarClickAction,
		tableGanttBarRightClickAction: settings.tableGanttBarRightClickAction,
		taskStatusIconRender: buildTaskStatusIconRenderSettingsSignature(settings),
	});
}

/** Property presence/counts affect data, not the table shell or header geometry. */
export function buildTableFieldLayoutSignature(fields: readonly TableTaskField[]): string {
 return JSON.stringify(fields.map(field => [field.key, field.label, field.type, field.group, field.icon,
  field.readonly, field.sourceLabel, field.unavailable, field.readOnlyReason])
  .sort((left, right) => String(left[0]).localeCompare(String(right[0]))));
}
