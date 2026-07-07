import { App, FuzzyMatch, FuzzySuggestModal, prepareFuzzySearch, setIcon } from 'obsidian';
import { t } from '../../core/i18n';
import { IndexedTask } from '../../types/fields';
import { Pipeline } from '../../types/pipeline';
import { OperonSettings, resolveTaskDisplayIcon } from '../../types/settings';
import { resolveTaskStatusIconColorForTask } from '../../core/task-color-source';
import {
	buildTaskPickerSearchText,
	getCalendarTaskPickerSortRank,
	sortCalendarTasksForPicker,
	summarizeTaskCalendarAssignment,
} from './calendar-modal-helpers';

interface TaskPickerModalOptions {
	getTasks: () => IndexedTask[];
	getPipelines: () => Pipeline[];
	getSettings: () => OperonSettings;
	onChooseTask: (task: IndexedTask) => void;
	onCancel?: () => void;
	placeholder?: string;
	emptyStateText?: string;
	limit?: number;
}

type RankedTaskMatch = FuzzyMatch<IndexedTask> & {
	groupRank: number;
	sortRank: number;
};

export class TaskPickerModal extends FuzzySuggestModal<IndexedTask> {
	private readonly options: TaskPickerModalOptions;
	private resolved = false;

	constructor(app: App, options: TaskPickerModalOptions) {
		super(app);
		this.options = options;
		this.setPlaceholder(options.placeholder ?? t('calendar', 'taskPickerSearchPlaceholder'));
		this.emptyStateText = options.emptyStateText ?? t('calendar', 'noMatchingTasks');
		this.setInstructions([
			{ command: '↑↓', purpose: t('calendar', 'instructionNavigate') },
			{ command: 'Enter', purpose: t('calendar', 'instructionChooseTask') },
			{ command: 'Esc', purpose: t('calendar', 'instructionCancel') },
		]);
	}

	getItems(): IndexedTask[] {
		return sortCalendarTasksForPicker(this.options.getTasks());
	}

	getItemText(task: IndexedTask): string {
		return buildTaskPickerSearchText(task);
	}

	getSuggestions(query: string): RankedTaskMatch[] {
		const tasks = this.getItems();
		const limit = this.options.limit ?? 50;
		const normalized = query.trim();
		if (!normalized) {
			return tasks.slice(0, limit).map((task, index) => ({
				item: task,
				match: { score: 0, matches: [] },
				groupRank: getCalendarTaskPickerSortRank(task),
				sortRank: index,
			}));
		}

		const fuzzySearch = prepareFuzzySearch(normalized);
		return tasks
			.map((task, index) => {
				const match = fuzzySearch(buildTaskPickerSearchText(task));
				if (!match) return null;
				return {
					item: task,
					match,
					groupRank: getCalendarTaskPickerSortRank(task),
					sortRank: index,
				};
			})
			.filter((entry): entry is RankedTaskMatch => !!entry)
			.sort((left, right) => {
				if (left.groupRank !== right.groupRank) return left.groupRank - right.groupRank;
				if (left.match.score !== right.match.score) return left.match.score - right.match.score;
				return left.sortRank - right.sortRank;
			})
			.slice(0, limit);
	}

	renderSuggestion(match: FuzzyMatch<IndexedTask>, el: HTMLElement): void {
		const task = match.item;
		el.addClass('operon-calendar-task-picker-item');
		el.empty();

		const iconWrap = el.createDiv('operon-calendar-task-picker-icon');
		this.renderTaskIcon(iconWrap, task);

		const body = el.createDiv('operon-calendar-task-picker-body');
		body.createDiv({
			cls: 'operon-calendar-task-picker-title',
			text: task.description || t('calendar', 'untitledTask'),
		});

		const meta = body.createDiv('operon-calendar-task-picker-meta');
		meta.createSpan({ text: task.operonId });
		meta.createSpan({ text: task.primary.filePath });
		const status = task.fieldValues['status'];
		if (status) {
			meta.createSpan({ text: status });
		}

		const assignment = summarizeTaskCalendarAssignment(task);
		if (assignment.length > 0) {
			body.createDiv({
				cls: 'operon-calendar-task-picker-assignment',
				text: assignment.join(' • '),
			});
		}
	}

	onChooseItem(task: IndexedTask): void {
		this.resolved = true;
		this.options.onChooseTask(task);
		this.close();
	}

	onClose(): void {
		super.onClose();
		if (!this.resolved) {
			window.setTimeout(() => this.options.onCancel?.(), 0);
		}
	}

	private renderTaskIcon(container: HTMLElement, task: IndexedTask): void {
		container.style.removeProperty('color');
		const iconColor = resolveTaskStatusIconColorForTask(task, this.options.getSettings());
		if (iconColor) container.style.color = iconColor;

		setIcon(container, resolveTaskDisplayIcon(this.options.getSettings(), task.fieldValues, task.checkbox));
	}
}
