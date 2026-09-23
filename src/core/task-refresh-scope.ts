/** Plugin-internal notifications; an omitted scope remains a full refresh for legacy callers. */
export type TaskRefreshScope = { kind: 'full'; reason: string } | { kind: 'tasks'; taskIds: ReadonlySet<string> };
export function mergeTaskRefreshScopes(previous: TaskRefreshScope | null, next: TaskRefreshScope): TaskRefreshScope {
 if (previous?.kind === 'full') return previous;
 if (next.kind === 'full') return next;
 return { kind: 'tasks', taskIds: new Set([...(previous?.taskIds ?? []), ...next.taskIds]) };
}
