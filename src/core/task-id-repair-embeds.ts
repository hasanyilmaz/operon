import { markdownBodyStartLine } from './markdown-body';
import { iterateMarkdownFencedBlocks } from './markdown-fenced-lines';
import { parseTaskCardEmbed } from '../ui/task-card-embed-model';
import type { TaskIdReferenceRepair } from './task-id-repair-references';

function repairCardSource(source: string, repair: TaskIdReferenceRepair): string {
	const lines = source.split('\n');
	let changed = false;
	for (let index = 0; index < lines.length; index++) {
		const line = lines[index];
		const match = /^(\s*taskid\s*:\s*)(?:"([^"\r\n]*)"|'([^'\r\n]*)'|([^#\r\n]*?))(\s*(?:#[^\n]*)?)$/iu.exec(line);
		if (!match) continue;
		const value = match[2] ?? match[3] ?? match[4].trim();
		const nextId = repair.id(value);
		if (nextId === value) continue;
		const nextValue = match[2] !== undefined ? `"${nextId}"` : match[3] !== undefined ? `'${nextId}'` : nextId;
		lines[index] = match[1] + nextValue + match[5];
		changed = true;
	}
	if (!changed) return source;
	const next = lines.join('\n');
	const parsed = parseTaskCardEmbed(next);
	if (!('options' in parsed) || parsed.options.taskId !== repair.nextId) throw new Error('Ambiguous task card reference');
	return next;
}

/** Only actual operon fences are rewritten, never examples nested in another fence. */
export function repairMarkdownTaskCardReferences(content: string, repair: TaskIdReferenceRepair): string {
	const lines = content.split('\n');
	const bodyStart = markdownBodyStartLine(lines);
	if (bodyStart === null) throw new Error('Unclosed frontmatter prevents task-card reference repair');
	const body = lines.slice(bodyStart).join('\n');
	for (const block of iterateMarkdownFencedBlocks(body)) {
		if (block.info !== 'operon') continue;
		const start = bodyStart + block.contentStartLine;
		const end = bodyStart + block.contentEndLine;
		const source = lines.slice(start, end).map((line, offset) => line.slice(block.contentPrefixes[offset].length)).join('\n');
		const next = repairCardSource(source, repair);
		if (next !== source) lines.splice(start, end - start, ...next.split('\n').map((line, offset) => block.contentPrefixes[offset] + line));
	}
	return lines.join('\n');
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Native Canvas node/edge IDs and arbitrary node text are not task references. */
export function repairCanvasTaskReferences(content: string, repair: TaskIdReferenceRepair): string {
	const root: unknown = JSON.parse(content);
	if (!isRecord(root) || !Array.isArray(root.nodes)) throw new Error('Unsupported Canvas source');
	let changed = false;
	const nodes = root.nodes.map((value: unknown) => {
		if (!isRecord(value) || value.type !== 'text') return value;
		let node = value;
		if (isRecord(value.operonTask) && typeof value.operonTask.taskId === 'string') {
			const previousId = value.operonTask.taskId;
			const nextId = repair.id(previousId);
			if (nextId !== previousId) {
				if (value.operonTask.version !== 1) throw new Error('Unsupported Canvas task reference version');
				node = { ...node, operonTask: { ...value.operonTask, taskId: nextId } };
				if (value.text === `Operon task: ${previousId}`) node.text = `Operon task: ${nextId}`;
			}
		}
		if (typeof node.text === 'string') {
			const text = repairMarkdownTaskCardReferences(node.text, repair);
			if (text !== node.text) node = { ...node, text };
		}
		if (node !== value) changed = true;
		return node;
	});
	if (!changed) return content;
	const indent = /\n([\t ]+)"/u.exec(content)?.[1] ?? '\t';
	return JSON.stringify({ ...root, nodes }, null, indent) + (content.endsWith('\n') ? '\n' : '');
}
