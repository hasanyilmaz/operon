export function formatStatusDockSeconds(value: string): string;
export function formatStatusDockSeconds(value: string | null): string | null;
export function formatStatusDockSeconds(value: string | null): string | null {
	return value?.replace(/\b(\d)s$/u, '0$1s') ?? null;
}
