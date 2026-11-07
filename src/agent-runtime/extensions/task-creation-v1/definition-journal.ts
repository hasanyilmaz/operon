import type { KeyMapping } from '../../../types/settings';
import { resolveInlinePropertyDefinition, validateInlinePropertyDefinitions, type InlinePropertyDefinition, type InlinePropertyDefinitions } from '../../../core/inline-property-definitions';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import type { GraphTransactionJournalStepV1, GraphTransactionResourceStateV1 } from '../../runtime/receipts/graph-transaction-journal';
import { isRecord } from '../../../core/unknown-value';

const RESOURCE = 'creation-inline-property-definitions';
const normalize = (name: string): string => name.trim().toLowerCase();
function state(value: unknown): GraphTransactionResourceStateV1 {
 const content = canonicalJsonV1(toJsonValueV1(value));
 return { state: 'present', content, digest: sha256HexV1(content) };
}
interface Projection { mappings: KeyMapping[]; entries: Array<{ sourceName: string; definition: InlinePropertyDefinition | null }> }
function projection(names: readonly string[], mappings: readonly KeyMapping[], definitions: InlinePropertyDefinitions | undefined): Projection {
 if (definitions) validateInlinePropertyDefinitions(definitions);
 return { mappings: structuredClone([...mappings]), entries: names.map(sourceName => ({ sourceName, definition: definitions?.entries.find(entry => normalize(entry.sourceName) === normalize(sourceName)) ?? null })) };
}
/** A selective preimage: unrelated settings and property definitions are never restored. */
export function prepareCreationDefinitionStepV1(entries: readonly InlinePropertyDefinition[], mappings: readonly KeyMapping[], definitions: InlinePropertyDefinitions | undefined, groupId: string): GraphTransactionJournalStepV1 | null {
 validateInlinePropertyDefinitions({ version: 1, entries: [...entries] });
 const unique = [...new Map(entries.map(entry => [normalize(entry.sourceName), entry])).values()].sort((a,b) => a.sourceName < b.sourceName ? -1 : a.sourceName > b.sourceName ? 1 : 0);
 for (const entry of unique) {
  const resolved = resolveInlinePropertyDefinition(entry.sourceName, entry.type, mappings, definitions);
  if (resolved.encoding !== entry.encoding) throw new Error('Native property interpretation changed.');
 }
 const before = projection(unique.map(entry => entry.sourceName), mappings, definitions);
 const after: Projection = { mappings: before.mappings, entries: before.entries.map((entry,index) => ({ ...entry, definition: entry.definition ?? unique[index] })) };
 if (JSON.stringify(before) === JSON.stringify(after)) return null;
 return { stepId: RESOURCE, groupId, resourceKind: 'inline-property-definitions', resourceKey: RESOURCE, operation: 'modify', before: state(before), after: state(after) };
}
/** Journals are untrusted recovery inputs, including after a process restart. */
function decode(step: GraphTransactionJournalStepV1): { before: Projection; after: Projection } {
 if (step.resourceKind !== 'inline-property-definitions' || step.resourceKey !== RESOURCE || step.operation !== 'modify') throw new Error('Invalid definition journal resource.');
 const read = (value: GraphTransactionResourceStateV1): Projection => {
  if (value.state !== 'present' || value.content === null || sha256HexV1(value.content) !== value.digest) throw new Error('Invalid definition journal state.');
  const parsed: unknown = JSON.parse(value.content);
  if (!isRecord(parsed) || Object.keys(parsed).some(key => key !== 'mappings' && key !== 'entries') || !Array.isArray(parsed.mappings) || !Array.isArray(parsed.entries)) throw new Error('Invalid definition projection.');
  for (const entry of parsed.entries) {
   if (!isRecord(entry) || Object.keys(entry).some(key => key !== 'sourceName' && key !== 'definition') || typeof entry.sourceName !== 'string' || !entry.sourceName.trim()) throw new Error('Invalid definition name.');
   if (entry.definition !== null) {
    validateInlinePropertyDefinitions({ version: 1, entries: [entry.definition] });
    if (normalize(entry.sourceName) !== normalize((entry.definition as InlinePropertyDefinition).sourceName)) throw new Error('Definition name mismatch.');
   }
  }
  return parsed as unknown as Projection;
 };
 const before = read(step.before), after = read(step.after);
 if (canonicalJsonV1(toJsonValueV1(before.mappings)) !== canonicalJsonV1(toJsonValueV1(after.mappings)) || before.entries.length !== after.entries.length || !after.entries.length || new Set(after.entries.map(entry => normalize(entry.sourceName))).size !== after.entries.length) throw new Error('Invalid definition transition.');
 for (let index = 0; index < before.entries.length; index++) {
  const previous = before.entries[index], next = after.entries[index];
  if (previous.sourceName !== next.sourceName || next.definition === null || previous.definition !== null && JSON.stringify(previous.definition) !== JSON.stringify(next.definition)) throw new Error('Definition removal or reinterpretation is forbidden.');
 }
 return { before, after };
}
export interface CreationDefinitionJournalPortsV1 {
 mappings(): readonly KeyMapping[];
 definitions(): InlinePropertyDefinitions | undefined;
 register(entries: readonly InlinePropertyDefinition[], canCommit: () => boolean): Promise<unknown>;
}
export function readCreationDefinitionStateV1(step: GraphTransactionJournalStepV1, ports: CreationDefinitionJournalPortsV1): GraphTransactionResourceStateV1 {
 const sealed = decode(step);
 return state(projection(sealed.after.entries.map(entry => entry.sourceName), ports.mappings(), ports.definitions()));
}
export function creationDefinitionStatesMatchV1(actual: GraphTransactionResourceStateV1, expected: GraphTransactionResourceStateV1): boolean {
 return actual.state === expected.state && actual.digest === expected.digest && actual.content === expected.content;
}
export async function applyCreationDefinitionStepV1(step: GraphTransactionJournalStepV1, ports: CreationDefinitionJournalPortsV1): Promise<boolean> {
 const sealed = decode(step);
 const current = () => readCreationDefinitionStateV1(step, ports);
 if (creationDefinitionStatesMatchV1(current(), step.after)) return true;
 const canCommit = () => creationDefinitionStatesMatchV1(current(), step.before);
 if (!canCommit()) return false;
 const entries = sealed.after.entries.map(entry => entry.definition!);
 // The shared settings queue and package CAS own the actual write. No raw data.json write.
 await ports.register(entries, canCommit);
 return creationDefinitionStatesMatchV1(current(), step.after);
}
/** Retention is intentional: notes created concurrently may already use these definitions. */
export function verifyRetainedCreationDefinitionsV1(step: GraphTransactionJournalStepV1, ports: CreationDefinitionJournalPortsV1): boolean {
 const current = readCreationDefinitionStateV1(step, ports);
 return creationDefinitionStatesMatchV1(current, step.before) || creationDefinitionStatesMatchV1(current, step.after);
}
