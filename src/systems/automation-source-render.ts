import type { ParsedTask } from '../types/fields';
import type { OperonSettings } from '../types/settings';
import { fileTaskPropertyIdentityMatches, readFileTaskPropertyDocument } from '../core/file-task-property-draft';
import { readParsedInlinePropertyProjection } from '../core/inline-property-source';
import { getManagedYamlAliases } from '../core/yaml-fields';
import { readRawYamlPropertyExpectation } from '../core/raw-yaml-property';
import { planFileTaskPropertyWrite, type PropertyEditorChange } from '../core/property-editor-document';
import { parseTaskLine } from '../core/parser';
import { markdownBodyStartLine } from '../core/markdown-body';
import { iterateMarkdownLinesOutsideFences } from '../core/markdown-fenced-lines';
import type { GuardedTaskSourceFieldUpdate, TaskWriter } from '../core/task-writer';

type Update = GuardedTaskSourceFieldUpdate;

/** A literal in an inline row must still mean the same thing after Markdown parses it. */
function inlineMatches(before: ParsedTask, after: ParsedTask, update: Update, settings: OperonSettings): boolean {
	const fields = update.fieldValues;
	if (after.operonId !== before.operonId || after.description !== (fields._description ?? before.description)
		|| after.checkbox !== (fields._checkbox ?? before.checkbox) || after.timePrefix?.raw !== before.timePrefix?.raw) return false;
	const tags = fields._tags === undefined ? before.tags : fields._tags.split(';').map(tag => tag.trim()).filter(Boolean);
	if (JSON.stringify(after.tags) !== JSON.stringify(tags)) return false;
	const typedKeys = new Set<string>();
	for (const draft of update.inlinePropertyDraft ?? []) {
		const property = readParsedInlinePropertyProjection(after, { [draft.sourceName]: draft.type }, settings.keyMappings, settings.inlinePropertyDefinitions).properties[0];
		if (draft.mutation.kind === 'remove' ? property.state !== 'missing'
			: property.state !== 'valid' || JSON.stringify(property.value) !== JSON.stringify(draft.mutation.value)) return false;
		const mapping = settings.keyMappings.find(item => [item.canonicalKey, item.visiblePropertyName].includes(draft.sourceName));
		typedKeys.add(mapping?.canonicalKey ?? draft.sourceName);
	}
	const byKey = (task: ParsedTask, key: string) => task.fields.filter(field => field.key === key).map(field => field.value);
	const keys = new Set([...before.fields, ...after.fields].map(field => field.key));
	for (const key of Object.keys(fields)) if (!key.startsWith('_')) keys.add(key);
	for (const key of keys) {
		if (typedKeys.has(key)) continue;
		const value = fields[key];
		const expected = value === undefined ? byKey(before, key) : value ? [value] : [];
		if (JSON.stringify(byKey(after, key)) !== JSON.stringify(expected)) return false;
	}
	return true;
}

function renderYaml(path: string, content: string, update: Update, writer: TaskWriter, settings: OperonSettings): string | null {
	const original = readFileTaskPropertyDocument(content);
	if (!original || !fileTaskPropertyIdentityMatches(original.frontmatter, update.operonId, settings.keyMappings)) return null;
	if (!Object.keys(update.fieldValues).length && !update.filePropertyDraft) return content;
	const rendered = writer.renderGuardedTaskSourceContent(path, content, [update]);
	const next = rendered.ok && readFileTaskPropertyDocument(rendered.content);
	if (!next) return null;
	const names = new Set(update.filePropertyDraft?.changes.map(change => change.propertyName));
	for (const key of Object.keys(update.fieldValues)) {
		if (key === '_tags') names.add('tags');
		else if (!key.startsWith('_')) for (const alias of getManagedYamlAliases(key, settings.keyMappings)) names.add(alias);
	}
	const changes: PropertyEditorChange[] = [];
	for (const name of names) {
		const expected = readRawYamlPropertyExpectation(original.frontmatter, name);
		const value = readRawYamlPropertyExpectation(next.frontmatter, name);
		if (!expected || !value) return null;
		if (JSON.stringify(expected) === JSON.stringify(value)) continue;
		changes.push({ name, expected, value: value.value ?? null, remove: !value.present });
	}
	const patch = planFileTaskPropertyWrite(content, settings.keyMappings, changes);
	return patch.status === 'ready' ? patch.text : null;
}

/** Render only the matching source lines and YAML key spans; unrelated Markdown stays byte-exact. */
export function renderAutomationSource(path: string, content: string, updates: Update[], writer: TaskWriter, settings: OperonSettings): string | null {
	const inline = new Map(updates.filter(item => item.format === 'inline').map(item => [item.operonId, item]));
	if (inline.size) {
		const lines = content.split('\n');
		const seen = new Set<string>();
		const start = markdownBodyStartLine(lines);
		if (start === null) return null;
		for (const [offset, line] of iterateMarkdownLinesOutsideFences(lines.slice(start).join('\n'), true)) {
			const index = start + offset;
			const before = parseTaskLine(line, index, path, settings.keyMappings);
			const id = before?.operonId;
			const update = id && inline.get(id);
			if (!before || !id || !update) continue;
			if (seen.has(id) || before.fields.filter(field => field.key === 'operonId').length !== 1) return null;
			seen.add(id);
			if (!Object.keys(update.fieldValues).length && !update.inlinePropertyDraft?.length) continue;
			const rendered = writer.renderGuardedTaskSourceContent(path, line.replace(/\r$/u, ''), [{ ...update, lineNumber: 0 }]);
			if (!rendered.ok || /[\r\n]/u.test(rendered.content)) return null;
			const after = parseTaskLine(rendered.content, index, path, settings.keyMappings);
			if (!after || !inlineMatches(before, after, update, settings)) return null;
			lines[index] = rendered.content + (lines[index].endsWith('\r') ? '\r' : '');
		}
		if (seen.size !== inline.size) return null;
		content = lines.join('\n');
	}
	const yaml = updates.find(item => item.format === 'yaml');
	return yaml ? renderYaml(path, content, yaml, writer, settings) : content;
}
