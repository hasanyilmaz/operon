import {
	FileTaskTemplateOption,
	getBuiltinEmptyFileTaskTemplateDescription,
} from '../../core/file-task-templates';
import { t } from '../../core/i18n';
import { bindPickerListItemActivation, createFloatingPanel, requestFloatingInputFocus, scrollChildIntoView } from './common';

interface FileTaskTemplatePickerOptions {
	value?: string;
	options: FileTaskTemplateOption[];
	onSelect: (template: FileTaskTemplateOption) => void;
	onClose?: () => void;
}

interface FileTaskTemplateCandidate {
	option: FileTaskTemplateOption;
	searchText: string;
}

export function showFileTaskTemplatePicker(
	anchor: HTMLElement | DOMRect,
	options: FileTaskTemplatePickerOptions,
): () => void {
	let completed = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-file-template-picker-panel', () => {
		if (!completed) options.onClose?.();
	});

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', 'chooseFileTaskTemplate');

	const list = panel.createDiv('operon-file-template-picker-list');
	const infoRow = panel.createDiv('operon-file-template-picker-info-row');
	const infoLabel = infoRow.createSpan('operon-file-template-picker-info-label');
	infoLabel.textContent = t('taskEditor', 'fileTemplateInfoLabel');
	const infoValue = infoRow.createSpan('operon-file-template-picker-info-value');
	const countLabel = panel.createDiv('operon-icon-picker-count operon-file-template-picker-count');

	const candidates = options.options.map(option => ({
		option,
		searchText: `${option.name} ${option.path ?? getBuiltinEmptyFileTaskTemplateDescription()}`.toLowerCase(),
	}));
	let matches = rankCandidates(candidates, '');
	const selectedId = options.value?.trim() ?? '';
	let activeIndex = Math.max(0, matches.findIndex(candidate => candidate.option.id === selectedId));

	const selectTemplate = (template: FileTaskTemplateOption): void => {
		if (completed) return;
		completed = true;
		options.onSelect(template);
		close();
	};

	const render = (): void => {
		list.replaceChildren();
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });
		if (matches.length === 0) {
			list.createDiv({ cls: 'operon-file-template-picker-empty', text: t('taskEditor', 'noMatchingTemplates') });
			infoRow.hide();
			return;
		}

		for (const [index, candidate] of matches.entries()) {
			const button = list.createEl('button');
			button.type = 'button';
			button.className = 'operon-list-picker-item operon-file-template-picker-item';
			if (index === activeIndex) button.addClass('is-active');
			if (candidate.option.id === selectedId) button.addClass('is-selected');

			button.createDiv({
				cls: 'operon-file-template-picker-primary',
				text: candidate.option.name,
			});

			button.addEventListener('mousemove', () => {
				if (activeIndex !== index) {
					activeIndex = index;
					render();
				}
			});
			bindPickerListItemActivation(button, () => selectTemplate(candidate.option), { stopPropagation: true });

			list.appendChild(button);
			}

			const activeItem = list.children[activeIndex] as HTMLElement | undefined;
			scrollChildIntoView(list, activeItem);
			const activeOption = matches[activeIndex]?.option;
		infoValue.textContent = activeOption
			? activeOption.path ?? getBuiltinEmptyFileTaskTemplateDescription()
			: '';
		infoRow.show();
	};

	const updateMatches = (query: string): void => {
		matches = rankCandidates(candidates, query);
		const selectedIndex = matches.findIndex(candidate => candidate.option.id === selectedId);
		activeIndex = selectedIndex >= 0 ? selectedIndex : 0;
		render();
	};

	input.addEventListener('input', () => updateMatches(input.value));
	input.addEventListener('keydown', event => {
		if (matches.length === 0) return;
		if (event.key === 'ArrowDown') {
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			render();
			return;
		}
		if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			render();
			return;
		}
		if (event.key === 'Enter' && matches[activeIndex]) {
			event.preventDefault();
			selectTemplate(matches[activeIndex].option);
		}
	});

		render();
		requestFloatingInputFocus(input);
		return close;
	}

function rankCandidates(candidates: FileTaskTemplateCandidate[], query: string): FileTaskTemplateCandidate[] {
	const lowered = query.trim().toLowerCase();
	if (!lowered) return candidates;

	return candidates
		.map(candidate => ({
			candidate,
			score: scoreTemplateMatch(candidate, lowered),
		}))
		.filter(result => result.score > 0)
		.sort((left, right) => {
			if (right.score !== left.score) return right.score - left.score;
			return left.candidate.option.name.localeCompare(right.candidate.option.name, undefined, { sensitivity: 'base' });
		})
		.map(result => result.candidate);
}

function scoreTemplateMatch(candidate: FileTaskTemplateCandidate, query: string): number {
	const name = candidate.option.name.toLowerCase();
	const path = candidate.option.path?.toLowerCase() ?? '';
	let score = 0;
	if (name === query) score += 1000;
	if (path === query) score += 900;
	if (name.startsWith(query)) score += 700;
	if (path.startsWith(query)) score += 550;
	if (name.includes(query)) score += 320;
	if (path.includes(query)) score += 260;
	if (candidate.searchText.includes(query)) score += 120;
	for (const token of query.split(/\s+/).filter(Boolean)) {
		if (token.length < 2) continue;
		if (name.includes(token)) score += 60;
		if (path.includes(token)) score += 40;
	}
	return score;
}
