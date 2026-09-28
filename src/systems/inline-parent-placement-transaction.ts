import type { InlineParentPlacementWrite } from '../core/inline-task-parent-placement';
import { executePluginUiConversionTransaction } from './plugin-ui-conversion-transaction';

/** Adapter for the existing reversible transaction; the caller holds TaskWriter's permit. */
export async function commitInlineParentPlacementWrites(
	writes: readonly InlineParentPlacementWrite[],
	port: {
		read(path: string): Promise<string>;
		buffersMatch(path: string, content: string): boolean;
		write(path: string, before: string, after: string, guard: () => boolean): Promise<boolean>;
		synchronize(path: string, before: string, after: string): boolean;
		canCommit(): boolean;
	},
): Promise<'committed' | 'rolled-back' | 'outcome-unknown'> {
	return executePluginUiConversionTransaction(writes.map((write, index) => {
		const matches = async (content: string) => await port.read(write.filePath) === content && port.buffersMatch(write.filePath, content);
		const apply = async (before: string, after: string, rollback = false) => {
			if (!rollback) {
				for (const previous of writes.slice(0, index)) {
					if (await port.read(previous.filePath) !== previous.nextContent || !port.buffersMatch(previous.filePath, previous.nextContent)) {
						throw new Error('Inline placement destination changed before source removal.');
					}
				}
			}
			const guard = () => (rollback || (port.canCommit() && writes.slice(0, index)
				.every(previous => port.buffersMatch(previous.filePath, previous.nextContent))))
				&& port.buffersMatch(write.filePath, before);
			if (!await port.write(write.filePath, before, after, guard)) {
				// A lost acknowledgement must be inspected by the existing executor, never replayed.
				throw new Error('Inline parent placement write did not settle.');
			}
			if (!port.synchronize(write.filePath, before, after)) throw new Error('Inline parent placement editor changed during write.');
			return true;
		};
		return {
			isBefore: () => matches(write.expectedContent),
			isAfter: () => matches(write.nextContent),
			apply: () => apply(write.expectedContent, write.nextContent),
			rollback: () => apply(write.nextContent, write.expectedContent, true),
		};
	}), () => port.canCommit());
}
