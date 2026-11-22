export const OPERON_VIEWS = ['table', 'calendar', 'kanban', 'filter'] as const;
export type OperonView = typeof OPERON_VIEWS[number];

export type OperonViewTarget = { kind: 'view'; preset?: string } & (
	| { view: 'table'; paneType: 'tab' | 'lightbox' }
	| { view: Exclude<OperonView, 'table'>; paneType: 'tab' }
);
export type OperonCommandTarget =
	| OperonViewTarget
	| { kind: 'automation'; rule: string; action: 'open' | 'run' }
	| { kind: 'command'; command: string };

function isOperonView(value: string | null): value is OperonView {
	return OPERON_VIEWS.some(view => view === value);
}

export function isOperonCommandSlug(value: string): boolean {
	return /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(value);
}

/** All emitted links identify the vault. Obsidian routes the link to that vault. */
export function buildOperonUri(vault: string, target: OperonCommandTarget): string {
	if (!vault.trim()) throw new Error('Missing vault');
	const params = new URLSearchParams({ vault });
	switch (target.kind) {
		case 'command':
			if (!isOperonCommandSlug(target.command)) throw new Error('Invalid Operon command');
			params.set('command', target.command);
			break;
		case 'automation':
			if (!target.rule.trim()) throw new Error('Missing automation rule ID');
			params.set('view', 'automation');
			params.set('rule', target.rule);
			if (target.action === 'run') params.set('run', 'true');
			break;
		case 'view':
			params.set('view', target.view);
			if (target.preset !== undefined) {
				if (!target.preset.trim()) throw new Error('Missing preset ID');
				params.set('preset', target.preset);
			}
			if (target.paneType === 'lightbox') params.set('paneType', 'lightbox');
			break;
	}
	return `obsidian://operon?${params.toString().replace(/\+/gu, '%20')}`;
}

/** Unknown or mixed actions must never turn into a default opening or a run. */
export function parseOperonUri(uri: string): { vault: string; target: OperonCommandTarget } | null {
	let url: URL;
	try { url = new URL(uri); } catch { return null; }
	if (url.protocol !== 'obsidian:' || url.host !== 'operon' || url.username || url.password ||
		(url.pathname && url.pathname !== '/') || url.hash) return null;

	const params = url.searchParams;
	const keys = new Set<string>();
	let duplicate = false;
	params.forEach((_, key) => {
		if (keys.has(key)) duplicate = true;
		keys.add(key);
	});
	const vault = params.get('vault');
	if (!vault?.trim() || duplicate) return null;
	const onlyKeys = (...allowed: string[]) => [...keys].every(key => key === 'vault' || allowed.includes(key));
	const command = params.get('command');
	if (command !== null) {
		return onlyKeys('command') && isOperonCommandSlug(command) ? { vault, target: { kind: 'command', command } } : null;
	}

	const view = params.get('view');
	if (view === 'automation') {
		const rule = params.get('rule');
		const run = params.get('run');
		if (!onlyKeys('view', 'rule', 'run') || !rule?.trim() || (run !== null && run !== 'true')) return null;
		return { vault, target: { kind: 'automation', rule, action: run === 'true' ? 'run' : 'open' } };
	}
	if (!isOperonView(view)) return null;
	const preset = params.get('preset');
	const pane = params.get('paneType');
	if (!onlyKeys('view', 'preset', 'paneType') || (preset !== null && !preset.trim())) return null;
	const named = preset === null ? {} : { preset };
	if (view === 'table' && pane === 'lightbox') return { vault, target: { kind: 'view', view, ...named, paneType: 'lightbox' } };
	if (pane !== null && pane !== 'tab') return null;
	return { vault, target: { kind: 'view', view, ...named, paneType: 'tab' } };
}
