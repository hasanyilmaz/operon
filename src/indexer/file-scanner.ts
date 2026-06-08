/**
 * File-level task scanner for Operon.
 * Scans a single file for inline task lines and YAML frontmatter tasks.
 *
 * Performance: Uses character-level pre-check from Architecture doc Section 4.4.
 * Most non-task lines rejected in < 1 microsecond via charCodeAt checks.
 */

import { App, parseYaml, TFile } from 'obsidian';
import { isValidOperonId } from '../core/id-generator';
import { ParsedTask, PlainCheckboxProgress, TaskLocation } from '../types/fields';
import { KeyMapping } from '../types/settings';
import { buildReverseMapping, readYamlFields } from '../core/yaml-fields';
import { isRecord } from '../core/unknown-value';
import { parseOperonTaskLineCandidate, parsePlainMarkdownCheckboxLine } from '../core/plain-checkbox-lines';

/** Result of scanning a single file */
export interface FileScanResult {
	filePath: string;
	/** Inline tasks found in file body */
	inlineTasks: ParsedTask[];
	/** Non-Operon markdown checkbox progress found in file body */
	plainCheckboxProgress: PlainCheckboxScanResult;
	/** YAML task found in frontmatter (if operonId present) */
	yamlTask: YamlTaskData | null;
	/** File modification time for incremental detection */
	mtime: number;
}

export interface PlainCheckboxScanResult {
	file: PlainCheckboxProgress;
	byInlineTaskId: Record<string, PlainCheckboxProgress>;
}

/** YAML-only task data extracted from frontmatter */
export interface YamlTaskData {
	operonId: string;
	description: string;
	fieldValues: Record<string, string>;
	tags: string[];
	filePath: string;
}

/**
 * Scan a single file for Operon tasks.
 * Extracts both inline task lines and YAML frontmatter tasks.
 *
 * @param app - Obsidian App instance
 * @param file - File to scan
 * @returns FileScanResult with all found tasks
 */
export async function scanFile(app: App, file: TFile): Promise<FileScanResult> {
	return scanFileWithMappings(app, file, []);
}

/**
 * Scan a single file with key mapping support for YAML canonicalization.
 */
export async function scanFileWithMappings(
	app: App,
	file: TFile,
	keyMappings: KeyMapping[],
): Promise<FileScanResult> {
	const filePath = file.path;
	const content = await app.vault.read(file);

	// Scan file body once for Operon inline tasks and non-Operon markdown checkboxes.
	const bodyScan = scanFileBody(content, filePath, keyMappings);

	// Scan YAML frontmatter for operonId
	const yamlTask = scanYamlTask(file, content, filePath, keyMappings);

	return {
		filePath,
		inlineTasks: bodyScan.inlineTasks,
		plainCheckboxProgress: bodyScan.plainCheckboxProgress,
		yamlTask,
		mtime: file.stat.mtime,
	};
}

/**
 * Scan file content for inline task lines.
 * Uses character-level pre-check for performance (Architecture doc Section 4.4).
 *
 * Performance target: 1000-line file in < 1ms.
 */
function scanFileBody(
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
): { inlineTasks: ParsedTask[]; plainCheckboxProgress: PlainCheckboxScanResult } {
	const tasks: ParsedTask[] = [];
	const fileProgress = createPlainCheckboxProgress();
	const byInlineTaskId: Record<string, PlainCheckboxProgress> = {};
	const lines = content.split('\n');
	let inFencedCodeBlock = false;
	let activeInlineTaskId: string | null = null;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Ignore markdown fenced code blocks (``` / ~~~).
		// Task examples in docs should not be indexed/synced as real tasks.
		if (/^\s*```/.test(line) || /^\s*~~~/.test(line)) {
			inFencedCodeBlock = !inFencedCodeBlock;
			continue;
		}
		if (inFencedCodeBlock) continue;

		const task = parseOperonTaskLineCandidate(line, i, filePath, keyMappings);
		if (task) {
			tasks.push(task);
			if (task.operonId) activeInlineTaskId = task.operonId;
			continue;
		}

		const checkbox = parsePlainMarkdownCheckboxLine(line);
		if (!checkbox) continue;

		incrementPlainCheckboxProgress(fileProgress, checkbox.completed);
		if (activeInlineTaskId) {
			incrementPlainCheckboxProgress(
				getOrCreatePlainCheckboxProgress(byInlineTaskId, activeInlineTaskId),
				checkbox.completed,
			);
		}
	}

	return {
		inlineTasks: tasks,
		plainCheckboxProgress: {
			file: fileProgress,
			byInlineTaskId,
		},
	};
}

function createPlainCheckboxProgress(): PlainCheckboxProgress {
	return { total: 0, completed: 0 };
}

function getOrCreatePlainCheckboxProgress(
	byInlineTaskId: Record<string, PlainCheckboxProgress>,
	operonId: string,
): PlainCheckboxProgress {
	const existing = byInlineTaskId[operonId];
	if (existing) return existing;
	const created = createPlainCheckboxProgress();
	byInlineTaskId[operonId] = created;
	return created;
}

function incrementPlainCheckboxProgress(progress: PlainCheckboxProgress, completed: boolean): void {
	progress.total += 1;
	if (completed) progress.completed += 1;
}

/**
 * Scan YAML frontmatter for an Operon task definition.
 * A file is a YAML-only task if its frontmatter contains an operonId field.
 * (Spec Section 23.7)
 */
function scanYamlTask(
	file: TFile,
	content: string,
	filePath: string,
	keyMappings: KeyMapping[],
): YamlTaskData | null {
	const fm = parseFrontmatterFromContent(content);
	if (!fm) return null;
	const reverseMap = buildReverseMapping(keyMappings);
	let operonId: string | null = typeof fm['operonId'] === 'string' ? fm['operonId'] : null;
	if (!operonId) {
		for (const [yamlKey, value] of Object.entries(fm)) {
			const canonicalKey = reverseMap.get(yamlKey) ?? yamlKey;
			if (canonicalKey !== 'operonId' || typeof value !== 'string') continue;
			operonId = value;
			break;
		}
	}
	if (!operonId) return null;
	if (!isValidOperonId(operonId)) return null;

	// YAML file task description always comes from the file basename.
	const description = file.basename;

	// Extract canonicalized field values from frontmatter
	const fieldValues = readYamlFields(fm, keyMappings);
	fieldValues['operonId'] = operonId;

	// YAML tags are first-class task tags, not a sync field key.
	delete fieldValues['tags'];

	const rawTags = fm['tags'];
	let tags: string[] = [];
	if (Array.isArray(rawTags)) {
		tags = rawTags.map(tag => String(tag).trim()).filter(Boolean);
	} else if (typeof rawTags === 'string') {
		tags = rawTags
			.split(/[;,]/)
			.map(tag => tag.trim())
			.filter(Boolean);
	}

	return {
		operonId,
		description,
		fieldValues,
		tags,
		filePath,
	};
}

function parseFrontmatterFromContent(content: string): Record<string, unknown> | null {
	const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
	if (!match) return null;
	try {
		const parsed: unknown = parseYaml(match[1]);
		return isRecord(parsed)
			? parsed
			: null;
	} catch {
		return null;
	}
}

/**
 * Create a TaskLocation for an inline task.
 */
export function inlineLocation(filePath: string, lineNumber: number): TaskLocation {
	return { filePath, lineNumber, format: 'inline' };
}

/**
 * Create a TaskLocation for a YAML task.
 */
export function yamlLocation(filePath: string): TaskLocation {
	return { filePath, lineNumber: 0, format: 'yaml' };
}
