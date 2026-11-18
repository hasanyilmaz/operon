export function normalizeTaskIconValue(value: string | null | undefined): string {
	if (typeof value !== 'string') return '';
	const trimmed = value.trim();
	if (!trimmed) return '';
	if (trimmed.slice(0, 'lucide-'.length).toLowerCase() === 'lucide-') {
		return trimmed.slice('lucide-'.length).trim();
	}
	return trimmed;
}

export function vaultPropertyIconKey(name: string): string {
	return name.trim().toLowerCase();
}

export function normalizeVaultPropertyIcons(value: unknown): Record<string, string> | undefined {
	if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
	const icons = new Map<string, string>();
	for (const [name, rawIcon] of Object.entries(value)) {
		const key = vaultPropertyIconKey(name);
		const icon = typeof rawIcon === 'string' ? normalizeTaskIconValue(rawIcon) : '';
		if (key && icon) icons.set(key, icon);
	}
	return Object.fromEntries(icons);
}
