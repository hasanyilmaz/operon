import type { CanonicalCreationMaterializer } from '../../../core/task-creation-domain';
import { CreationDraftProperties, type CreationDraftPropertyContext } from '../../../core/task-creation-draft-properties';
import type { CreationTemplateInputs } from '../../../core/task-creation-template';
import type { InlinePropertyDefinition } from '../../../core/inline-property-definitions';
import type { VaultPropertyValue } from '../../../core/vault-property-codec';
import type { CreateFieldItemV1 } from '../../contracts/v1/mutation';
import { prepareRoutedCreationDraftV1 } from './preparation';

export interface RoutedCreationMaterializerInputV1 {
 properties: CreationDraftPropertyContext;
 template: { id: string; content: string } | null;
 templateInputs: CreationTemplateInputs;
 explicitFields: readonly CreateFieldItemV1[];
 explicitStatus: boolean;
 explicitPriority: boolean;
 explicitTags: boolean;
 nativeProperties: readonly { sourceName: string; value: VaultPropertyValue }[];
 displayTitleEnabled: boolean;
 generateId(): string;
 existingIds: ReadonlySet<string>;
 sealedAllocations?: readonly string[];
}
/** Shared Creator material, replayable across the adapter's path/recurrence preparation passes. */
export function createRoutedCreationMaterializerV1(input: RoutedCreationMaterializerInputV1) {
 const allocations = [...(input.sealedAllocations ?? [])];
 const catalog = new CreationDraftProperties(input.properties);
 for(const property of input.nativeProperties) if(catalog.resolve(property.sourceName).interpretation!=='native') throw new Error('Native properties cannot override managed fields.');
 const explicitKeys = new Set(input.explicitFields.flatMap(field => 'field' in field ? [field.field] : []));
 if (input.explicitStatus) explicitKeys.add('status');
 if (input.explicitPriority) explicitKeys.add('priority');
 let definitions: InlinePropertyDefinition[] = [], skipped: Array<{sourceName:string;reason:string}> = [];
 let revision = '';
 let nativeProperties:Array<{sourceName:string;value:VaultPropertyValue}>=[];
 const typed = (sourceName: string, value: unknown): VaultPropertyValue => {
  const read = catalog.read(catalog.resolve(sourceName), value);
  if (read.readOnlyReason || read.value === undefined) throw new Error(`Creation value cannot be verified: ${sourceName}`);
  return read.value;
 };
 const prepareMaterial: CanonicalCreationMaterializer = (item, context) => {
  let allocationIndex = 0;
  const allocateId = () => {
   const index = allocationIndex++;
   if (allocations[index]) {
    if (input.existingIds.has(allocations[index]) || allocations[index] === context.operonId) throw new Error('A sealed template identity is occupied.');
    return allocations[index];
   }
   if (input.sealedAllocations) throw new Error('Template identity allocation changed.');
   for (let attempt=0;attempt<100;attempt++) {
    const id=input.generateId();
    if (/^[a-z0-9]{7}$/u.test(id) && id!==context.operonId && !input.existingIds.has(id) && !allocations.includes(id)) { allocations.push(id); return id; }
   }
   throw new Error('Unable to allocate a template identity.');
  };
  const fields = Object.entries(item.fields ?? {});
  const draft = prepareRoutedCreationDraftV1({ representation: item.target.representation, title:item.description,
   properties: input.properties, template: input.template, templateInputs:input.templateInputs, now:context.now,
   defaults: [], parent:[...Object.entries(context.inheritedFields).map(([sourceName,value])=>({sourceName,value})),{sourceName:'tags',value:[...context.inheritedTags]}],
   surface:fields.filter(([key])=>!explicitKeys.has(key)).map(([sourceName,value])=>({sourceName,value})),
   explicit:[...fields.filter(([key])=>explicitKeys.has(key)).map(([sourceName,value])=>({sourceName,value:typed(sourceName,value)})),
    ...(input.explicitTags ? [{sourceName:'tags',value:[...(item.tags??[])]}] : []), ...input.nativeProperties],
  });
  const compiled=draft.compile({operonId:context.operonId,now:context.now,allocateId},input.displayTitleEnabled,{deferRepeatIdentity:true});
  if (input.sealedAllocations && allocationIndex !== input.sealedAllocations.length) throw new Error('Template identity allocation count changed.');
  const fieldValues={...compiled.fieldValues};
  // Identity and graph edges belong to the canonical planner, never a template property.
  const graphFields=['operonId','datetimeCreated','datetimeModified','parentTask','related','blocking','blockedBy'];
  skipped=[...compiled.skipped];
  for(const key of graphFields) {
   if (['parentTask','related','blocking','blockedBy'].includes(key) && fieldValues[key] && fieldValues[key]!==context.inheritedFields[key]) skipped.push({sourceName:key,reason:'explicit-relationship-required'});
   delete fieldValues[key];
  }
  definitions=item.target.representation==='inline' ? compiled.definitions : [];
  revision=draft.revision;nativeProperties=compiled.nativeProperties;
  return {fields:fieldValues,tags:compiled.tags,
   ...(item.target.representation==='inline' ? {decorateInlineLine:compiled.decorateInlineLine} : {fileTemplateContent:compiled.fileContent(undefined,['parentTask','related','blocking','blockedBy']),templateIdentityAllocations:compiled.templateIdentityAllocations}),
  };
 };
 return { prepareMaterial, evidence:()=>({ revision, nativeProperties:structuredClone(nativeProperties), allocations:[...allocations], definitions:structuredClone(definitions), skipped:structuredClone(skipped) }) };
}
