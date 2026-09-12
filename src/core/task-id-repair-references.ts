import { decodeInlineFieldValue } from './parser';
import { isValidOperonId } from './id-generator';
import type { TablePreset } from '../types/table';

/** Pure transformations only. Only exact task identity fields are changed. */
export class TaskIdReferenceRepair {
	private readonly referenceId: string;

	constructor(readonly previousId: string | null, readonly nextId: string) {
		this.referenceId = previousId?.trim() ?? '';
		if (!isValidOperonId(nextId) || this.matches(nextId)) {
			throw new Error('Invalid task ID repair identities');
		}
	}

	matches(value: string): boolean {
		return !!this.referenceId && (value === this.previousId || value === this.referenceId);
	}

	id(value: string): string {
		if (value === this.nextId) throw new Error('Task ID repair reference collision');
		return this.matches(value) ? this.nextId : value;
	}

	ids(values: readonly string[]): string[] {
		if (values.some(value => this.matches(value)) && values.includes(this.nextId)) {
			throw new Error('Task ID repair reference collision');
		}
		return values.map(value => this.id(value));
	}

	/** Only complete bare list items are IDs; wikilinks and escaped text stay intact. */
	list(value: string, encoding: 'inline' | 'plain' = 'inline'): string {
		if (/[;[\]\r\n]/u.test(this.referenceId) && (encoding === 'inline' ? decodeInlineFieldValue(value) : value).includes(this.referenceId)) {
			throw new Error('Ambiguous task ID list reference');
		}
		const pieces: string[] = [];
		let start = 0;
		let wikiDepth = 0;
		for (let cursor = 0; cursor <= value.length; cursor++) {
			if (cursor + 1 < value.length && value[cursor] === '\\') { cursor++; continue; }
			if (value.startsWith('[[', cursor)) { wikiDepth++; cursor++; continue; }
			if (wikiDepth && value.startsWith(']]', cursor)) { wikiDepth--; cursor++; continue; }
			if (cursor !== value.length && (value[cursor] !== ';' || wikiDepth)) continue;
			const token = value.slice(start, cursor);
			const identity = (encoding === 'inline' ? decodeInlineFieldValue(token) : token).trim();
			if (identity === this.nextId) throw new Error('Task ID repair reference collision');
			pieces.push(this.matches(identity)
				? token.replace(/\S(?:[\s\S]*\S)?/u, this.nextId)
				: token);
			if (cursor < value.length) pieces.push(';');
			start = cursor + 1;
		}
		return pieces.join('');
	}

	table<T extends TablePreset>(table: T): T {
		return {
			...table,
			expandedTaskTreeIds: this.ids(table.expandedTaskTreeIds),
			search: { ...table.search, parent: table.search.parent
				? { ...table.search.parent, parentId: this.id(table.search.parent.parentId) } : null },
		};
	}
}
