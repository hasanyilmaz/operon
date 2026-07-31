import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../contracts/v1/canonical';
import {
	sameTaskSourceLocatorV1,
	type TaskSourceLocatorV1,
} from '../contracts/v1/identity';
import type {
	ConversionLossItemV1,
	RelocateInlineTaskSpecV1,
	TimerControlSpecV1,
} from '../contracts/v1/mutation';
import type { StructuredErrorCodeV1 } from '../contracts/v1/primitives';

export type RuntimeMutationGuardResultV1<T> =
	| { ok: true; value: T }
	| {
		ok: false;
		code: StructuredErrorCodeV1;
		reason: string;
	};

export interface RuntimeTimerActiveSnapshotV1 {
	readonly operonId: string | null;
	readonly start: string;
	readonly isUnassigned: boolean;
}

export interface RuntimeTimerControlGuardInputV1 {
	readonly spec: TimerControlSpecV1;
	readonly requestedOperonId: string | null;
	readonly active: RuntimeTimerActiveSnapshotV1 | null;
	readonly targetExists: boolean;
	readonly targetDuplicate: boolean;
}

export interface RuntimeTimerControlGuardV1 {
	readonly targetOperonId: string | null;
	readonly expectedActive: RuntimeTimerActiveSnapshotV1 | null;
	readonly noChange: boolean;
}

/**
 * Seals the active timer compare-and-set material before a canonical TimeTracker
 * operation is invoked. It deliberately does not perform the timer mutation.
 */
export function guardRuntimeTimerControlV1(
	input: RuntimeTimerControlGuardInputV1,
): RuntimeMutationGuardResultV1<RuntimeTimerControlGuardV1> {
	const { spec, requestedOperonId, active } = input;
	if (
		spec.expectedActiveStart !== undefined
		&& active?.start !== spec.expectedActiveStart
	) {
		return failure('stale-source', 'The active timer start changed after it was observed.');
	}
	if (
		spec.operation === 'stop'
		&& requestedOperonId !== null
		&& active?.operonId !== requestedOperonId
	) {
		return failure('stale-source', 'The requested task is not the active timer task.');
	}
	const targetOperonId = spec.operation === 'start'
		? requestedOperonId
		: requestedOperonId ?? active?.operonId ?? null;
	if (spec.operation === 'start' && targetOperonId !== null && !input.targetExists) {
		return failure('entity-not-found', 'The requested timer task does not exist.');
	}
	if (targetOperonId !== null && input.targetDuplicate) {
		return failure('duplicate-operon-id', 'Duplicate operonId instances block timer control.');
	}
	const noChange = spec.operation === 'start'
		? targetOperonId === null
			? active?.isUnassigned === true
			: active?.operonId === targetOperonId && active.isUnassigned === false
		: active === null;
	return {
		ok: true,
		value: {
			targetOperonId,
			expectedActive: active,
			noChange,
		},
	};
}

export interface RuntimeSourceTransitionGroupGuardV1 {
	readonly filePath: string;
	readonly expectedContent: string | null;
	readonly nextContent?: string;
	readonly action: 'create' | 'modify' | 'trash';
}

export interface RuntimeInlineRelocationGuardInputV1 {
	readonly operonId: string;
	readonly currentLocator: Extract<TaskSourceLocatorV1, { representation: 'inline' }>;
	readonly sourceContent: string;
	readonly destinationContent: string;
	readonly spec: RelocateInlineTaskSpecV1;
	readonly parseOperonId: (line: string, lineNumber: number, filePath: string) => string | null;
	readonly attachedCheckboxLineNumbers?: readonly number[];
	readonly attachedCheckboxScopeAmbiguous?: boolean;
}

export interface RuntimeInlineRelocationGuardV1 {
	readonly groups: readonly RuntimeSourceTransitionGroupGuardV1[];
	readonly warnings: readonly { code: string; message: string }[];
	readonly requiredAcknowledgements: readonly string[];
}

export function guardRuntimeInlineRelocationV1(
	input: RuntimeInlineRelocationGuardInputV1,
): RuntimeMutationGuardResultV1<RuntimeInlineRelocationGuardV1> {
	const { spec, currentLocator, sourceContent, destinationContent } = input;
	if (!sameTaskSourceLocatorV1(spec.source.locator, currentLocator)) {
		return failure('stale-source', 'The relocation source locator changed.');
	}
	if (spec.source.sourceRevision.contentDigest !== sha256HexV1(sourceContent)) {
		return failure('stale-source', 'The relocation source content changed.');
	}
	const sameFile = spec.destination.locator.filePath === currentLocator.filePath;
	if (
		spec.destination.sourceRevision.contentDigest
			!== sha256HexV1(sameFile ? sourceContent : destinationContent)
	) {
		return failure('stale-source', 'The relocation destination content changed.');
	}
	if (
		sameFile
		&& spec.destination.locator.lineNumber === currentLocator.lineNumber
	) {
		return failure('invalid-request', 'Relocation source and destination must differ.');
	}
	const sourceLines = sourceContent.split('\n');
	const sourceLine = sourceLines[currentLocator.lineNumber];
	if (
		sourceLine === undefined
		|| sha256HexV1(sourceLine) !== spec.source.lineDigest
		|| input.parseOperonId(
			sourceLine,
			currentLocator.lineNumber,
			currentLocator.filePath,
		) !== input.operonId
	) {
		return failure('stale-source', 'The exact inline task line changed.');
	}
	const destinationLines = (sameFile ? sourceContent : destinationContent).split('\n');
	const destinationLine = destinationLines[spec.destination.locator.lineNumber];
	if (
		destinationLine === undefined
		|| destinationLine.trim() !== ''
		|| sha256HexV1(destinationLine) !== spec.destination.lineDigest
	) {
		return failure('stale-source', 'The exact relocation destination is no longer blank.');
	}
	if (input.attachedCheckboxScopeAmbiguous) {
		return failure(
			'invalid-request',
			'Attached checkbox scope is ambiguous and cannot be relocated automatically.',
		);
	}

	const attached = [...new Set(input.attachedCheckboxLineNumbers ?? [])]
		.sort((left, right) => left - right);
	const warnings: Array<{ code: string; message: string }> = [];
	const requiredAcknowledgements: string[] = [];
	if (attached.length > 0) {
		const digest = sha256HexV1(attached.join(',')).slice(0, 16);
		warnings.push({
			code: 'attached-checkbox-scope-changes',
			message: 'Moving only the Operon task line changes the scope of attached plain checkboxes.',
		});
		requiredAcknowledgements.push(`confirm:relocate-attached-checkboxes:${digest}`);
	}

	if (sameFile) {
		const nextLines = [...sourceLines];
		nextLines[currentLocator.lineNumber] = '';
		nextLines[spec.destination.locator.lineNumber] = sourceLine;
		return {
			ok: true,
			value: {
				groups: [{
					filePath: currentLocator.filePath,
					expectedContent: sourceContent,
					nextContent: nextLines.join('\n'),
					action: 'modify',
				}],
				warnings,
				requiredAcknowledgements,
			},
		};
	}

	const nextDestinationLines = [...destinationLines];
	nextDestinationLines[spec.destination.locator.lineNumber] = sourceLine;
	const nextSourceLines = [...sourceLines];
	nextSourceLines[currentLocator.lineNumber] = '';
	return {
		ok: true,
		value: {
			groups: [{
				filePath: spec.destination.locator.filePath,
				expectedContent: destinationContent,
				nextContent: nextDestinationLines.join('\n'),
				action: 'modify',
			}, {
				filePath: currentLocator.filePath,
				expectedContent: sourceContent,
				nextContent: nextSourceLines.join('\n'),
				action: 'modify',
			}],
			warnings,
			requiredAcknowledgements,
		},
	};
}

export interface RuntimeFileToInlineLossInputV1 {
	readonly sourceContent: string;
	readonly unmanagedFrontmatterKeys: readonly string[];
	readonly reservedFrontmatterKeys?: readonly string[];
	readonly frontmatterRawByKey?: Readonly<Record<string, string>>;
}

export interface RuntimeFileToInlineLossV1 {
	readonly items: readonly ConversionLossItemV1[];
	readonly digest: string;
	readonly warning: { code: string; message: string };
}

/**
 * Produces the exact human-visible loss manifest required before destructive
 * file-to-inline conversion. The caller remains responsible for canonical
 * frontmatter classification.
 */
export function analyzeRuntimeFileToInlineLossV1(
	input: RuntimeFileToInlineLossInputV1,
): RuntimeFileToInlineLossV1 {
	const items: ConversionLossItemV1[] = [];
	const body = bodyAfterFrontmatter(input.sourceContent);
	if (body.trim()) {
		items.push({
			kind: 'body-content',
			digest: sha256HexV1(body),
		});
	}
	const comments = input.sourceContent.match(/<!--[\s\S]*?-->/gu) ?? [];
	if (comments.length > 0) {
		items.push({
			kind: 'html-comments',
			digest: sha256HexV1(comments.join('\n')),
		});
	}
	for (const key of [...new Set(input.unmanagedFrontmatterKeys)].sort()) {
		items.push({
			kind: 'unmanaged-frontmatter',
			key,
			digest: sha256HexV1(input.frontmatterRawByKey?.[key] ?? key),
		});
	}
	for (const key of [...new Set(input.reservedFrontmatterKeys ?? [])].sort()) {
		items.push({
			kind: 'reserved-frontmatter',
			key,
			digest: sha256HexV1(input.frontmatterRawByKey?.[key] ?? key),
		});
	}
	const digest = sha256HexV1(canonicalJsonV1(toJsonValueV1(items)));
	const summary = items.length > 0
		? items.map(item => item.key ? `${item.kind}:${item.key}` : item.kind).join(', ')
		: 'none';
	return {
		items,
		digest,
		warning: {
			code: 'file-to-inline-loss-manifest',
			message: `Content not representable inline: ${summary}. The source file will be moved to trash.`,
		},
	};
}

export interface RuntimeDeleteBlockersV1 {
	readonly activeTimer: boolean;
	readonly activeTracker: boolean;
	readonly childCount: number;
	readonly inboundReferences: readonly string[];
	readonly outboundReferences: readonly string[];
	readonly recurrenceMember: boolean;
	readonly repeatSeriesOwner: boolean;
}

export function guardRuntimeExactDeleteV1(
	blockers: RuntimeDeleteBlockersV1,
): RuntimeMutationGuardResultV1<{ blockerCodes: readonly string[] }> {
	const blockerCodes: string[] = [];
	if (blockers.activeTimer) blockerCodes.push('active-timer');
	if (blockers.activeTracker) blockerCodes.push('active-tracker');
	if (blockers.childCount > 0) blockerCodes.push('child-tasks');
	if (blockers.inboundReferences.length > 0) blockerCodes.push('incoming-references');
	if (blockers.outboundReferences.length > 0) blockerCodes.push('outgoing-references');
	if (blockers.recurrenceMember) blockerCodes.push('recurrence-membership');
	if (blockers.repeatSeriesOwner) blockerCodes.push('repeat-series-owner');
	if (blockerCodes.length > 0) {
		return failure(
			'invalid-request',
			`Exact task deletion is blocked: ${blockerCodes.join(', ')}.`,
		);
	}
	return { ok: true, value: { blockerCodes } };
}

export interface RuntimeSourceTransitionPostflightInputV1 {
	readonly operation: 'relocate-inline' | 'convert' | 'delete';
	readonly operonId: string;
	readonly expectedLocator?: TaskSourceLocatorV1;
	readonly indexedLocator: TaskSourceLocatorV1 | null;
	readonly duplicate: boolean;
	readonly pinned: boolean;
	readonly pinnedCleanupExpected: boolean;
}

export function verifyRuntimeSourceTransitionPostflightV1(
	input: RuntimeSourceTransitionPostflightInputV1,
): boolean {
	if (input.operation === 'delete') {
		return input.indexedLocator === null
			&& (!input.pinnedCleanupExpected || !input.pinned);
	}
	return !input.duplicate
		&& input.expectedLocator !== undefined
		&& input.indexedLocator !== null
		&& sameTaskSourceLocatorV1(input.expectedLocator, input.indexedLocator);
}

export function verifyRuntimeConversionAncestorSourceRevisionsV1(
	filePaths: readonly string[],
	committedRevisions: readonly {
		readonly resourceKind: string;
		readonly resourceKey: string;
		readonly revision: string;
	}[],
	observedContents: Readonly<Record<string, string | null>>,
): boolean {
	for (const filePath of new Set(filePaths)) {
		const committedRevision = committedRevisions.find(resource => (
			resource.resourceKind === 'task-source'
			&& resource.resourceKey === filePath
		))?.revision;
		const content = observedContents[filePath];
		if (
			!committedRevision
			|| content === undefined
			|| content === null
			|| sha256HexV1(content) !== committedRevision
		) return false;
	}
	return true;
}

function bodyAfterFrontmatter(content: string): string {
	const lines = content.split('\n');
	if (lines[0]?.trim() !== '---') return content;
	const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === '---');
	return closingIndex >= 0 ? lines.slice(closingIndex + 1).join('\n') : content;
}

function failure(
	code: StructuredErrorCodeV1,
	reason: string,
): { ok: false; code: StructuredErrorCodeV1; reason: string } {
	return { ok: false, code, reason };
}
