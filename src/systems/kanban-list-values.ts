import { serializeTaskListValue } from '../core/subtask-inheritance';
import { parseListValue } from '../core/parser';
import { decodeVaultPropertyList, encodeVaultPropertyValue } from '../core/vault-property-codec';
import { resolveInlinePropertyDefinition, type InlinePropertyDefinitions } from '../core/inline-property-definitions';
import type { KeyMapping } from '../types/settings';
export function kanbanListIsTyped(mapping: KeyMapping | undefined, mappings: readonly KeyMapping[], definitions?: InlinePropertyDefinitions): boolean {
 return !!mapping && resolveInlinePropertyDefinition(mapping.visiblePropertyName, 'list', mappings, definitions).encoding === 'vault-v1';
}
export function kanbanListLaneKeys(raw: string, typed: boolean): string[] {
 return typed ? decodeVaultPropertyList(raw).map(value => encodeVaultPropertyValue([value], 'list')) : parseListValue(raw);
}
export function addKanbanListLane(raw: string, lane: string, typed: boolean): string {
 if (typed) {
  const added = decodeVaultPropertyList(lane);
  if (added.length !== 1) throw new Error('Invalid typed list lane');
  const values = new Map([...decodeVaultPropertyList(raw), ...added].map(value => [JSON.stringify([typeof value, value]), value]));
  return encodeVaultPropertyValue([...values.values()], 'list');
 }
 return serializeTaskListValue([...new Set([...parseListValue(raw), lane])]);
}
