/**
 * Priority definition model for Operon.
 * Priorities are ordered: index 0 = highest importance.
 */

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
