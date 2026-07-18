import { t } from '../../../core/i18n';
import { createButton, focusFloatingInput } from '../common';
import { getOwnerWindow } from '../../../core/dom-compat';
import { createCustomFieldPanel, type CustomScalarFieldPickerOptions } from './common';

export type CustomNumberFieldPickerOptions = CustomScalarFieldPickerOptions<'number'>;

export function showCustomNumberFieldPicker(
	anchor: HTMLElement | DOMRect,
	options: CustomNumberFieldPickerOptions,
): () => void {
	let completed = false;
	const { panel, close } = createCustomFieldPanel(anchor, options, () => {
		if (!completed) options.onCancel?.();
		options.onClose?.();
	});

	const title = panel.createDiv('operon-floating-subtitle');
	title.textContent = options.label;

	const input = panel.createEl('input');
	input.type = 'number';
	input.step = 'any';
	input.className = 'operon-floating-input operon-custom-field-picker-input operon-custom-number-picker-input';
	input.placeholder = options.placeholder ?? options.label;
	input.value = options.value ?? '';

	const actions = panel.createDiv('operon-floating-actions operon-custom-number-picker-actions');

	if (options.onRemove && options.canRemove) {
		const removeButton = createButton(t('buttons', 'clear'), 'operon-floating-btn is-secondary operon-custom-number-picker-clear', actions);
		removeButton.addEventListener('click', () => {
			completed = true;
			options.onRemove?.(options.canonicalKey);
			close();
		});
		actions.appendChild(removeButton);
	}

	const applyButton = createButton(t('buttons', 'save'), 'operon-floating-btn operon-custom-number-picker-save', actions);
	actions.appendChild(applyButton);
	panel.appendChild(actions);

	const commit = (): void => {
		const trimmed = input.value.trim();
		const parsed = Number(trimmed);
		if (!trimmed || !Number.isFinite(parsed)) return;
		completed = true;
		options.onCommit(options.canonicalKey, trimmed);
		close();
	};

	applyButton.addEventListener('click', commit);
	input.addEventListener('keydown', event => {
		if (event.key === 'Enter') {
			event.preventDefault();
			commit();
		}
	});

	getOwnerWindow(input).requestAnimationFrame(() => {
		focusFloatingInput(input);
		input.select();
	});

	return close;
}
