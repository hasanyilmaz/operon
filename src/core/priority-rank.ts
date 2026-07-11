/**
 * Shared priority matching + rank helpers.
 *
 * Priority values are matched against the configured priority labels leniently:
 * leading/trailing whitespace is trimmed and case is folded, so `s`, `S`, and `S `
 * all resolve to the same priority (Policy A). This module is the single definition
 * of that convention, used by every priority surface — Filter, Kanban and Table
 * sorting, Kanban swimlanes, priority color, the secondary index, pinned-task
 * ordering, and the settings duplicate-label guard — so they cannot drift apart.
 *
 * `toLowerCase` (not `toLocaleLowerCase`) is intentional: priority labels are plain
 * identifiers, and locale-aware folding would sort the same vault differently across
 * machines (for example Turkish dotted/dotless i).
 */

/** Normalize a priority value for lenient matching (trim + lowercase). */
export function normalizePriorityValue(value: string): string {
	return value.trim().toLowerCase();
}

/**
 * Build a priority label → rank index map (rank 0 = highest importance).
 * Keys are normalized via {@link normalizePriorityValue}; on duplicate normalized
 * labels the last entry wins, matching the previous inline `new Map(...)` construction.
 */
export function buildPriorityRankMap(
	priorities: readonly { label: string }[],
): Map<string, number> {
	return new Map(
		priorities.map((priority, index) => [normalizePriorityValue(priority.label), index] as const),
	);
}
