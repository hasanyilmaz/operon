import { PriorityDefinition } from '../../types/priority';
import { t } from '../../core/i18n';
import { createButton, createFloatingPanel, focusFloatingInput } from './common';

interface PriorityPickerOptions {
	priorities: PriorityDefinition[];
	value?: string;
	retainInputFocus?: boolean;
	onSelect: (value: string) => void;
	onClear?: () => void;
	onClose?: () => void;
}

function measurePriorityPickerWidth(panel: HTMLElement, labels: string[]): number {
	const probe = panel.createSpan('operon-priority-picker-measure-probe');
	probe.style.font = getComputedStyle(panel).font;

	// Lay out every label at once as inline-block spans, then read all widths in a single
	// pass so the browser performs one layout instead of one forced reflow per label.
	const spans = labels.map(label => {
		const span = probe.createSpan('operon-priority-picker-measure-label');
		span.textContent = label;
		return span;
	});

	let maxWidth = 0;
	for (const span of spans) {
		maxWidth = Math.max(maxWidth, Math.ceil(span.getBoundingClientRect().width));
	}

	probe.remove();
	return Math.max(112, maxWidth + 52);
}

export function showPriorityPicker(anchor: HTMLElement | DOMRect, options: PriorityPickerOptions): () => void {
	let completed = false;
	const { panel, close } = createFloatingPanel(anchor, 'operon-floating-panel operon-priority-picker-panel', () => {
		if (!completed) options.onClose?.();
	}, {
		retainInputFocus: options.retainInputFocus,
	});

	const input = panel.createEl('input');
	input.type = 'text';
	input.className = 'operon-floating-input';
	input.placeholder = t('taskEditor', 'priorityNone');
	input.value = '';

	const list = panel.createDiv('operon-priority-picker-list');

	if (options.onClear) {
		const clearButton = createButton(t('taskEditor', 'repeatClear'), 'operon-floating-btn is-secondary', panel);
		clearButton.classList.add('operon-priority-picker-clear');
		clearButton.addEventListener('click', () => {
			completed = true;
			options.onClear?.();
			close();
		});
		panel.appendChild(clearButton);
	}

	let matches = options.priorities;
	let activeIndex = 0;
	const WINDOW_SIZE = 7;
	const sharedWidth = measurePriorityPickerWidth(panel, [
		t('taskEditor', 'priorityNone'),
		t('taskEditor', 'repeatClear'),
		...(options.value ? [options.value] : []),
		...options.priorities.map(priority => priority.label),
	]);
	panel.style.setProperty('--operon-priority-picker-width', `${sharedWidth}px`);

	const selectPriority = (label: string) => {
		completed = true;
		options.onSelect(label);
		close();
	};

	const render = () => {
		list.replaceChildren();
		if (matches.length === 0) return;
		const windowStart = Math.min(
			Math.max(0, activeIndex - Math.floor(WINDOW_SIZE / 2)),
			Math.max(0, matches.length - WINDOW_SIZE),
		);
		const windowEnd = Math.min(windowStart + WINDOW_SIZE, matches.length);

		matches.slice(windowStart, windowEnd).forEach((priority, index) => {
			const absoluteIndex = windowStart + index;
			const option = list.createEl('button');
			option.type = 'button';
			option.className = 'operon-priority-option';
			if (absoluteIndex === activeIndex) option.classList.add('is-active');

			const dot = option.createSpan('operon-priority-dot');
			dot.style.backgroundColor = priority.color;

			const label = option.createSpan();
			label.textContent = priority.label;

			option.addEventListener('mousemove', () => {
				if (activeIndex !== absoluteIndex) {
					const previousOption = list.children[activeIndex - windowStart] as HTMLElement | undefined;
					activeIndex = absoluteIndex;
					previousOption?.classList.remove('is-active');
					option.classList.add('is-active');
				}
			});
			option.addEventListener('mousedown', event => {
				event.preventDefault();
				selectPriority(priority.label);
			});
			list.appendChild(option);
		});
	};

	const updateMatches = (query: string) => {
		const lowered = query.trim().toLowerCase();
		matches = lowered.length === 0
			? options.priorities
			: options.priorities.filter(priority => priority.label.toLowerCase().includes(lowered));
		const selectedIndex = lowered.length === 0
			? matches.findIndex(priority => priority.label === options.value)
			: matches.findIndex(priority => priority.label.toLowerCase() === lowered || priority.label === options.value);
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
		} else if (event.key === 'ArrowUp') {
			event.preventDefault();
			activeIndex = Math.max(activeIndex - 1, 0);
			render();
		} else if (event.key === 'Enter') {
			event.preventDefault();
			if (matches[activeIndex]) selectPriority(matches[activeIndex].label);
		} else if (event.key === 'Escape') {
			event.preventDefault();
			close();
		}
	});

	updateMatches('');
	window.requestAnimationFrame(() => {
		focusFloatingInput(input);
	});

	return close;
}
