export interface RuntimeIdentityGraphSourceExpectationV1 {
	readonly expectedState: 'absent' | 'present';
	readonly expectedContent: string | null;
}

export type RuntimeIdentityGraphSourceBeforeContentResultV1 =
	| { readonly ok: true; readonly content: string | null }
	| { readonly ok: false; readonly reason: string };

/** Resolves a sealed task-source before-state without treating render seed content as existence. */
export function resolveRuntimeIdentityGraphSourceBeforeContentV1(
	filePath: string,
	sourceGroup: RuntimeIdentityGraphSourceExpectationV1 | undefined,
	parentSourceContent: string | null,
): RuntimeIdentityGraphSourceBeforeContentResultV1 {
	if (!sourceGroup) return { ok: true, content: parentSourceContent };
	if (sourceGroup.expectedState === 'absent') return { ok: true, content: null };
	if (sourceGroup.expectedContent === null) {
		return { ok: false, reason: `Present source group has no expected content: ${filePath}` };
	}
	return { ok: true, content: sourceGroup.expectedContent };
}
