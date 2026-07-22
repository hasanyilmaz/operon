import { normalizePath, TFile } from 'obsidian';
import type { App } from 'obsidian';
import { openExternalUrl } from './external-link-actions';

export function isOperonDocsTarget(target: string): boolean {
	return /^DOCS-\d{3}\s+/u.test(normalizeDocsTarget(target));
}

export interface OperonDocsTargetLabel {
	documentId: string | null;
	documentTitle: string;
}

export function parseOperonDocsTargetLabel(target: string): OperonDocsTargetLabel {
	const normalizedTarget = normalizeDocsTarget(target);
	const match = /^(DOCS-\d{3})\s+(.+)$/u.exec(normalizedTarget);
	if (!match) {
		return { documentId: null, documentTitle: normalizedTarget };
	}
	return { documentId: match[1], documentTitle: match[2] };
}

export async function openOperonDocsTarget(app: App, target: string, docsFolder: string): Promise<void> {
	const normalizedTarget = normalizeDocsTarget(target);
	const localFile = getLocalOperonDocsFile(app, normalizedTarget, docsFolder);
	if (localFile) {
		await app.workspace.getLeaf(false).openFile(localFile);
		return;
	}

	openExternalUrl(buildOperonDocsFallbackUrl(normalizedTarget));
}

function normalizeDocsTarget(target: string): string {
	return target.trim().replace(/\.md$/iu, '').trim();
}

function getLocalOperonDocsFile(app: App, target: string, docsFolder: string): TFile | null {
	const filePath = normalizePath(`${docsFolder}/${target}.md`);
	const file = app.vault.getAbstractFileByPath(filePath);
	return file instanceof TFile ? file : null;
}

function buildOperonDocsFallbackUrl(target: string): string {
	const slug = target
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/gu, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/gu, '-')
		.replace(/^-+|-+$/gu, '');
	return `https://operon.cc/docs/${slug}/`;
}
