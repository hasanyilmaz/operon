export interface DeveloperApiDeclarativeSettingsHostV1 {
	empty(): void;
	addClass(className: string): void;
}

export function mountDeveloperApiDeclarativeSettingsEntryV1<
	THost extends DeveloperApiDeclarativeSettingsHostV1,
>(
	entryId: string,
	host: THost,
	render: (host: THost) => void,
): boolean {
	if (entryId !== 'integrations.developerApi') return false;
	host.empty();
	host.addClass('operon-settings-search-bounded-render');
	render(host);
	return true;
}
