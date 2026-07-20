export type LanguagePackOptionActivity = 'idle' | 'downloading' | 'updating';

export interface LanguagePackOptionStatus {
	installed: boolean;
	updateAvailable: boolean;
	activity: LanguagePackOptionActivity;
}

export interface LanguagePackOption<TLanguage extends string> {
	value: TLanguage;
	label: string;
}

export interface LanguagePackStatusLabels {
	download: string;
	downloading: string;
	update: string;
	updating: string;
}

export function buildLanguagePackDropdownOptions<TLanguage extends string>(input: {
	english: LanguagePackOption<TLanguage>;
	languages: readonly LanguagePackOption<TLanguage>[];
	locale: string;
	getStatus: (language: TLanguage) => LanguagePackOptionStatus;
	statusLabels: LanguagePackStatusLabels;
}): LanguagePackOption<TLanguage>[] {
	const collator = new Intl.Collator(input.locale, { sensitivity: 'base' });
	const languages = [...input.languages].sort((left, right) =>
		collator.compare(left.label, right.label) || left.value.localeCompare(right.value, 'en')
	);
	return [
		{ ...input.english },
		...languages.map(option => ({
			...option,
			label: `${option.label}${getLanguagePackStatusSuffix(input.getStatus(option.value), input.statusLabels)}`,
		})),
	];
}

function getLanguagePackStatusSuffix(
	status: LanguagePackOptionStatus,
	labels: LanguagePackStatusLabels,
): string {
	if (status.activity === 'downloading') return ` — ${labels.downloading}`;
	if (status.activity === 'updating') return ` — ${labels.updating}`;
	if (!status.installed) return ` — ${labels.download}`;
	if (status.updateAvailable) return ` — ${labels.update}`;
	return '';
}
