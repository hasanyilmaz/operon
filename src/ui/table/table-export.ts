import { t } from '../../core/i18n';
import type { IndexedTask } from '../../types/fields';
import { resolveTaskDisplayIcon, type OperonSettings } from '../../types/settings';
import {
	TABLE_LINE_NUMBER_COLUMN_KEY,
	TABLE_TASK_ICON_COLUMN_KEY,
	TABLE_TASK_TYPE_COLUMN_KEY,
	type TableColumn,
	type TablePreset,
} from '../../types/table';
import { getTableTaskFieldLabel } from './table-field-catalog';
import type { TableValueResolver } from './table-value-cache';

export interface TableExportSource {
	columns: readonly TableColumn[];
	rows: readonly IndexedTask[];
	settings: Pick<OperonSettings, 'fallbackStateIcons' | 'fallbackTaskIconSource' | 'keyMappings' | 'pipelines' | 'priorities'>;
	valueResolver: Pick<TableValueResolver, 'getDisplayValue'>;
}

export interface TableExportData {
	headers: string[];
	rows: string[][];
}

export function buildTableExportData(source: TableExportSource): TableExportData {
	const columns = source.columns.filter(column => column.hidden !== true);
	return {
		headers: columns.map(column => getTableExportHeader(column, source.settings)),
		rows: source.rows.map((task, rowIndex) => columns.map(column => getTableExportCell(source, task, rowIndex, column))),
	};
}

export function serializeTableExportCsv(source: TableExportSource): string {
	const data = buildTableExportData(source);
	return [
		data.headers.map(escapeCsvCell).join(','),
		...data.rows.map(row => row.map(escapeCsvCell).join(',')),
	].join('\n');
}

// Excel on Windows sniffs BOM-less CSV as ANSI and garbles non-ASCII text, so the
// downloaded file gets a UTF-8 BOM. Clipboard copies must stay BOM-free — the mark
// would paste as an invisible character.
export function buildTableExportCsvFileContents(source: TableExportSource): string {
	return `\uFEFF${serializeTableExportCsv(source)}`;
}

export function serializeTableExportMarkdown(source: TableExportSource): string {
	const data = buildTableExportData(source);
	const header = `| ${data.headers.map(escapeMarkdownTableCell).join(' | ')} |`;
	const separator = `| ${data.headers.map(() => '---').join(' | ')} |`;
	const rows = data.rows.map(row => `| ${row.map(escapeMarkdownTableCell).join(' | ')} |`);
	return [header, separator, ...rows].join('\n');
}

export function buildTableEmbedCode(presetId: string): string {
	return `\`\`\`operon-table\npresetId: ${JSON.stringify(presetId)}\n\`\`\``;
}

export function buildTableCsvFilename(preset: Pick<TablePreset, 'name'>, now = new Date()): string {
	const presetName = sanitizeFilenameSegment(preset.name.trim() || t('table', 'untitledPreset'));
	const timestamp = formatFilenameTimestamp(now);
	return `Operon Table - ${presetName} - ${timestamp}.csv`;
}

function getTableExportHeader(column: TableColumn, settings: Pick<OperonSettings, 'keyMappings'>): string {
	if (column.label?.trim()) return column.label.trim();
	if (column.key === TABLE_LINE_NUMBER_COLUMN_KEY) return t('settings', 'tableShowLineNumbers');
	if (column.key === TABLE_TASK_ICON_COLUMN_KEY) return t('settings', 'tableShowTaskIcon');
	if (column.key === TABLE_TASK_TYPE_COLUMN_KEY) return t('settings', 'tableTaskTypeColumn');
	return getTableTaskFieldLabel(column.key, settings);
}

function getTableExportCell(source: TableExportSource, task: IndexedTask, rowIndex: number, column: TableColumn): string {
	if (column.key === TABLE_LINE_NUMBER_COLUMN_KEY) {
		return String(rowIndex + 1);
	}
	if (column.key === TABLE_TASK_TYPE_COLUMN_KEY) {
		return task.primary.format === 'inline' ? 'inline' : 'file';
	}
	if (column.key === TABLE_TASK_ICON_COLUMN_KEY) {
		return resolveTaskDisplayIcon(source.settings, task.fieldValues, task.checkbox);
	}
	return source.valueResolver.getDisplayValue(task, column.key);
}

function escapeCsvCell(value: string): string {
	const safeValue = hardenCsvFormulaCell(value);
	if (!/[",\r\n]/u.test(safeValue)) return safeValue;
	return `"${safeValue.replace(/"/gu, '""')}"`;
}

function hardenCsvFormulaCell(value: string): string {
	if (!isSpreadsheetFormulaLikeCell(value)) return value;
	return `'${value}`;
}

function isSpreadsheetFormulaLikeCell(value: string): boolean {
	const trimmedStart = value.match(/^[\t\r\n ]*/u)?.[0].length ?? 0;
	const firstMeaningful = value.charAt(trimmedStart);
	return firstMeaningful === '='
		|| firstMeaningful === '+'
		|| firstMeaningful === '-'
		|| firstMeaningful === '@';
}

function escapeMarkdownTableCell(value: string): string {
	return value
		.replace(/\r\n?/gu, '\n')
		.replace(/\n/gu, '<br>')
		.replace(/\|/gu, '\\|');
}

function formatFilenameTimestamp(now: Date): string {
	const year = now.getFullYear();
	const month = padFilenameDatePart(now.getMonth() + 1);
	const day = padFilenameDatePart(now.getDate());
	const hour = padFilenameDatePart(now.getHours());
	const minute = padFilenameDatePart(now.getMinutes());
	return `${year}-${month}-${day} ${hour}-${minute}`;
}

function padFilenameDatePart(value: number): string {
	return String(value).padStart(2, '0');
}

function sanitizeFilenameSegment(value: string): string {
	const sanitized = Array.from(value)
		.map(char => isSafeFilenameCharacter(char) ? char : '-')
		.join('')
		.replace(/\s+/gu, ' ')
		.trim();
	return sanitized || t('table', 'untitledPreset');
}

function isSafeFilenameCharacter(char: string): boolean {
	return char.charCodeAt(0) >= 32 && !'<>:"/\\|?*'.includes(char);
}
