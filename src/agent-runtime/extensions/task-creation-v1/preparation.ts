import { TaskCreationDraft } from '../../../core/task-creation-draft';
import { CreationDraftProperties, type CreationDraftFieldInput, type CreationDraftPropertyContext } from '../../../core/task-creation-draft-properties';
import { prepareCreationTemplate, type CreationTemplateInputs } from '../../../core/task-creation-template';
import { prepareCreationCommit, type PreparedCreationContent } from '../../../core/task-creation-commit';
import type { VaultPropertyValue } from '../../../core/vault-property-codec';
import type { NormalizeTaskFieldPatchOptions } from '../../../core/task-field-patch';
import type { ParsedTask } from '../../../types/fields';
import { canonicalJsonV1, sha256HexV1, toJsonValueV1 } from '../../contracts/v1/canonical';
import type { TaskCreationPolicyV1, TaskCreationTargetV1, TaskCreationTemplateV1 } from './contracts';

export type RoutedCreationSelectionV1 =
 | { ok: true; representation: 'inline' | 'file'; target: TaskCreationTargetV1; templateId: string | null }
 | { ok: false; reason: string };

/** Select intent only. The existing creation services still resolve paths and placement. */
export function selectRoutedCreationV1(policy: TaskCreationPolicyV1, target: TaskCreationTargetV1, template: TaskCreationTemplateV1, parentPlacement = false): RoutedCreationSelectionV1 {
 const representation = target.representation ?? policy.defaultRepresentation;
 let selectedTarget: TaskCreationTargetV1 = target.mode === 'configured-default' ? { ...target, representation } : structuredClone(target);
 if (target.mode === 'configured-default' && representation === 'inline' && !parentPlacement) {
  const mode = policy.inline.configuredSaveMode;
  if (mode === 'active-file' || mode === 'ask-every-time') return { ok: false, reason: 'This destination requires an explicit target file.' };
  if (mode === 'daily-notes' || mode === 'weekly-notes') selectedTarget = { mode: 'periodic-note', representation: 'inline', periodicKind: mode === 'daily-notes' ? 'daily' : 'weekly' };
 }
 if (selectedTarget.mode === 'periodic-note' && !policy.periodic[selectedTarget.periodicKind].available) return { ok: false, reason: `Configured ${selectedTarget.periodicKind} Notes are unavailable.` };
 const templateId = template.mode === 'none' ? null : template.mode === 'selected' ? template.templateId : representation === 'inline' ? policy.templates.defaultInlineId : policy.templates.defaultFileId;
 if (templateId && !policy.templates.candidates.some(candidate => candidate.id === templateId)) return { ok: false, reason: 'The selected creation template is unavailable.' };
 return { ok: true, representation, target: selectedTarget, templateId };
}

export interface RoutedCreationDraftInputV1 {
 representation: 'inline' | 'file';
 title: string;
 properties: CreationDraftPropertyContext;
 template: { id: string; content: string } | null;
 templateInputs: CreationTemplateInputs;
 now: string;
 defaults: readonly CreationDraftFieldInput[];
 parent: readonly CreationDraftFieldInput[];
 surface: readonly CreationDraftFieldInput[];
 explicit: readonly { sourceName: string; value: VaultPropertyValue }[];
}

/** Pure preparation using the same precedence, list merging and codecs as Task Creator. */
export function prepareRoutedCreationDraftV1(input: RoutedCreationDraftInputV1) {
 const properties = structuredClone(input.properties);
 const draft = new TaskCreationDraft(properties);
 draft.replaceSource('default', 'runtime-defaults', input.defaults);
 draft.replaceSource('parent', 'runtime-parent', input.parent);
 draft.replaceSource('surface', 'runtime-target', input.surface);
 const template = input.template ? prepareCreationTemplate({ content: input.template.content, sourceId: input.template.id, revision: 0, clock: { now: input.now }, inputs: input.templateInputs, properties }) : { status: 'empty' as const };
 if (template.status === 'error') throw new Error('Creation template cannot be parsed.');
 if (template.status === 'ready') {
  if (template.diagnostics.some(item => item.reason === 'type-conflict' || item.reason === 'unavailable')) throw new Error('Creation template property types are unavailable or conflicting.');
  if (input.representation === 'file' && template.rawContent.includes('<%')) throw new Error('Templater is not available to Runtime creation.');
  draft.replaceSource('template', template.sourceId, template.fields);
 }
 const catalog = new CreationDraftProperties(properties);
 const seen = new Set<string>();
 for (const field of input.explicit) {
  const property = catalog.resolve(field.sourceName);
  if (seen.has(property.id)) throw new Error('Duplicate explicit creation property.');
  seen.add(property.id);
  draft.setValue(field.sourceName, field.value);
 }
 const snapshot = draft.snapshot();
 if (snapshot.fields.some(field => field.readOnlyReason === 'type-conflict' || field.readOnlyReason === 'unavailable')) throw new Error('Creation property types are unavailable or conflicting.');
 const revision = sha256HexV1(canonicalJsonV1(toJsonValueV1(JSON.parse(JSON.stringify({ representation: input.representation, title: input.title, properties, template: input.template, snapshot, inputs: input.templateInputs, now: input.now })))));
 return {
  revision,
  snapshot,
  compile(identity: { operonId: string; now: string; checkbox?: ParsedTask['checkbox']; allocateId?: () => string }, displayTitleEnabled = false, repeat: NormalizeTaskFieldPatchOptions = {}): PreparedCreationContent {
   return prepareCreationCommit({ createType: input.representation, description: input.title, fileTaskDisplayTitleEnabled: displayTitleEnabled, template, snapshot }, properties, identity, repeat);
  },
 };
}
