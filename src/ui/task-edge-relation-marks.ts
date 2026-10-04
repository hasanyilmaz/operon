import type { IndexedTaskSnapshot } from '../indexer/indexer';
import type { OperonSettings } from '../types/settings';
import { edgeRelationship, type EdgeRelationKind } from '../systems/canvas-edge-relations';
import { resolveBlockedByVisualState, resolveBlockedByVisualStateColor } from '../core/blocked-by-visual-state';
import { taskEdgeRelationIcon } from './task-edge-relation-controls';

export interface TaskRelationMark {
 key: EdgeRelationKind | 'blockedBy'; atSource: boolean; color: string | null; icon: string; fraction: number;
}

/** Fractions of the full route; paired marks separate toward their shared endpoint. */
export function taskRelationSlot(atSource: boolean, paired: boolean, index: number): number {
 if (!paired) return atSource ? .25 : .75;
 return atSource ? (index === 0 ? .35 : .2) : (index === 0 ? .65 : .8);
}

/** Read-only presentation policy shared by Canvas and Excalidraw. */
export function taskRelationMarks(a: IndexedTaskSnapshot, b: IndexedTaskSnapshot,
 settings: Pick<OperonSettings, 'keyMappings' | 'pipelines'>): TaskRelationMark[] {
 const marks: Omit<TaskRelationMark, 'icon' | 'fraction'>[] = [];
 if (edgeRelationship(a, b, 'parentTask')) marks.push({ key: 'parentTask', atSource: true, color: null });
 else if (edgeRelationship(b, a, 'parentTask')) marks.push({ key: 'parentTask', atSource: false, color: null });
 const forward = edgeRelationship(a, b, 'blocking'), reverse = edgeRelationship(b, a, 'blocking');
 if (forward || reverse) {
  const task = forward ? a : b;
  const state = resolveBlockedByVisualState({ ...task, tags: [...task.tags] }, settings.pipelines);
  marks.push({ key: state === 'resolved' ? 'blockedBy' : 'blocking', atSource: forward, color: resolveBlockedByVisualStateColor(state) });
 }
 const paired = marks.length === 2 && marks[0].atSource === marks[1].atSource;
 return marks.map((mark, index) => ({ ...mark, icon: taskEdgeRelationIcon(mark.key, settings.keyMappings),
  fraction: taskRelationSlot(mark.atSource, paired, index) }));
}
