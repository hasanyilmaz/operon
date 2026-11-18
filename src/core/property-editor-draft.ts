import type { PropertyEditorChange, PropertyEditorDocument } from './property-editor-document';
import { isEmptyFilePropertyValue, rawYamlPropertyExpectationsEqual, readRawYamlPropertyExpectation, type RawYamlPropertyExpectation, type RawYamlPropertyValue } from './raw-yaml-property';

export class PropertyEditorDraft {
 private readonly pending = new Map<string, PropertyEditorChange>();
 constructor(private source: PropertyEditorDocument) {}

 get edited(): boolean { return this.pending.size > 0; }
 snapshot(): PropertyEditorChange[] { return [...this.pending.values()]; }

 get properties(): PropertyEditorDocument {
  if (!this.edited) return this.source;
  const frontmatter = Object.assign(Object.create(null) as Record<string, unknown>, this.source.frontmatter);
  const order = [...this.source.order];
  for (const { name, value, remove } of this.pending.values()) {
   if (remove) { delete frontmatter[name]; const index = order.indexOf(name); if (index >= 0) order.splice(index, 1); continue; }
   if (!order.includes(name)) order.push(name);
   frontmatter[name] = value;
  }
  return { ...this.source, frontmatter, order };
 }

 set(name: string, value: RawYamlPropertyValue, saving: boolean, pickerBaseline?: RawYamlPropertyExpectation): boolean {
  const existing = this.pending.get(name);
  const expected = existing?.expected ?? pickerBaseline ?? readRawYamlPropertyExpectation(this.source.frontmatter, name);
  if (!expected) return false;
  const next = { present: true, value };
  const current = existing ? { present: !existing.remove, value: existing.remove ? null : existing.value } : expected;
  if (rawYamlPropertyExpectationsEqual(current, next)) return false;
  if (!saving && (rawYamlPropertyExpectationsEqual(expected, next) || !expected.present && isEmptyFilePropertyValue(value))) this.pending.delete(name);
  else this.pending.set(name, { name, expected, value: Array.isArray(value) ? [...value] : value });
  return true;
 }

 remove(name: string, saving: boolean): boolean {
  const current = readRawYamlPropertyExpectation(this.properties.frontmatter, name);
  if (!current?.present || !isEmptyFilePropertyValue(current.value)) return false;
  const expected = this.pending.get(name)?.expected ?? readRawYamlPropertyExpectation(this.source.frontmatter, name);
  if (!expected) return false;
  if (!saving && !expected.present) this.pending.delete(name);
  else this.pending.set(name, { name, expected, value: null, remove: true });
  return true;
 }

 refresh(source: PropertyEditorDocument): void { this.source = source; }

 acknowledge(source: PropertyEditorDocument, sent: readonly PropertyEditorChange[]): void {
  this.refresh(source);
  for (const change of sent) {
   const current = this.pending.get(change.name);
   if (!current) continue;
   const committed = readRawYamlPropertyExpectation(source.frontmatter, change.name);
   if (current === change || committed && rawYamlPropertyExpectationsEqual(committed, { present: !current.remove, value: current.remove ? null : current.value })) this.pending.delete(change.name);
   else if (committed) this.pending.set(change.name, { ...current, expected: committed });
  }
 }

 discard(): void { this.pending.clear(); }
}
