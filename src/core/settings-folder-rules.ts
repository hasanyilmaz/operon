export function normalizeSettingsFolderPath(value: string | null | undefined): string {
	if (typeof value !== 'string') return '';
	return value.trim().replace(/^\/+|\/+$/g, '');
}

/**
 * Checks the normalized form that can safely be passed to Obsidian as a
 * vault-relative folder path. Callers may intentionally handle an empty value
 * separately as the vault root.
 */
export function isSafeVaultRelativeFolderPath(value: string): boolean {
	if (
		value.length === 0
		|| value !== value.trim()
		|| value.startsWith('/')
		|| value.startsWith('\\')
		|| /^[a-zA-Z]:/u.test(value)
		|| value.includes('\\')
		|| value.includes('\0')
	) return false;
	for (let index = 0; index < value.length; index += 1) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return false;
	}
	return !value.split('/').some(segment => segment.length === 0 || segment === '.' || segment === '..');
}

function isSameOrParentFolder(candidateFolder: string, childFolder: string): boolean {
	const candidate = normalizeSettingsFolderPath(candidateFolder).toLowerCase();
	const child = normalizeSettingsFolderPath(childFolder).toLowerCase();
	if (!candidate || !child) return false;
	return candidate === child || child.startsWith(`${candidate}/`);
}

export function isExcludedFolderConflictWithFileTasksFolder(
	excludedFolderPath: string,
	fileTasksFolder: string,
	pipelineFolders: readonly string[] = [],
): boolean {
	return [fileTasksFolder, ...pipelineFolders]
		.some(folder => isSameOrParentFolder(excludedFolderPath, folder));
}

export function sanitizeExcludedFoldersForFileTasksFolder(
	excludedFolders: string[],
	fileTasksFolder: string,
	pipelineFolders: readonly string[] = [],
): string[] {
	const seen = new Set<string>();
	const folders: string[] = [];
	for (const folder of excludedFolders) {
		const normalized = normalizeSettingsFolderPath(folder);
		if (!normalized) continue;
		if (isExcludedFolderConflictWithFileTasksFolder(normalized, fileTasksFolder, pipelineFolders)) continue;
		const duplicateKey = normalized.toLowerCase();
		if (seen.has(duplicateKey)) continue;
		seen.add(duplicateKey);
		folders.push(normalized);
	}
	return folders;
}

export function getManagedFileTaskFolders(
	fileTasksFolder: string,
	pipelineFolders: readonly string[] = [],
): string[] {
	const folders: string[] = [];
	const seen = new Set<string>();
	for (const candidate of [fileTasksFolder, ...pipelineFolders]) {
		const normalized = normalizeSettingsFolderPath(candidate);
		if (!normalized || seen.has(normalized.toLowerCase())) continue;
		seen.add(normalized.toLowerCase());
		folders.push(normalized);
	}
	return folders;
}
