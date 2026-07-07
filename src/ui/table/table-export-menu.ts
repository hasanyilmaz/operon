import { Menu, Notice } from 'obsidian';
import { t } from '../../core/i18n';
import {
	buildTableCsvFilename,
	buildTableEmbedCode,
	buildTableExportCsvFileContents,
	serializeTableExportCsv,
	serializeTableExportMarkdown,
	type TableExportSource,
} from './table-export';
import type { TablePreset } from '../../types/table';

export interface TableExportMenuOptions {
	anchor: HTMLElement;
	event: MouseEvent;
	preset: Pick<TablePreset, 'id' | 'name'>;
	source: TableExportSource;
}

export function showTableExportMenu(options: TableExportMenuOptions): void {
	const menu = new Menu();
	menu.addItem(item => item
		.setTitle(t('table', 'copyMarkdownTable'))
		.setIcon('table-2')
		.onClick(() => {
			void copyMarkdownTable(options.source);
		}));
	menu.addItem(item => item
		.setTitle(t('table', 'copyCsv'))
		.setIcon('copy')
		.onClick(() => {
			void copyCsv(options.source);
		}));
	menu.addItem(item => item
		.setTitle(t('table', 'exportCsvFile'))
		.setIcon('file-spreadsheet')
		.onClick(() => {
			exportCsvFile(options);
		}));
	menu.addSeparator();
	menu.addItem(item => item
		.setTitle(t('table', 'copyTableEmbedCode'))
		.setIcon('code')
		.onClick(() => {
			void copyTableEmbedCode(options.preset.id);
		}));
	showMenuAtEventOrAnchor(menu, options);
}

async function copyMarkdownTable(source: TableExportSource): Promise<void> {
	if (!hasTableExportRows(source)) {
		new Notice(t('table', 'tableExportEmpty'));
		return;
	}
	try {
		await writeClipboardText(serializeTableExportMarkdown(source));
		new Notice(t('table', 'markdownTableCopied'));
	} catch (error) {
		console.error('Operon: table markdown export copy failed', error);
		new Notice(t('table', 'tableExportFailed'));
	}
}

async function copyCsv(source: TableExportSource): Promise<void> {
	if (!hasTableExportRows(source)) {
		new Notice(t('table', 'tableExportEmpty'));
		return;
	}
	try {
		await writeClipboardText(serializeTableExportCsv(source));
		new Notice(t('table', 'csvCopied'));
	} catch (error) {
		console.error('Operon: table CSV export copy failed', error);
		new Notice(t('table', 'tableExportFailed'));
	}
}

function exportCsvFile(options: TableExportMenuOptions): void {
	if (!hasTableExportRows(options.source)) {
		new Notice(t('table', 'tableExportEmpty'));
		return;
	}
	try {
		const csv = buildTableExportCsvFileContents(options.source);
		const filename = buildTableCsvFilename(options.preset);
		downloadTextFile(options.anchor.ownerDocument, csv, filename, 'text/csv;charset=utf-8');
		new Notice(t('table', 'csvDownloadStarted'));
	} catch (error) {
		console.error('Operon: table CSV file export failed', error);
		new Notice(t('table', 'tableExportFailed'));
	}
}

async function copyTableEmbedCode(presetId: string): Promise<void> {
	try {
		await writeClipboardText(buildTableEmbedCode(presetId));
		new Notice(t('table', 'embedCodeCopied'));
	} catch (error) {
		console.error('Operon: table embed code copy failed', error);
		new Notice(t('table', 'tableExportFailed'));
	}
}

function hasTableExportRows(source: TableExportSource): boolean {
	return source.rows.length > 0;
}

function showMenuAtEventOrAnchor(menu: Menu, options: Pick<TableExportMenuOptions, 'anchor' | 'event'>): void {
	if (hasPointerMenuPosition(options.event)) {
		menu.showAtMouseEvent(options.event);
		return;
	}
	menu.showAtPosition(getMenuAnchorPosition(options.anchor), options.anchor.ownerDocument);
}

function hasPointerMenuPosition(event: MouseEvent): boolean {
	return event.clientX !== 0 || event.clientY !== 0;
}

function getMenuAnchorPosition(anchor: HTMLElement): { x: number; y: number } {
	const rect = anchor.getBoundingClientRect();
	return {
		x: Math.round(rect.left),
		y: Math.round(rect.bottom),
	};
}

async function writeClipboardText(value: string): Promise<void> {
	await navigator.clipboard.writeText(value);
}

function downloadTextFile(ownerDocument: Document, text: string, filename: string, mimeType: string): void {
	const ownerWindow = ownerDocument.defaultView ?? window;
	const blob = new ownerWindow.Blob([text], { type: mimeType });
	const url = ownerWindow.URL.createObjectURL(blob);
	const link = ownerDocument.createElement('a');
	link.href = url;
	link.download = filename;
	link.rel = 'noopener';
	link.hidden = true;
	ownerDocument.body.appendChild(link);
	link.click();
	link.remove();
	ownerWindow.setTimeout(() => {
		ownerWindow.URL.revokeObjectURL(url);
	}, 0);
}
