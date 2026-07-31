import { sha256HexV1 } from '../../../src/agent-runtime/contracts/v1/canonical';
import type { TaskSourceLocatorV1 } from '../../../src/agent-runtime/contracts/v1/identity';
import type {
	RuntimeSemanticTransitionRecurrencePlanningRequestV1,
	RuntimeSemanticTransitionRecurrencePlanningResultV1,
} from '../../../src/agent-runtime/runtime/semantic-transition';

export interface FixtureRecurrencePlannerOptionsV1 {
	readonly disposition?: 'materialize' | 'ended';
	readonly seriesId?: string;
	readonly nextOperonId?: string;
	readonly nextLocator?: TaskSourceLocatorV1;
	readonly plannedSourceContent?: string;
	readonly occupiedOperonIds?: ReadonlySet<string>;
	readonly occupiedFilePaths?: ReadonlySet<string>;
	readonly endedReason?: 'repeat-end' | 'count-exhausted' | 'no-next-occurrence';
}

/**
 * Deterministic read-only fixture for the live RecurrenceService seam. It
 * demonstrates the required pre-apply output without mutating a vault.
 */
export function createFixtureRecurrencePlannerV1(
	options: FixtureRecurrencePlannerOptionsV1 = {},
): (
	request: RuntimeSemanticTransitionRecurrencePlanningRequestV1,
) => Promise<RuntimeSemanticTransitionRecurrencePlanningResultV1> {
	return async request => {
		const seriesId = options.seriesId
			?? request.sourceTask.fieldValues['repeatSeriesId']
			?? 'fixture-series';
		if (options.disposition === 'ended') {
			return {
				ok: true,
				value: {
					disposition: 'ended',
					seriesId: seriesId || null,
					reason: options.endedReason ?? 'no-next-occurrence',
				},
			};
		}

		const nextOperonId = options.nextOperonId ?? 'nxt0001';
		if (options.occupiedOperonIds?.has(nextOperonId)) {
			return {
				ok: false,
				code: 'duplicate-operon-id',
				reason: `Planned recurrence operonId already exists: ${nextOperonId}.`,
				collision: { kind: 'operon-id', value: nextOperonId },
			};
		}
		const nextLocator = options.nextLocator ?? (
			request.sourceTask.locator.representation === 'inline'
				? {
					representation: 'inline' as const,
					filePath: request.sourceTask.locator.filePath,
					lineNumber: request.sourceTask.locator.lineNumber + 1,
				}
				: {
					representation: 'file' as const,
					filePath: `Recurring/${nextOperonId}.md`,
				}
		);
		const coalescedWithPrimarySource = (
			nextLocator.filePath === request.sourceTask.locator.filePath
		);
		if (
			!coalescedWithPrimarySource
			&& options.occupiedFilePaths?.has(nextLocator.filePath)
		) {
			return {
				ok: false,
				code: 'stale-source',
				reason: `Planned recurrence file path already exists: ${nextLocator.filePath}.`,
				collision: { kind: 'file-path', value: nextLocator.filePath },
			};
		}
		const plannedSourceContent = options.plannedSourceContent
			?? `${request.sourceTask.sourceContent.trimEnd()}\n`
				+ `- [ ] Next occurrence {{operonId:: ${nextOperonId}}}\n`;
		return {
			ok: true,
			value: {
				disposition: 'materialize',
				seriesId: seriesId || 'fixture-series',
				nextOperonId,
				nextLocator,
				plannedSourceContent,
				plannedSourceRevision: sha256HexV1(plannedSourceContent),
				applyExpectedSourceContent: coalescedWithPrimarySource
					? request.sourceTask.sourceContent
					: null,
				sourcePrecondition: coalescedWithPrimarySource
					? { expectedSourceRevision: sha256HexV1(request.sourceTask.sourceContent) }
					: { expectedAbsence: true },
				coalescedWithPrimarySource,
				sourceTaskRetained: true,
			},
		};
	};
}
