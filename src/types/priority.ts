/**
 * Priority definition model for Operon.
 * Priorities are ordered: index 0 = highest importance.
 */

import { normalizeTaskIconValue } from '../core/task-icon-value';

export interface PriorityDefinition {
	/** Internal stable priority id used for settings-side rename matching */
	id: string;
	/** Priority label used in task fields (e.g. "highest", "high") */
	label: string;
	/** Display color for priority chips (hex) */
	color: string;
	/** Optional human/agent guidance for when this priority should be used */
	description?: string;
	/** Optional icon used by priority-aware task icon displays */
	priorityIcon?: string;
}

export function createPriorityId(): string {
	return `pr_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

export function clonePriorityDefinition(priority: PriorityDefinition): PriorityDefinition {
	return { ...priority };
}

const DEFAULT_PRIORITY_COLOR = '#6b7280';

/** Repair hand-edited or sync-conflicted priority arrays before settings hydration. */
export function sanitizePriorityDefinitions(rawPriorities: unknown): PriorityDefinition[] {
	if (!Array.isArray(rawPriorities)) return [];
	const result: PriorityDefinition[] = [];
	const usedIds = new Set<string>();
	const usedLabelKeys = new Set<string>();
	for (const [index, entry] of rawPriorities.entries()) {
		if (!entry || typeof entry !== 'object') continue;
		const candidate = entry as Partial<PriorityDefinition>;
		const label = typeof candidate.label === 'string' ? candidate.label.trim() : '';
		if (!label) continue;

		const normalizedLabel = label.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
		let id = typeof candidate.id === 'string' && candidate.id.trim()
			? candidate.id.trim()
			: normalizedLabel ? `pr_${normalizedLabel}` : `pr_legacy_${index}`;
		while (usedIds.has(id)) id = createPriorityId();

		let uniqueLabel = label;
		let suffix = 2;
		while (usedLabelKeys.has(uniqueLabel.trim().toLowerCase())) {
			uniqueLabel = `${label} ${suffix}`;
			suffix += 1;
		}

		const color = typeof candidate.color === 'string' && candidate.color.trim()
			? candidate.color.trim()
			: DEFAULT_PRIORITY_COLOR;
		const priority: PriorityDefinition = { id, label: uniqueLabel, color };
		if (typeof candidate.description === 'string' && candidate.description.trim()) {
			priority.description = candidate.description.trim();
		}
		const priorityIcon = normalizeTaskIconValue(
			typeof candidate.priorityIcon === 'string' ? candidate.priorityIcon : '',
		);
		if (priorityIcon) {
			priority.priorityIcon = priorityIcon;
		}
		usedIds.add(id);
		usedLabelKeys.add(uniqueLabel.trim().toLowerCase());
		result.push(priority);
	}
	return result;
}

/** Default priority configuration (highest importance first) */
export const DEFAULT_PRIORITIES: PriorityDefinition[] = [
	{ id: 'pr_s', label: 'S', color: '#e41a1b', description: 'Highest-impact or urgent work. Use when delay creates meaningful cost, blocks a release, or affects users now.' },
	{ id: 'pr_a', label: 'A', color: '#ff7124', description: 'Important committed work. Use when humans and agents should plan or execute it soon.' },
	{ id: 'pr_b', label: 'B', color: '#a1b752', description: 'Valuable planned work. Use when it matters, but can follow S and A priorities.' },
	{ id: 'pr_c', label: 'C', color: '#3f84a8', description: 'Normal operational work. Use for useful tasks without urgent timing or high leverage.' },
	{ id: 'pr_d', label: 'D', color: '#0e6175', description: 'Low-priority maintenance or cleanup. Use when helpful, but easy to defer.' },
	{ id: 'pr_e', label: 'E', color: '#024959', description: 'Backlog or someday work. Use when worth keeping, but not actively planned.' },
	{ id: 'pr_f', label: 'F', color: '#504e4e', description: 'Lowest-priority or reference work. Use for parked, optional, or administrative tasks with no current pressure.' },
];
