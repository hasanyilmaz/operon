import { isRecord } from './unknown-value';

export interface InlineTargetUsage {
	filePath: string;
	count: number;
	lastUsedAt: string;
}
export interface InlineTargetHistory {
	version: 1;
	entries: InlineTargetUsage[];
}
export type InlineTargetDestination =
	| { kind: 'file'; filePath: string; headingKeyword: string }
	| { kind: 'inline-parent'; filePath: string; parentTaskId: string }
	| { kind: 'file-parent'; filePath: string; parentTaskId: string; headingKeyword: string };
export interface InlineTargetOption {
	target: InlineTargetDestination;
	reason: 'active' | 'parent' | 'recent' | 'frequent' | 'other';
}

// These are existing vault filenames, not portable export paths: preserve Unicode normalization.
export function isInlineTargetFilePath(value: string): boolean {
	return value.toLowerCase().endsWith('.md') && !value.startsWith('/') && !value.includes('\\')
		&& !Array.from(value).some(char => (char.codePointAt(0) ?? 0) < 32)
		&& value.split('/').every(segment => segment !== '' && segment !== '.' && segment !== '..');
}

export function readInlineTargetHistory(raw: unknown): InlineTargetHistory | null {
	if (!isRecord(raw) || raw.version !== 1 || !Array.isArray(raw.entries)) return null;
	const entries: InlineTargetUsage[] = [];
	const seen = new Set<string>();
	for (const value of raw.entries as unknown[]) {
		if (!isRecord(value) || typeof value.filePath !== 'string' || !isInlineTargetFilePath(value.filePath)
			|| seen.has(value.filePath) || typeof value.count !== 'number' || !Number.isSafeInteger(value.count) || value.count < 1
			|| typeof value.lastUsedAt !== 'string' || !Number.isFinite(Date.parse(value.lastUsedAt))
			|| new Date(value.lastUsedAt).toISOString() !== value.lastUsedAt) return null;
		seen.add(value.filePath);
		entries.push({ filePath: value.filePath, count: value.count, lastUsedAt: value.lastUsedAt });
	}
	return { version: 1, entries };
}

const comparePath = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const byRecent = (left: InlineTargetUsage, right: InlineTargetUsage): number =>
	Date.parse(right.lastUsedAt) - Date.parse(left.lastUsedAt) || comparePath(left.filePath, right.filePath);

export function rankInlineTaskTargets(input: {
	filePaths: readonly string[];
	activeFilePath?: string | null;
	parent?: Exclude<InlineTargetDestination, { kind: 'file' }> | null;
	headingKeyword: string;
	history: readonly InlineTargetUsage[];
	excludedFilePath?: string | null;
}): InlineTargetOption[] {
	const files = new Set(input.filePaths.filter(path => path !== input.excludedFilePath && isInlineTargetFilePath(path)));
	const history = input.history.filter(entry => files.has(entry.filePath));
	const result: InlineTargetOption[] = [];
	const seen = new Set<string>();
	const add = (target: InlineTargetDestination, reason: InlineTargetOption['reason']): void => {
		if (!files.has(target.filePath)) return;
		const key = JSON.stringify(target.kind === 'inline-parent'
			? [target.filePath, 'parent', target.parentTaskId]
			: [target.filePath, 'heading', target.headingKeyword]);
		if (seen.has(key)) return;
		seen.add(key);
		result.push({ target: { ...target }, reason });
	};
	const addFile = (path: string, reason: InlineTargetOption['reason']) =>
		add({ kind: 'file', filePath: path, headingKeyword: input.headingKeyword }, reason);
	if (input.activeFilePath) addFile(input.activeFilePath, 'active');
	if (input.parent?.parentTaskId.trim()) add(input.parent, 'parent');
	// Pick the last two distinct files before deduplication with higher-priority destinations.
	for (const entry of [...history].sort(byRecent).slice(0, 2)) addFile(entry.filePath, 'recent');
	for (const entry of [...history].sort((a, b) => b.count - a.count || byRecent(a, b))) addFile(entry.filePath, 'frequent');
	for (const path of [...files].sort(comparePath)) addFile(path, 'other');
	return result;
}
