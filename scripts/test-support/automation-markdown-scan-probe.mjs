import { iterateMarkdownLinesOutsideFences as scan } from '../../src/core/markdown-fenced-lines.ts';
export * from '../../src/core/markdown-fenced-lines.ts';

// Count visits to the marked note body. Single-row serialization uses the same scanner.
let prefix, visits;
export async function countNoteScans(bodyPrefix, run) {
	prefix = bodyPrefix;
	visits = 0;
	try {
		const result = await run();
		return { result, scans: visits };
	} finally {
		prefix = undefined;
	}
}

export function* iterateMarkdownLinesOutsideFences(content, ...options) {
	if (prefix && content.startsWith(prefix)) visits++;
	yield* scan(content, ...options);
}
