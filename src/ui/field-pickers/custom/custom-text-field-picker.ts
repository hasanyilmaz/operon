import { t } from '../../../core/i18n';
import { createButton, focusFloatingInput } from '../common';
import { createCustomFieldPanel, type CustomScalarFieldPickerOptions } from './common';

export interface CustomTextFieldPickerOptions extends CustomScalarFieldPickerOptions<'text'> {
	candidates: string[];
}

export function showCustomTextFieldPicker(
	anchor: HTMLElement | DOMRect,
	options: CustomTextFieldPickerOptions,
): () => void {
	let completed = false;
	const { panel, close } = createCustomFieldPanel(anchor, options, () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const title = panel.createDiv('operon-floating-title');
	title.textContent = options.label;

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input operon-custom-field-picker-input operon-custom-text-picker-input';
	input.placeholder = options.placeholder ?? options.label;
	input.value = options.value ?? '';

	const list = panel.createDiv('operon-custom-field-picker-suggestions operon-custom-text-picker-suggestions');
	const actions = panel.createDiv('operon-floating-actions operon-custom-text-picker-actions');
	const countLabel = actions.createDiv('operon-custom-text-picker-count');
	actions.appendChild(countLabel);
	let matches: string[] = [];
	let activeIndex = 0;

	const commit = (value: string): void => {
		const trimmed = value.trim();
		if (!trimmed) return;
		completed = true;
		options.onCommit(options.canonicalKey, trimmed);
		close();
	};

	const renderSuggestions = (): void => {
		list.replaceChildren();
		const query = input.value.trim().toLocaleLowerCase();
		matches = options.candidates
			.filter(candidate => candidate.trim())
			.filter((candidate, index, all) => all.findIndex(item => item.toLocaleLowerCase() === candidate.toLocaleLowerCase()) === index)
			.filter(candidate => !query || buildCustomTextSearchText(candidate).includes(query));
		activeIndex = matches.length === 0 ? 0 : Math.min(activeIndex, matches.length - 1);
		countLabel.textContent = t('taskEditor', matches.length === 1 ? 'resultCountOne' : 'resultCountMany', { count: String(matches.length) });

		for (const [index, match] of matches.entries()) {
			const item = createButton(formatCustomTextDisplayValue(match), 'operon-custom-field-picker-option operon-custom-text-picker-option', list);
			if (index === activeIndex) item.classList.add('is-active');
			item.addEventListener('mousemove', () => setActiveIndex(index));
			item.addEventListener('mousedown', event => {
				event.preventDefault();
				commit(match);
			});
			list.appendChild(item);
		}
	};

	const setActiveIndex = (nextIndex: number): void => {
		if (activeIndex === nextIndex) return;
		const previousItem = list.children[activeIndex] as HTMLElement | undefined;
		activeIndex = nextIndex;
		previousItem?.classList.remove('is-active');
		(list.children[activeIndex] as HTMLElement | undefined)?.classList.add('is-active');
	};

	input.addEventListener('input', () => renderSuggestions());
	input.addEventListener('keydown', event => {
		if (event.key === 'ArrowDown') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.min(activeIndex + 1, matches.length - 1);
			renderSuggestions();
			return;
		}
		if (event.key === 'ArrowUp') {
			if (matches.length === 0) return;
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			renderSuggestions();
			return;
		}
		if (event.key === 'Enter') {
			event.preventDefault();
			commit(matches[activeIndex] ?? input.value);
		}
	});

	const buttonWrap = actions.createDiv('operon-custom-text-picker-button-wrap');
	if (options.onRemove && options.canRemove) {
		const clearButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary', buttonWrap);
		clearButton.addEventListener('click', () => {
			completed = true;
			options.onRemove?.(options.canonicalKey);
			close();
		});
		buttonWrap.appendChild(clearButton);
	}
	const saveButton = createButton(t('buttons', 'save'), 'operon-floating-btn', buttonWrap);
	saveButton.addEventListener('click', () => commit(input.value));
	buttonWrap.appendChild(saveButton);
	panel.appendChild(actions);

	renderSuggestions();
	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});
	return close;
}

function formatCustomTextDisplayValue(value: string): string {
	const trimmed = value.trim();
	return parseCustomTextWikiLink(trimmed)?.displayValue ?? trimmed;
}

function buildCustomTextSearchText(value: string): string {
	return `${formatCustomTextDisplayValue(value)} ${value}`.toLocaleLowerCase();
}

interface CustomTextWikiLinkValue {
	displayValue: string;
}

function parseCustomTextWikiLink(value: string): CustomTextWikiLinkValue | null {
	const trimmed = value.trim();
	const match = /^!?\[\[([^\]]+)\]\]$/u.exec(trimmed);
	if (!match) return null;
	const body = match[1]?.trim() ?? '';
	if (!body) return null;
	const pipeIndex = body.indexOf('|');
	if (pipeIndex < 0) {
		return {
			displayValue: formatCustomTextWikiLinkTargetLabel(body) || trimmed,
		};
	}

	const linkTarget = body.slice(0, pipeIndex).trim();
	if (!linkTarget) return null;
	const alias = body.slice(pipeIndex + 1).trim();
	return {
		displayValue: alias || formatCustomTextWikiLinkTargetLabel(linkTarget) || trimmed,
	};
}

function formatCustomTextWikiLinkTargetLabel(linkTarget: string): string {
	const lastSegment = linkTarget.split('/').pop()?.trim() ?? linkTarget.trim();
	return lastSegment.replace(/\.md$/i, '');
}
