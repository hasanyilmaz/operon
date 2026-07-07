import type { OperonSettings } from '../types/settings';

type TaskStatusIconRenderSettings = Pick<
	OperonSettings,
	'fallbackTaskIconSource' | 'taskStatusIconColorSource' | 'fallbackStateIcons' | 'pipelines' | 'priorities'
>;

export function buildTaskStatusIconRenderSettingsSignature(settings: TaskStatusIconRenderSettings): string {
	return JSON.stringify({
		fallbackTaskIconSource: settings.fallbackTaskIconSource,
		taskStatusIconColorSource: settings.taskStatusIconColorSource,
		fallbackStateIcons: settings.fallbackStateIcons,
		pipelineIconsAndColors: settings.pipelines.map(pipeline => ({
			id: pipeline.id,
			name: pipeline.name,
			statuses: pipeline.statuses.map(status => ({
				id: status.id,
				label: status.label,
				color: status.color,
				pipelineStatusIcon: status.pipelineStatusIcon ?? '',
			})),
		})),
		priorityIconsAndColors: settings.priorities.map(priority => ({
			id: priority.id,
			label: priority.label,
			color: priority.color,
			priorityIcon: priority.priorityIcon ?? '',
		})),
	});
}
