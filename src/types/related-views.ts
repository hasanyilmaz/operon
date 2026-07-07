export type RelatedViewType = 'filter' | 'calendar' | 'kanban' | 'table';
export type RelatedPresetViewType = Exclude<RelatedViewType, 'filter'>;

export interface RelatedFilterablePreset {
	id: string;
	name: string;
	filterSetId: string | null;
}

export interface RelatedViewSource {
	type: RelatedPresetViewType;
	preset: RelatedFilterablePreset;
}

export type RelatedViewCreateTarget =
	| { type: 'calendar'; variant: 'timeGrid' | 'timeTrackerGrid' | 'multiWeek'; filterSetId: string | null }
	| { type: 'kanban'; variant: 'defaultPipeline'; filterSetId: string | null }
	| { type: 'table'; variant: 'defaultTable'; filterSetId: string | null };

export interface RelatedViewOpenTarget {
	type: RelatedViewType;
	presetId: string;
}

export interface RelatedViewItem extends RelatedViewOpenTarget {
	name: string;
}

export interface RelatedViewGroup {
	type: RelatedViewType;
	items: RelatedViewItem[];
}
