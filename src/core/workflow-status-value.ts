/** Compose Operon's canonical workflow status value. */
export function composeStatusValue(pipelineName: string, statusLabel: string): string {
	return `${pipelineName}.${statusLabel}`;
}
