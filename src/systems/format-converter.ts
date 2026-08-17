/**
 * Format converter for Operon tasks.
 * Converts between inline task lines and YAML-only task files.
 *
 * Spec Section 24:
 * - Inline → YAML: Move task fields to frontmatter, keep description as title
 * - YAML → Inline: Convert frontmatter fields to inline {{key:: value}} format
 */

import { App } from 'obsidian';
import { OperonIndexer } from '../indexer/indexer';
import { ParsedTask } from '../types/fields';
import { CANONICAL_KEY_MAP } from '../types/keys';
import { serializeTask } from '../core/serializer';
import { getManagedTaskFieldType, isManagedTaskFieldCanonicalKey } from '../core/managed-task-fields';
import { OperonSettings } from '../types/settings';
import { t } from '../core/i18n';

export class FormatConverter {
	private app: App;
	private indexer: OperonIndexer;
	private settings: OperonSettings;

	constructor(app: App, indexer: OperonIndexer, settings: OperonSettings) {
		this.app = app;
		this.indexer = indexer;
		this.settings = settings;
	}

	/**
	 * Convert an inline task to a YAML-only task file.
	 * Creates a new .md file with the task's fields in frontmatter.
	 *
	 * Folder resolution (in order):
	 * 1. settings.fileTasksFolder if set → use that folder (create if needed)
	 * 2. fallbackFolder (caller's current file parent) if provided
	 * 3. Vault root
	 *
	 * @param operonId - The task to convert
	 * @param fallbackFolder - Fallback folder if no setting configured
	 * @returns Path to the created file, or null on failure
	 */
	async inlineToYaml(operonId: string, fallbackFolder: string): Promise<string | null> {
		const task = this.indexer.getTask(operonId);
		if (!task) return null;

		// Resolve target folder
		const configuredFolder = this.settings.fileTasksFolder.trim();
		const targetFolder = configuredFolder || fallbackFolder || '';

		// Ensure folder exists (create nested folders if needed)
		if (targetFolder) {
			await this.ensureFolderExists(targetFolder);
		}

		const description = task.description || t('taskEditor', 'untitledTaskFile');
		const fileName = this.sanitizeFileName(description) || t('taskEditor', 'untitledTaskFile');
		const filePath = this.getUniqueFilePath(targetFolder, fileName);

		const content = this.renderInlineToYaml(operonId);
		if (!content) return null;
		await this.app.vault.create(filePath, content);

		return filePath;
	}

	/** Render the canonical YAML representation without touching the vault. */
	renderInlineToYaml(operonId: string): string | null {
		const task = this.indexer.getTask(operonId);
		if (!task) return null;

		const yamlLines: string[] = ['---'];

		// operonId first (identity field)
		yamlLines.push(`operonId: ${task.operonId}`);

		// All field values — skip pseudo-keys, skip 'tags' (handled separately),
		// skip sync:'no' fields, skip 'operonId' (already written above)
		for (const [key, value] of Object.entries(task.fieldValues)) {
			if (key.startsWith('_')) continue;    // Skip pseudo-keys (_description, _tags, _checkbox)
			if (key === 'operonId') continue;
			if (key === 'tags') continue;         // Tags handled via task.tags below
			const def = CANONICAL_KEY_MAP.get(key);
			if (def && def.sync === 'no') continue;

			// Apply key mapping (reverse: canonical → YAML property name)
			const yamlKey = this.getYamlKeyName(key);

			// Handle list values → YAML array
			if (def?.type === 'list' && value.includes(';')) {
				yamlLines.push(`${yamlKey}:`);
				const items = value.split(';').map(s => s.trim()).filter(Boolean);
				for (const item of items) {
					yamlLines.push(`  - ${JSON.stringify(item)}`);
				}
			} else {
				yamlLines.push(`${yamlKey}: ${JSON.stringify(value)}`);
			}
		}

		// Tags — from task.tags (Obsidian native frontmatter tags)
		if (task.tags.length > 0) {
			yamlLines.push('tags:');
			for (const tag of task.tags) {
				yamlLines.push(`  - ${tag}`);
			}
		}

		yamlLines.push('---');
		yamlLines.push('');

		return yamlLines.join('\n');
	}

	/**
	 * Convert a YAML-only task file to an inline task line.
	 * Returns the serialized inline task line.
	 */
	yamlToInline(operonId: string): string | null {
		const task = this.indexer.getTask(operonId);
		if (!task) return null;

		const fields = Object.entries(task.fieldValues)
			.filter(([key]) => isManagedTaskFieldCanonicalKey(key, this.settings.keyMappings))
			.map(([key, value]) => {
				const def = CANONICAL_KEY_MAP.get(key);
				return {
					sourceKey: key,
					key,
					value,
					rawValue: value,
					type: def?.type ?? getManagedTaskFieldType(key, this.settings.keyMappings) ?? 'text',
					isCanonical: !!def,
					containerRange: { from: 0, to: 0 },
					valueRange: { from: 0, to: 0 },
				};
			});

		const parsed: ParsedTask = {
			lineNumber: 0,
			filePath: '',
			checkbox: task.checkbox,
			checkboxRange: { from: 0, to: 0 },
			description: task.description,
			descriptionRange: { from: 0, to: 0 },
			fields,
			tags: task.tags,
			tagTokens: [],
			metadataTailRange: null,
			operonId: task.operonId,
			rawLine: '',
			timePrefix: null,
			timePrefixRange: null,
		};

		// File-task to inline conversion always writes canonical inline keys,
		// regardless of any YAML-visible property mappings. keyMappings is passed
		// only so managed custom keys sort into their configured order; key names
		// stay canonical because each field carries its own sourceKey.
		return serializeTask(parsed, this.settings.keyMappings);
	}

	/**
	 * Get the YAML property name for a canonical key,
	 * applying any user-defined key mappings.
	 */
	private getYamlKeyName(canonicalKey: string): string {
		// Reverse lookup: find a YAML property name that maps to this canonical key
		for (const mapping of this.settings.keyMappings) {
			if (mapping.canonicalKey === canonicalKey) {
				return mapping.visiblePropertyName;
			}
		}
		return canonicalKey;
	}

	/**
	 * Ensure the configured file tasks folder exists. Called on plugin startup.
	 */
	async ensureFileTasksFolder(): Promise<void> {
		const folder = this.settings.fileTasksFolder.trim();
		if (folder) {
			await this.ensureFolderExists(folder);
		}
	}

	/**
	 * Ensure a folder path exists in the vault, creating all intermediate folders.
	 * e.g. "Operon/Synced Tasks" creates "Operon" then "Operon/Synced Tasks".
	 */
	private async ensureFolderExists(folderPath: string): Promise<void> {
		const existing = this.app.vault.getAbstractFileByPath(folderPath);
		if (this.isFolderNode(existing)) return; // Already exists

		// Create each path segment in order
		const parts = folderPath.split('/').filter(Boolean);
		let current = '';
		for (const part of parts) {
			current = current ? `${current}/${part}` : part;
			const node = this.app.vault.getAbstractFileByPath(current);
			if (this.isFolderNode(node)) continue;
			if (node) {
				throw new Error(`Cannot create folder "${current}" because a file exists at this path`);
			}
			try {
				await this.app.vault.createFolder(current);
			} catch (error) {
				// Another process/plugin may create the same folder concurrently.
				const retryNode = this.app.vault.getAbstractFileByPath(current);
				if (this.isFolderNode(retryNode)) continue;
				if (await this.app.vault.adapter.exists(current)) {
					continue;
				}
				throw error;
			}
		}
	}

	private isFolderNode(node: unknown): boolean {
		return !!node && typeof node === 'object' && 'children' in node;
	}

	private sanitizeFileName(name: string): string {
		return name
			.replace(/[\\/:*?"<>|]/g, '')
			.replace(/\s+/g, ' ')
			.trim()
			.substring(0, 100);
	}

	getUniqueFilePath(folderPath: string, baseName: string): string {
		let candidate = folderPath ? `${folderPath}/${baseName}.md` : `${baseName}.md`;
		let i = 1;
		while (this.app.vault.getAbstractFileByPath(candidate)) {
			const suffix = ` (${i})`;
			const trimmedBase = baseName.substring(0, Math.max(1, 100 - suffix.length));
			const nextName = `${trimmedBase}${suffix}`;
			candidate = folderPath ? `${folderPath}/${nextName}.md` : `${nextName}.md`;
			i++;
		}
		return candidate;
	}
}
