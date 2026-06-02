import { App, FuzzyMatch, FuzzySuggestModal, prepareFuzzySearch } from 'obsidian';
import { t } from '../../core/i18n';
import { isDynamicFileTaskFilterSet } from '../../core/dynamic-file-task-filter';
import { FilterSet } from '../../types/settings';

interface CalendarFilterPickerItem {
	id: string | null;
	name: string;
	description?: string;
}

interface CalendarFilterPickerModalOptions {
	filterSets: FilterSet[];
	onChooseFilter: (filterSetId: string | null) => void;
	onCancel?: () => void;
}

type RankedFilterMatch = FuzzyMatch<CalendarFilterPickerItem> & {
	sortRank: number;
};

export class CalendarFilterPickerModal extends FuzzySuggestModal<CalendarFilterPickerItem> {
	private readonly options: CalendarFilterPickerModalOptions;
	private resolved = false;

	constructor(app: App, options: CalendarFilterPickerModalOptions) {
		super(app);
		this.options = options;
		this.setPlaceholder(t('calendar', 'filterPickerSearchPlaceholder'));
		this.emptyStateText = t('calendar', 'noMatchingFilters');
		this.setInstructions([
			{ command: '↑↓', purpose: t('calendar', 'instructionNavigate') },
			{ command: 'Enter', purpose: t('calendar', 'instructionChooseFilter') },
			{ command: 'Esc', purpose: t('calendar', 'instructionCancel') },
		]);
	}

	getItems(): CalendarFilterPickerItem[] {
		const items: CalendarFilterPickerItem[] = [
			{ id: null, name: t('calendar', 'noFilter'), description: t('calendar', 'filterPickerNoFilterDesc') },
		];
		for (const filterSet of this.options.filterSets) {
			if (isDynamicFileTaskFilterSet(filterSet)) continue;
			items.push({
				id: filterSet.id,
				name: filterSet.name,
				description: filterSet.id,
			});
		}
		return items;
	}

	getItemText(item: CalendarFilterPickerItem): string {
		return item.name;
	}

	getSuggestions(query: string): RankedFilterMatch[] {
		const items = this.getItems();
		const normalized = query.trim();
		if (!normalized) {
			return items.map((item, index) => ({
				item,
				match: { score: 0, matches: [] },
				sortRank: index,
			}));
		}

		const fuzzySearch = prepareFuzzySearch(normalized);
		return items
			.map((item, index) => {
				const match = fuzzySearch(item.name);
				if (!match) return null;
				return {
					item,
					match,
					sortRank: index,
				};
			})
			.filter((entry): entry is RankedFilterMatch => !!entry)
			.sort((left, right) => {
				if (left.match.score !== right.match.score) return left.match.score - right.match.score;
				return left.sortRank - right.sortRank;
			});
	}

	renderSuggestion(match: FuzzyMatch<CalendarFilterPickerItem>, el: HTMLElement): void {
		el.empty();
		el.addClass('operon-calendar-filter-picker-item');
		el.createDiv({
			cls: 'operon-calendar-filter-picker-title',
			text: match.item.name,
		});
		if (match.item.description) {
			el.createDiv({
				cls: 'operon-calendar-filter-picker-description',
				text: match.item.description,
			});
		}
	}

	onChooseItem(item: CalendarFilterPickerItem): void {
		this.resolved = true;
		this.options.onChooseFilter(item.id);
		this.close();
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			this.options.onCancel?.();
		}
	}
}
