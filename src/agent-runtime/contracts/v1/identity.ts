import { StructuredErrorV1, structuredErrorV1 } from './primitives';

export const OPERON_ID_PATTERN_V1 = /^[a-z0-9]{7}$/;
export const SHA256_HEX_PATTERN_V1 = /^[a-f0-9]{64}$/;

export type OperonIdValidityV1 = 'canonical' | 'legacy-invalid' | 'duplicate';

export interface TaskIdentityV1 {
	operonId: string;
	validity: OperonIdValidityV1;
	mutationAllowed: boolean;
}

export interface InlineTaskSourceLocatorV1 {
	representation: 'inline';
	filePath: string;
	lineNumber: number;
}

export interface FileTaskSourceLocatorV1 {
	representation: 'file';
	filePath: string;
}

export type TaskSourceLocatorV1 = InlineTaskSourceLocatorV1 | FileTaskSourceLocatorV1;

export function sameTaskSourceLocatorV1(
	left: TaskSourceLocatorV1 | null | undefined,
	right: TaskSourceLocatorV1,
): boolean {
	return !!left
		&& left.representation === right.representation
		&& left.filePath === right.filePath
		&& (left.representation === 'file' || left.lineNumber === (right as InlineTaskSourceLocatorV1).lineNumber);
}

export interface SourceRevisionV1 {
	algorithm: 'sha256';
	contentDigest: string;
}

interface IndexRevisionBaseV1 {
	sessionId: string;
	ramGeneration: number;
}

export type DurableIndexRevisionV1 =
	| {
		status: 'available';
		snapshotId: string;
		committedAt: string;
	}
	| {
		status: 'missing' | 'recovery-required' | 'unavailable';
	};

export type IndexRevisionV1 = IndexRevisionBaseV1 & {
	durable: DurableIndexRevisionV1;
};

export interface ContextRevisionV1 {
	index: IndexRevisionV1;
	settingsFingerprint: string;
	pinnedGeneration: number;
	activeTrackerGeneration: number;
	repeatSeriesRevision: number;
	projectSerialGeneration: number;
	projectSerialSignature: string;
}

export interface ResourceRevisionV1 {
	resourceKind: ResourceKindV1;
	resourceKey: string;
	revision: string;
}

export type AffectedResourceRevisionMapV1 = ResourceRevisionV1[];

export const RESOURCE_KINDS_V1 = [
	'timer',
	'repeat-series',
	'active-tracker',
	'pinned',
	'project-serial',
	'task-source',
] as const;

export type ResourceKindV1 = typeof RESOURCE_KINDS_V1[number];

export const RESOURCE_QUEUE_ORDER_V1: Readonly<Record<ResourceKindV1, number>> = Object.freeze({
	timer: 0,
	'repeat-series': 1,
	'active-tracker': 2,
	pinned: 3,
	'project-serial': 4,
	'task-source': 5,
});

export type TaskSelectorV1 =
	| { kind: 'operon-id'; operonId: string }
	| { kind: 'exact-locator'; locator: TaskSourceLocatorV1; expectedOperonId?: string }
	| { kind: 'exact-path'; filePath: string; expectedOperonId?: string }
	| { kind: 'exact-name'; noteName: string; expectedOperonId?: string }
	| { kind: 'search'; query: string; limit?: number };

export interface EntityCandidateV1 {
	identity: TaskIdentityV1;
	description: string;
	locator: TaskSourceLocatorV1;
	confidence: number;
	reasons: string[];
	selector: Extract<TaskSelectorV1, { kind: 'operon-id' | 'exact-locator' }>;
}

export function classifyOperonIdV1(operonId: string, duplicate: boolean = false): TaskIdentityV1 {
	if (duplicate && OPERON_ID_PATTERN_V1.test(operonId)) {
		return { operonId, validity: 'duplicate', mutationAllowed: false };
	}
	const canonical = OPERON_ID_PATTERN_V1.test(operonId);
	return {
		operonId,
		validity: canonical ? 'canonical' : 'legacy-invalid',
		mutationAllowed: canonical,
	};
}

export function validateLocatorLexicallyV1(locator: TaskSourceLocatorV1): StructuredErrorV1 | null {
	const pathError = validateVaultRelativePathV1(locator.filePath);
	if (pathError) return pathError;
	if (locator.representation === 'inline' && (!Number.isSafeInteger(locator.lineNumber) || locator.lineNumber < 0)) {
		return contractError('invalid-locator', 'Inline lineNumber must be a zero-based safe integer.');
	}
	return null;
}

export function validateVaultRelativePathV1(filePath: string): StructuredErrorV1 | null {
	if (filePath.length === 0 || filePath !== filePath.trim()) {
		return contractError('invalid-locator', 'A vault-relative path must be non-empty and trimmed.');
	}
	if (
		filePath.startsWith('/')
		|| filePath.startsWith('\\')
		|| /^[a-zA-Z]:/.test(filePath)
		|| filePath.includes('\\')
		|| filePath.includes('\0')
		|| hasControlCharacter(filePath)
	) {
		return contractError('invalid-locator', 'Absolute, backslash, UNC, drive, or control-character paths are forbidden.');
	}
	const segments = filePath.split('/');
	if (segments.some(segment => segment.length === 0 || segment === '.' || segment === '..')) {
		return contractError('invalid-locator', 'Path traversal and empty segments are forbidden.');
	}
	return null;
}

function hasControlCharacter(value: string): boolean {
	for (let index = 0; index < value.length; index++) {
		const code = value.charCodeAt(index);
		if (code <= 31 || code === 127) return true;
	}
	return false;
}

export function compareResourceRevisionsV1(
	left: AffectedResourceRevisionMapV1,
	right: AffectedResourceRevisionMapV1,
): boolean {
	const normalize = (items: AffectedResourceRevisionMapV1): string[] => items
		.map(item => `${item.resourceKind}\u0000${item.resourceKey}\u0000${item.revision}`)
		.sort();
	const leftItems = normalize(left);
	const rightItems = normalize(right);
	return leftItems.length === rightItems.length && leftItems.every((item, index) => item === rightItems[index]);
}

function contractError(code: StructuredErrorV1['code'], reason: string): StructuredErrorV1 {
	return structuredErrorV1(code, reason);
}
