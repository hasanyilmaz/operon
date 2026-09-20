import { readCanvasTaskReference } from '../ui/canvas-task-node';

/** Optional card metadata; Changed remains an ordinary native group identified by its node ID. */
export interface OperonGroupTracking extends Record<string, unknown> {
 version: 1;
 propertyKey: string;
 changedGroupId?: string;
 observedValue: string;
 suppressedValue?: string;
}
export type GroupTrackingRead = { state: 'absent' } | { state: 'unavailable'; raw: unknown } | { state: 'ready'; value: OperonGroupTracking };
const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === 'string' && !!value.trim();
export function readOperonGroupTracking(node: unknown): GroupTrackingRead {
 if (!record(node) || !('operonGroupTracking' in node)) return { state: 'absent' };
 const raw = node.operonGroupTracking;
 if (!readCanvasTaskReference(node) || !record(raw) || raw.version !== 1 || !text(raw.propertyKey) || ('changedGroupId' in raw && !text(raw.changedGroupId))
  || typeof raw.observedValue !== 'string' || ('suppressedValue' in raw && typeof raw.suppressedValue !== 'string')) return { state: 'unavailable', raw };
 return { state: 'ready', value: { ...raw } as OperonGroupTracking };
}
/** Produces a detached JSON-ready node. Never repairs unsupported metadata or saves a Canvas. */
export function withOperonGroupTracking(node: Record<string, unknown>, tracking: OperonGroupTracking | null): Record<string, unknown> | null {
 if (!readCanvasTaskReference(node) || readOperonGroupTracking(node).state === 'unavailable') return null;
 const copy = structuredClone(node);
 if (tracking === null) { delete copy.operonGroupTracking; return copy; }
 copy.operonGroupTracking = { ...(record(copy.operonGroupTracking) ? copy.operonGroupTracking : {}), ...structuredClone(tracking) };
 if (!('suppressedValue' in tracking)) delete (copy.operonGroupTracking as Record<string, unknown>).suppressedValue;
 if (!('changedGroupId' in tracking)) delete (copy.operonGroupTracking as Record<string, unknown>).changedGroupId;
 return readOperonGroupTracking(copy).state === 'ready' ? copy : null;
}
