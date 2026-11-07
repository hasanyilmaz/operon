/** Small JSON Schema subset shared by the wire validator and public schema generation. */
export interface CreationSchemaV1 {
 type?: 'object' | 'array' | 'string' | 'boolean' | 'null';
 properties?: Record<string, CreationSchemaV1>; required?: string[]; additionalProperties?: false;
 items?: CreationSchemaV1; maxItems?: number; maxLength?: number;
 enum?: readonly unknown[]; const?: unknown; anyOf?: CreationSchemaV1[];
}
export const creationObjectV1 = (properties: Record<string, CreationSchemaV1>): CreationSchemaV1 => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const text: CreationSchemaV1 = { type: 'string', maxLength: 4096 };
const bool: CreationSchemaV1 = { type: 'boolean' };
const nullable = (schema: CreationSchemaV1): CreationSchemaV1 => ({ anyOf: [schema, { type: 'null' }] });
const choices = (...values: string[]): CreationSchemaV1 => ({ type: 'string', enum: values });
const array = (items: CreationSchemaV1, maxItems = 512): CreationSchemaV1 => ({ type: 'array', items, maxItems });
const periodic = (kind: string): CreationSchemaV1 => ({ anyOf: [
 creationObjectV1({ kind: { const: kind }, available: { const: true }, reason: { type: 'null' }, source: choices('operon', 'core-daily-notes'), config: creationObjectV1({ folder: text, format: text, template: text, createAsOperonTask: bool }) }),
 creationObjectV1({ kind: { const: kind }, available: { const: false }, reason: choices('operon-disabled', 'core-daily-notes-unavailable', 'invalid-config'), source: nullable(choices('operon', 'core-daily-notes')), config: { type: 'null' } }),
] });
export const TASK_CREATION_POLICY_SCHEMA_V1 = creationObjectV1({
 defaultRepresentation: choices('inline', 'file'),
 inline: creationObjectV1({ configuredSaveMode: choices('daily-notes', 'weekly-notes', 'specific-file', 'active-file', 'ask-every-time'), saveMode: choices('daily-notes', 'weekly-notes', 'specific-file', 'active-file', 'ask-every-time'), requiresExplicitTarget: bool, targetFile: text, heading: text, parentInline: choices('default', 'below-parent'), parentFile: choices('default', 'inside-parent-file'), parentFileHeading: text, dailyAddsStartDate: bool, dailyAddsScheduledDate: bool }),
 file: creationObjectV1({ folder: text, pipelineLocations: array(creationObjectV1({ pipelineId: text, folder: text })), parentInline: choices('default', 'same-folder'), parentFile: choices('default', 'same-folder'), displayTitleEnabled: bool, titleChangeMode: choices('keep', 'ask', 'auto'), filenameFormat: choices('same', 'kebab', 'snake') }),
 periodic: creationObjectV1({ daily: periodic('daily'), weekly: periodic('weekly') }),
 templates: creationObjectV1({ defaultInlineId: nullable(text), defaultFileId: nullable(text), candidates: array(creationObjectV1({ id: text, name: text, kind: choices('builtin-pipeline-minimal', 'folder'), sourcePath: nullable(text) }), 128), execution: { const: 'deterministic-only' }, inlineContent: { const: 'properties-only' }, remembersLastSelection: { const: false } }),
 exclusions: array(text), limits: creationObjectV1({ tasksPerRequest: { const: 1 }, activeFile: { const: 'explicit-target-required' }, templater: { const: 'not-executed' } }),
});
export function matchesCreationSchemaV1(value: unknown, schema: CreationSchemaV1): boolean {
 if ('const' in schema) return value === schema.const;
 if (schema.anyOf) return schema.anyOf.some(s => matchesCreationSchemaV1(value, s));
 if (schema.enum && !schema.enum.includes(value)) return false;
 if (schema.type === 'null') return value === null;
 if (schema.type === 'string') return typeof value === 'string' && value.length <= (schema.maxLength ?? 4096);
 if (schema.type === 'boolean') return typeof value === 'boolean';
 if (schema.type === 'array') return Array.isArray(value) && value.length <= (schema.maxItems ?? 512) && value.every(item => !!schema.items && matchesCreationSchemaV1(item, schema.items));
 if (schema.type === 'object') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  if (prototype !== null && prototype !== Object.prototype) return false;
  const object = value as Record<string, unknown>, properties = schema.properties ?? {};
  return (schema.required ?? []).every(key => Object.prototype.hasOwnProperty.call(object, key)) && Reflect.ownKeys(object).every(key => typeof key === 'string' && Object.prototype.hasOwnProperty.call(properties, key) && matchesCreationSchemaV1(object[key], properties[key]));
 }
 return false;
}
