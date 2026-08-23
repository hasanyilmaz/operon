import type { PresetFavorites } from '../core/preset-favorites';
import type { TablePresetProjectionSettings } from '../types/table';
import type { OperonDataPackageV1 } from './operon-data-package';
import {
	TABLE_PRESET_MANIFEST_VERSION,
	type ReconciledTablePresetFileAuthority,
} from './table-preset-manifest';

const RETIRED_ROOT_TABLE_SETTING_KEYS = [
	'tablePresets',
	'tablePresetOrderIds',
	'tablePresetFileBindings',
	'tablePresetFileInitialized',
	'tableDefaultPresetId',
	'tableDefaultFolder',
	'tableEmbedVisibleRows',
	'tableEmbedDefaultWidthPercent',
	'tableShowLineNumbers',
	'tableShowTaskIcon',
	'tableShowTaskTypeIcon',
	'tableShowTaskDataTypeIcon',
] as const;

export type TablePresetAuthorityPackageSettings = Pick<
	TablePresetProjectionSettings,
	| 'tableDefaultFolder'
	| 'tableEmbedVisibleRows'
	| 'tableEmbedDefaultWidthPercent'
	| 'tableShowLineNumbers'
	| 'tableShowTaskIcon'
	| 'tableShowTaskDataTypeIcon'
>;

export function buildTablePresetAuthorityDataPackage(
	currentPackage: OperonDataPackageV1,
	authority: ReconciledTablePresetFileAuthority,
	settings: TablePresetAuthorityPackageSettings,
	favorites: PresetFavorites,
): OperonDataPackageV1 {
	const rootSettings = { ...currentPackage.settings };
	const rootSettingsRecord = rootSettings as unknown as Record<string, unknown>;
	for (const key of RETIRED_ROOT_TABLE_SETTING_KEYS) delete rootSettingsRecord[key];
	return {
		...currentPackage,
		settings: rootSettings,
		views: {
			...currentPackage.views,
			tablePresets: {
				version: TABLE_PRESET_MANIFEST_VERSION,
				presetIds: [...authority.presetIds],
				fileBindings: authority.fileBindings.map(binding => ({ ...binding })),
				initialized: authority.initialized,
				tableDefaultPresetId: authority.tableDefaultPresetId,
				tableDefaultFolder: settings.tableDefaultFolder,
				tableEmbedVisibleRows: settings.tableEmbedVisibleRows,
				tableEmbedDefaultWidthPercent: settings.tableEmbedDefaultWidthPercent,
				tableShowLineNumbers: settings.tableShowLineNumbers,
				tableShowTaskIcon: settings.tableShowTaskIcon,
				tableShowTaskDataTypeIcon: settings.tableShowTaskDataTypeIcon,
			},
		},
		ui: {
			...currentPackage.ui,
			presetFavorites: {
				...(currentPackage.ui.presetFavorites ?? { version: 1, ...favorites }),
				version: 1,
				table: [...favorites.table],
			},
		},
	};
}
